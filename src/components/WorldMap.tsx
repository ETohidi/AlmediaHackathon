import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildSeedCountryGeoJson } from '../lib/countryGeometry'
import { userConfidenceColorScale } from '../lib/colorScale'

const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-170, -60],
  [170, 80],
]

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'World Blank Ocean',
  projection: {
    type: 'globe',
  },
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#0d0d0f',
      },
    },
  ],
}

type ContinentMetric = {
  id: string
  name: string
  label_lng?: number
  label_lat?: number
  total_users: number
  confidence: number | null
  growth_rate_30d: number | null
  freshness: FreshnessMetric
  potential: { untapped_users: number; score: number; data_status: string }
  infrastructure: InfrastructureMetric
}

type InfrastructureMetric = {
  p95_postback_latency_ms: number
  postback_failure_rate?: number
  queue_lag_seconds?: number
  utilization: number
  capacity_headroom: number
  status: string
  data_status: string
}

type FreshnessMetric = {
  status: 'fresh' | 'review' | 'stale' | 'missing'
  age_days: number | null
  reasons: string[]
}

type CountryMetric = {
  id: string
  name: string
  continent_id: string
  total_users: number
  confidence: number
  growth_rate_30d: number
  growth_rate_status: string
  last_refreshed: string
  data_status: string
  source_ids: string[]
  freshness: FreshnessMetric
  potential: { addressable_users: number; untapped_users: number; score: number; data_status: string }
  infrastructure: InfrastructureMetric
  games: Array<{
    id: string
    name: string
    users: number
    share: number
    data_status: string
  }>
}

export type GameFilter = 'all' | string
export type MapMode = 'users' | 'potential' | 'capacity'

type GeoJsonFeature = {
  type: 'Feature'
  properties: Record<string, any>
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: any
  }
}

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

const collectPositions = (coordinates: any, target: Array<[number, number]>) => {
  if (!Array.isArray(coordinates)) {
    return
  }

  if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    target.push([coordinates[0], coordinates[1]])
    return
  }

  for (const child of coordinates) {
    collectPositions(child, target)
  }
}

const getBoundsFromGeometry = (geometry: GeoJsonFeature['geometry']) => {
  const points: Array<[number, number]> = []
  collectPositions(geometry.coordinates, points)

  if (!points.length) {
    return null
  }

  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity

  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }

  return {
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2] as [number, number],
    bounds: [
      [minLon, minLat],
      [maxLon, maxLat],
    ] as [[number, number], [number, number]],
  }
}

const continentFillColorExpression: any = 'rgba(0, 0, 0, 0)'

const continentFillOpacityExpression: any = [
  'case',
  ['==', ['get', 'total_users'], 0],
  0,
  1,
]

const continentOutlineColor = '#4b5563'

const countryFillOpacityExpression: any = [
  'case',
  ['==', ['get', 'display_users'], 0],
  0,
  1,
]

const seedCountryGeoJson = buildSeedCountryGeoJson()

const buildLabelFeatureCollection = (features: GeoJsonFeature[], metrics: ContinentMetric[]) => {
  const anchorsById = new Map(metrics.map((entry) => [entry.id, [entry.label_lng, entry.label_lat] as const]))

  const labelFeatures = features
    .map((feature) => {
      const featureId = String(feature.properties?.id ?? '')
      const fixedCenter = anchorsById.get(featureId)
      if (!fixedCenter || fixedCenter[0] == null || fixedCenter[1] == null) {
        return null
      }

      return {
        type: 'Feature' as const,
        properties: {
          id: feature.properties.id,
          name: feature.properties.name,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [fixedCenter[0], fixedCenter[1]],
        },
      }
    })
    .filter(Boolean)

  return {
    type: 'FeatureCollection' as const,
    features: labelFeatures,
  }
}

const mergeMetricsIntoGeoJson = (geoJson: GeoJsonFeatureCollection, metrics: ContinentMetric[]) => {
  const metricsById = new Map(metrics.map((entry) => [entry.id, entry]))
  const metricsByName = new Map(metrics.map((entry) => [entry.name.toLowerCase(), entry]))

  const features = geoJson.features.map((feature) => {
    const id = String(feature.properties?.id ?? '')
    const name = String(feature.properties?.name ?? '')
    const metric = metricsById.get(id) ?? metricsByName.get(name.toLowerCase())

    return {
      ...feature,
      properties: {
        ...feature.properties,
        id,
        name,
        total_users: metric?.total_users ?? 0,
        confidence: metric?.confidence ?? 0,
        growth_rate_30d: metric?.growth_rate_30d ?? null,
        freshness_status: metric?.freshness.status ?? 'missing',
        freshness_age_days: metric?.freshness.age_days ?? null,
        potential_users: metric?.potential.untapped_users ?? 0,
        potential_score: metric?.potential.score ?? 0,
        latency_ms: metric?.infrastructure.p95_postback_latency_ms ?? 0,
        utilization: metric?.infrastructure.utilization ?? 0,
        capacity_headroom: metric?.infrastructure.capacity_headroom ?? 0,
        capacity_status: metric?.infrastructure.status ?? 'unknown',
      },
    }
  })

  return {
    type: 'FeatureCollection' as const,
    features,
  }
}

const fetchMapData = async (snapshotId: string, gameFilter: GameFilter) => {
  const [continentsResponse, metricsResponse] = await Promise.all([
    fetch('/continents.geojson'),
    fetch(`/twin/continents?asOf=${encodeURIComponent(snapshotId)}&game=${encodeURIComponent(gameFilter)}`),
  ])

  if (!continentsResponse.ok) {
    throw new Error('Failed to load continents geometry')
  }

  if (!metricsResponse.ok) {
    throw new Error('Failed to load continent metrics')
  }

  const continentsGeoJson = (await continentsResponse.json()) as GeoJsonFeatureCollection
  const metrics = (await metricsResponse.json()) as ContinentMetric[]

  const enrichedContinents = mergeMetricsIntoGeoJson(continentsGeoJson, metrics)
  const continentLabels = buildLabelFeatureCollection(enrichedContinents.features, metrics)

  return {
    enrichedContinents,
    continentLabels,
  }
}

const fetchContinentCountries = async (continentId: string, snapshotId: string) => {
  const response = await fetch(
    `/twin/countries?continent=${encodeURIComponent(continentId)}&asOf=${encodeURIComponent(snapshotId)}`,
  )

  if (!response.ok) {
    throw new Error(`Failed to load countries for continent: ${continentId}`)
  }

  const payload = (await response.json()) as { countries: CountryMetric[] }
  return payload.countries
}

const getDisplayUsers = (metric: CountryMetric, gameFilter: GameFilter) => {
  if (gameFilter === 'all') {
    return metric.total_users
  }

  return metric.games.find((game) => game.id === gameFilter)?.users ?? 0
}

const buildCountryFeatureCollection = (countryMetrics: CountryMetric[], gameFilter: GameFilter) => {
  const metricsById = new Map(countryMetrics.map((entry) => [entry.id, entry]))

  const features = seedCountryGeoJson.features
    .filter((feature) => metricsById.has(String(feature.properties?.id ?? '')))
    .map((feature) => {
      const countryId = String(feature.properties?.id ?? '')
      const metric = metricsById.get(countryId)
      const displayUsers = metric ? getDisplayUsers(metric, gameFilter) : 0
      const gameShare = metric && gameFilter !== 'all' ? metric.games.find((game) => game.id === gameFilter)?.share ?? 0 : 1

      return {
        ...feature,
        properties: {
          ...feature.properties,
          id: countryId,
          name: metric?.name ?? String(feature.properties?.name ?? countryId),
          total_users: metric?.total_users ?? 0,
          display_users: displayUsers,
          confidence: metric?.confidence ?? 0,
          growth_rate_30d: metric?.growth_rate_30d ?? 0,
          freshness_status: metric?.freshness.status ?? 'missing',
          freshness_age_days: metric?.freshness.age_days ?? null,
          potential_users: Math.round((metric?.potential.untapped_users ?? 0) * gameShare),
          potential_score: metric?.potential.score ?? 0,
          latency_ms: metric?.infrastructure.p95_postback_latency_ms ?? 0,
          failure_rate: metric?.infrastructure.postback_failure_rate ?? 0,
          queue_lag_seconds: metric?.infrastructure.queue_lag_seconds ?? 0,
          utilization: metric?.infrastructure.utilization ?? 0,
          capacity_headroom: metric?.infrastructure.capacity_headroom ?? 0,
          capacity_status: metric?.infrastructure.status ?? 'unknown',
        },
      }
    })

  return {
    type: 'FeatureCollection' as const,
    features,
  }
}

const applyCountryColoring = (
  map: MapLibreMap,
  countryMetrics: CountryMetric[],
  gameFilter: GameFilter,
  mapMode: MapMode,
) => {
  const countrySource = map.getSource('countries') as GeoJSONSource | undefined
  const countryFeatures = buildCountryFeatureCollection(countryMetrics, gameFilter)
  countrySource?.setData(countryFeatures as any)

  const nonZeroUsers = countryMetrics
    .map((entry) => getDisplayUsers(entry, gameFilter))
    .filter((value) => value > 0)
  const minUsers = nonZeroUsers.length ? Math.min(...nonZeroUsers) : 0
  const maxUsers = nonZeroUsers.length ? Math.max(...nonZeroUsers) : 1
  const safeMaxUsers = maxUsers <= minUsers ? minUsers + 1 : maxUsers

  const potentialValues = countryFeatures.features
    .map((feature) => Number(feature.properties.potential_users ?? 0))
    .filter((value) => value > 0)
  const minPotential = potentialValues.length ? Math.min(...potentialValues) : 0
  const maxPotential = potentialValues.length ? Math.max(...potentialValues) : 1
  const potentialScale = userConfidenceColorScale(
    minPotential,
    maxPotential <= minPotential ? minPotential + 1 : maxPotential,
    'potential_users',
  )
  const colorExpression =
    mapMode === 'capacity'
      ? [
          'interpolate',
          ['linear'],
          ['get', 'latency_ms'],
          100,
          '#14b8a6',
          225,
          '#f59e0b',
          400,
          '#ef4444',
        ]
      : mapMode === 'potential'
        ? potentialScale
        : userConfidenceColorScale(minUsers, safeMaxUsers, 'display_users')

  map.setPaintProperty('countries-fill', 'fill-color', colorExpression as any)
  map.setPaintProperty('countries-fill', 'fill-opacity', mapMode === 'capacity' ? 0.82 : countryFillOpacityExpression)
}

const applyContinentColoring = (
  map: MapLibreMap,
  enrichedContinents: GeoJsonFeatureCollection,
  continentLabels: ReturnType<typeof buildLabelFeatureCollection>,
  mapMode: MapMode,
) => {
  const continentSource = map.getSource('continents') as GeoJSONSource | undefined
  continentSource?.setData(enrichedContinents as any)

  const nonZeroUsers = enrichedContinents.features
    .map((feature) => Number(feature.properties.total_users ?? 0))
    .filter((value) => value > 0)
  const minUsers = nonZeroUsers.length ? Math.min(...nonZeroUsers) : 0
  const maxUsers = nonZeroUsers.length ? Math.max(...nonZeroUsers) : 1
  const safeMaxUsers = maxUsers <= minUsers ? minUsers + 1 : maxUsers
  const potentialValues = enrichedContinents.features.map((feature) => Number(feature.properties.potential_users ?? 0)).filter((value) => value > 0)
  const minPotential = potentialValues.length ? Math.min(...potentialValues) : 0
  const maxPotential = potentialValues.length ? Math.max(...potentialValues) : 1
  const colorExpression = mapMode === 'capacity'
    ? ['interpolate', ['linear'], ['get', 'latency_ms'], 100, '#14b8a6', 225, '#f59e0b', 400, '#ef4444']
    : mapMode === 'potential'
      ? userConfidenceColorScale(minPotential, maxPotential <= minPotential ? minPotential + 1 : maxPotential, 'potential_users')
      : userConfidenceColorScale(minUsers, safeMaxUsers)
  map.setPaintProperty('continents-fill', 'fill-color', colorExpression as any)

  const labelSource = map.getSource('continent-labels') as GeoJSONSource | undefined
  labelSource?.setData(continentLabels as any)
}

const numberFormatter = new Intl.NumberFormat('en-US')

const formatStatus = (status: string) =>
  status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

const buildPopupContent = (properties: Record<string, any>, mapMode: MapMode) => {
  const container = document.createElement('div')
  const title = document.createElement('div')
  title.textContent = String(properties.name ?? 'Unknown')
  title.style.fontSize = '14px'
  title.style.fontWeight = '700'
  title.style.marginBottom = '8px'
  container.appendChild(title)

  const rows = mapMode === 'capacity' ? [
    ['p95 latency', `${numberFormatter.format(Number(properties.latency_ms ?? 0))} ms`],
    ['Utilization', `${Math.round(Number(properties.utilization ?? 0) * 100)}%`],
    ['Headroom', `${Math.round(Number(properties.capacity_headroom ?? 0) * 100)}%`],
    ...(properties.failure_rate == null ? [] : [['Failure rate', `${(Number(properties.failure_rate) * 100).toFixed(1)}%`]]),
    ...(properties.queue_lag_seconds == null ? [] : [['Queue lag', `${Number(properties.queue_lag_seconds)} s`]]),
    ['Status', formatStatus(String(properties.capacity_status ?? 'unknown'))],
  ] : mapMode === 'potential' ? [
    ['Untapped users', numberFormatter.format(Number(properties.potential_users ?? 0))],
    ['Potential score', `${Math.round(Number(properties.potential_score ?? 0))}/100`],
    ['Current users', numberFormatter.format(Number(properties.display_users ?? properties.total_users ?? 0))],
    ['Certainty', properties.confidence == null ? 'Unknown' : `${Math.round(Number(properties.confidence) * 100)}%`],
  ] : [
    ['Users', numberFormatter.format(Number(properties.display_users ?? properties.total_users ?? 0))],
    [
      'Growth (30d)',
      properties.growth_rate_30d == null
        ? 'Unknown'
        : `${Number(properties.growth_rate_30d) >= 0 ? '+' : ''}${(Number(properties.growth_rate_30d) * 100).toFixed(1)}%`,
    ],
    [
      'Certainty',
      properties.confidence == null ? 'Unknown' : `${Math.round(Number(properties.confidence) * 100)}%`,
    ],
    ['Freshness', formatStatus(String(properties.freshness_status ?? 'missing'))],
  ]

  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.justifyContent = 'space-between'
    row.style.gap = '18px'
    row.style.fontSize = '12px'
    row.style.lineHeight = '20px'

    const labelElement = document.createElement('span')
    labelElement.textContent = label
    labelElement.style.color = '#94a3b8'

    const valueElement = document.createElement('span')
    valueElement.textContent = value
    valueElement.style.fontWeight = '600'

    row.append(labelElement, valueElement)
    container.appendChild(row)
  }

  return container
}

type WorldMapProps = {
  gameFilter: GameFilter
  snapshotId: string
  mapMode: MapMode
}

type CountryDetailPanelProps = {
  country: CountryMetric
  gameFilter: GameFilter
  canRefresh: boolean
  proposal: RefreshProposal | null
  isRefreshing: boolean
  refreshError: string | null
  onRequestRefresh: () => void
  onApplyProposal: () => void
  onRejectProposal: () => void
  onClose: () => void
}

type RefreshProposal = {
  id: string
  status: 'pending' | 'applied' | 'rejected'
  mode: 'deterministic_demo'
  current: {
    total_users: number
    growth_rate_30d: number
    confidence: number
  }
  proposed: {
    total_users: number
    growth_rate_30d: number
    confidence: number
  }
  evidence: {
    title: string
    source_type: string
  }
  reasoning: string[]
}

function CountryDetailPanel({
  country,
  gameFilter,
  canRefresh,
  proposal,
  isRefreshing,
  refreshError,
  onRequestRefresh,
  onApplyProposal,
  onRejectProposal,
  onClose,
}: CountryDetailPanelProps) {
  return (
    <aside className="fixed bottom-4 right-4 top-16 z-30 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-700/70 bg-slate-950/95 p-5 text-slate-100 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Country detail</p>
          <h2 className="mt-1 text-xl font-semibold">{country.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close country detail"
          className="rounded-md px-2 py-1 text-xl leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          ×
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-900/80 p-3">
          <dt className="text-xs text-slate-400">Estimated users</dt>
          <dd className="mt-1 text-lg font-semibold">{numberFormatter.format(country.total_users)}</dd>
        </div>
        <div className="rounded-lg bg-slate-900/80 p-3">
          <dt className="text-xs text-slate-400">30-day growth</dt>
          <dd className="mt-1 text-lg font-semibold">
            {country.growth_rate_30d >= 0 ? '+' : ''}
            {(country.growth_rate_30d * 100).toFixed(1)}%
          </dd>
        </div>
        <div className="rounded-lg bg-slate-900/80 p-3">
          <dt className="text-xs text-slate-400">Certainty</dt>
          <dd className="mt-1 text-lg font-semibold">{Math.round(country.confidence * 100)}%</dd>
        </div>
        <div className="rounded-lg bg-slate-900/80 p-3">
          <dt className="text-xs text-slate-400">Evidence</dt>
          <dd className="mt-1 text-sm font-semibold">{formatStatus(country.data_status)}</dd>
        </div>
        <div className="rounded-lg bg-slate-900/80 p-3">
          <dt className="text-xs text-slate-400">Freshness</dt>
          <dd className="mt-1 text-sm font-semibold">{formatStatus(country.freshness.status)}</dd>
        </div>
        <div className="rounded-lg bg-slate-900/80 p-3">
          <dt className="text-xs text-slate-400">Evidence age</dt>
          <dd className="mt-1 text-sm font-semibold">
            {country.freshness.age_days == null ? 'Unknown' : `${country.freshness.age_days.toFixed(1)} days`}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onRequestRefresh}
        disabled={!canRefresh || isRefreshing || proposal?.status === 'pending'}
        className="mt-4 w-full rounded-lg border border-teal-500/60 bg-teal-950/60 px-4 py-2.5 text-sm font-semibold text-teal-100 transition hover:bg-teal-900/70 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
      >
        {isRefreshing ? 'Agent is evaluating…' : canRefresh ? 'Ask agent to refresh' : 'Return to latest snapshot to refresh'}
      </button>

      {refreshError ? <p className="mt-2 text-xs text-red-400">{refreshError}</p> : null}

      {proposal?.status === 'pending' ? (
        <section className="mt-4 rounded-lg border border-violet-500/50 bg-violet-950/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Agent proposal</h3>
            <span className="rounded bg-violet-500/20 px-2 py-1 text-[10px] uppercase tracking-wide text-violet-200">
              Demo model
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">{proposal.evidence.title}</p>

          <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 text-xs">
            <span className="text-slate-500" />
            <span className="text-slate-500">Current</span>
            <span className="text-slate-500">Proposed</span>
            <span>Users</span>
            <span>{numberFormatter.format(proposal.current.total_users)}</span>
            <span className="font-semibold text-teal-300">{numberFormatter.format(proposal.proposed.total_users)}</span>
            <span>Growth</span>
            <span>{(proposal.current.growth_rate_30d * 100).toFixed(1)}%</span>
            <span className="font-semibold text-teal-300">
              {(proposal.proposed.growth_rate_30d * 100).toFixed(1)}%
            </span>
            <span>Certainty</span>
            <span>{Math.round(proposal.current.confidence * 100)}%</span>
            <span className="font-semibold text-teal-300">
              {Math.round(proposal.proposed.confidence * 100)}%
            </span>
          </div>

          <ul className="mt-3 space-y-1 text-xs text-slate-400">
            {proposal.reasoning.map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onRejectProposal}
              disabled={isRefreshing}
              className="rounded-md border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onApplyProposal}
              disabled={isRefreshing}
              className="rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
            >
              Approve update
            </button>
          </div>
        </section>
      ) : null}

      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Game distribution</h3>
        <span className="text-xs text-slate-500">Modeled</span>
      </div>

      <div className="mt-2 space-y-2">
        {country.games.map((game) => {
          const isActive = gameFilter === game.id
          return (
            <div
              key={game.id}
              className={`rounded-lg border px-3 py-2 ${
                isActive ? 'border-violet-400/70 bg-violet-950/50' : 'border-slate-800 bg-slate-900/60'
              }`}
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{game.name}</span>
                <span>{numberFormatter.format(game.users)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 to-violet-600"
                  style={{ width: `${game.share * 100}%` }}
                />
              </div>
              <div className="mt-1 text-right text-xs text-slate-500">{(game.share * 100).toFixed(1)}%</div>
            </div>
          )
        })}
      </div>

      <div className="mt-5 border-t border-slate-800 pt-3 text-xs text-slate-500">
        Last refreshed {new Date(country.last_refreshed).toLocaleString()}
      </div>
    </aside>
  )
}

export function WorldMap({ gameFilter, snapshotId, mapMode }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const countryMetricsRef = useRef<CountryMetric[]>([])
  const gameFilterRef = useRef(gameFilter)
  const snapshotRef = useRef(snapshotId)
  const mapModeRef = useRef(mapMode)
  const currentContinentIdRef = useRef<string | null>(null)
  const isCountryZoomRef = useRef(false)
  const [isCountryZoom, setIsCountryZoom] = useState(false)
  const [selectedCountry, setSelectedCountry] = useState<CountryMetric | null>(null)
  const [refreshProposal, setRefreshProposal] = useState<RefreshProposal | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  useEffect(() => {
    gameFilterRef.current = gameFilter
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    fetchMapData(snapshotRef.current, gameFilter).then(({ enrichedContinents, continentLabels }) =>
      applyContinentColoring(map, enrichedContinents, continentLabels, mapModeRef.current),
    ).catch(console.error)
    if (countryMetricsRef.current.length) applyCountryColoring(map, countryMetricsRef.current, gameFilter, mapModeRef.current)
  }, [gameFilter])

  useEffect(() => {
    mapModeRef.current = mapMode
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    fetchMapData(snapshotRef.current, gameFilterRef.current).then(({ enrichedContinents, continentLabels }) =>
      applyContinentColoring(map, enrichedContinents, continentLabels, mapMode),
    ).catch(console.error)
    if (countryMetricsRef.current.length) {
      applyCountryColoring(map, countryMetricsRef.current, gameFilterRef.current, mapMode)
    }
  }, [mapMode])

  useEffect(() => {
    snapshotRef.current = snapshotId
    setRefreshProposal(null)
    setRefreshError(null)
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return

    fetchMapData(snapshotId, gameFilterRef.current)
      .then(({ enrichedContinents, continentLabels }) => {
        applyContinentColoring(map, enrichedContinents, continentLabels, mapModeRef.current)
      })
      .catch(console.error)

    const continentId = currentContinentIdRef.current
    if (continentId) {
      fetchContinentCountries(continentId, snapshotId)
        .then((countryMetrics) => {
          countryMetricsRef.current = countryMetrics
          applyCountryColoring(map, countryMetrics, gameFilterRef.current, mapModeRef.current)
          setSelectedCountry((current) =>
            current ? countryMetrics.find((country) => country.id === current.id) ?? null : null,
          )
        })
        .catch(console.error)
    }
  }, [snapshotId])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      interactive: true,
      attributionControl: false,
      renderWorldCopies: false,
    })
    const hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'metagame-popup',
    })
    let rotationFrame: number | null = null
    let previousFrameTime = performance.now()
    let lastUserInteraction = 0

    const noteUserInteraction = () => {
      lastUserInteraction = performance.now()
    }

    const rotateGlobe = (frameTime: number) => {
      const elapsed = Math.min(frameTime - previousFrameTime, 100)
      previousFrameTime = frameTime

      if (
        !isCountryZoomRef.current &&
        map.getProjection().type === 'globe' &&
        frameTime - lastUserInteraction > 2500 &&
        !map.isMoving()
      ) {
        const center = map.getCenter()
        map.jumpTo({ center: [center.lng + elapsed * 0.0015, center.lat] })
      }

      rotationFrame = requestAnimationFrame(rotateGlobe)
    }

    const canvas = map.getCanvas()
    canvas.addEventListener('mousedown', noteUserInteraction)
    canvas.addEventListener('touchstart', noteUserInteraction)
    canvas.addEventListener('wheel', noteUserInteraction, { passive: true })
    rotationFrame = requestAnimationFrame(rotateGlobe)

    map.on('load', () => {
      map.setSky({
        'sky-color': '#05070d',
        'horizon-color': '#1e293b',
        'fog-color': '#0f172a',
        'fog-ground-blend': 0.55,
        'atmosphere-blend': 0.9,
      })
      map.addSource('continents', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      })

      map.addSource('continent-labels', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      })

      map.addSource('countries', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      })

      map.addLayer({
        id: 'continents-fill',
        type: 'fill',
        source: 'continents',
        paint: {
          'fill-color': continentFillColorExpression,
          'fill-opacity': continentFillOpacityExpression,
        },
      })

      map.addLayer({
        id: 'continents-outline',
        type: 'line',
        source: 'continents',
        paint: {
          'line-color': [
            'match',
            ['get', 'freshness_status'],
            'stale',
            '#f87171',
            'review',
            '#fbbf24',
            continentOutlineColor,
          ],
          'line-width': 1,
          'line-opacity': [
            'case',
            ['==', ['get', 'total_users'], 0],
            0.72,
            ['==', ['get', 'freshness_status'], 'stale'],
            0.9,
            ['==', ['get', 'freshness_status'], 'review'],
            0.65,
            0.2,
          ],
        },
      })

      map.addLayer({
        id: 'countries-fill',
        type: 'fill',
        source: 'countries',
        layout: {
          visibility: 'none',
        },
        paint: {
          'fill-color': 'rgba(0, 0, 0, 0)',
          'fill-opacity': countryFillOpacityExpression,
        },
      })

      map.addLayer({
        id: 'countries-outline',
        type: 'line',
        source: 'countries',
        layout: {
          visibility: 'none',
        },
        paint: {
          'line-color': [
            'match',
            ['get', 'freshness_status'],
            'stale',
            '#f87171',
            'review',
            '#fbbf24',
            '#7f8ca3',
          ],
          'line-width': 0.8,
          'line-opacity': 0.85,
        },
      })

      map.addLayer({
        id: 'continent-labels',
        type: 'symbol',
        source: 'continent-labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 14,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': '#d1d5db',
          'text-halo-color': '#0d0d0f',
          'text-halo-width': 1.5,
        },
      })

      map.addLayer({
        id: 'country-labels',
        type: 'symbol',
        source: 'countries',
        layout: {
          visibility: 'none',
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#f1f5f9',
          'text-halo-color': '#0d0d0f',
          'text-halo-width': 1.5,
        },
      })

      map.fitBounds(WORLD_BOUNDS, {
        padding: { top: 48, right: 48, bottom: 48, left: 48 },
        duration: 0,
      })

      map.on('click', 'continents-fill', (event) => {
        const clickedFeature = event.features?.[0] as GeoJsonFeature | undefined
        if (!clickedFeature?.geometry) {
          return
        }

        const continentId = String(clickedFeature.properties?.id ?? '')
        if (!continentId) {
          return
        }

        currentContinentIdRef.current = continentId
        isCountryZoomRef.current = true
        hoverPopup.remove()
        map.setProjection({ type: 'mercator' })
        const countriesRequest = fetchContinentCountries(continentId, snapshotRef.current)

        const geometryBounds = getBoundsFromGeometry(clickedFeature.geometry)
        if (!geometryBounds) {
          return
        }

        const camera = map.cameraForBounds(geometryBounds.bounds, {
          padding: { top: 56, right: 24, bottom: 24, left: 24 },
        })

        map.once('moveend', () => {
          countriesRequest
            .then((countryMetrics) => {
              countryMetricsRef.current = countryMetrics
              applyCountryColoring(map, countryMetrics, gameFilterRef.current, mapModeRef.current)

              map.setLayoutProperty('continents-fill', 'visibility', 'none')
              map.setLayoutProperty('continent-labels', 'visibility', 'none')
              map.setLayoutProperty('countries-fill', 'visibility', 'visible')
              map.setLayoutProperty('countries-outline', 'visibility', 'visible')
              map.setLayoutProperty('country-labels', 'visibility', 'visible')
              setIsCountryZoom(true)
            })
            .catch((error) => {
              console.error(error)
            })
        })

        map.flyTo({
          center: geometryBounds.center,
          zoom: camera?.zoom ?? map.getZoom(),
          speed: 0.7,
          curve: 1.35,
          easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
          essential: true,
        })
      })

      map.on('mouseenter', 'continents-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mousemove', 'continents-fill', (event) => {
        const feature = event.features?.[0]
        if (!feature?.properties) return
        hoverPopup.setLngLat(event.lngLat).setDOMContent(buildPopupContent(feature.properties, mapModeRef.current)).addTo(map)
      })

      map.on('mouseleave', 'continents-fill', () => {
        map.getCanvas().style.cursor = ''
        hoverPopup.remove()
      })

      map.on('mouseenter', 'countries-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('click', 'countries-fill', (event) => {
        const countryId = String(event.features?.[0]?.properties?.id ?? '')
        const country = countryMetricsRef.current.find((entry) => entry.id === countryId)
        if (country) {
          setSelectedCountry(country)
          setRefreshProposal(null)
          setRefreshError(null)
        }
      })

      map.on('mousemove', 'countries-fill', (event) => {
        const feature = event.features?.[0]
        if (!feature?.properties) return
        hoverPopup.setLngLat(event.lngLat).setDOMContent(buildPopupContent(feature.properties, mapModeRef.current)).addTo(map)
      })

      map.on('mouseleave', 'countries-fill', () => {
        map.getCanvas().style.cursor = ''
        hoverPopup.remove()
      })

      fetchMapData(snapshotRef.current, gameFilterRef.current)
        .then(({ enrichedContinents, continentLabels }) => {
          applyContinentColoring(map, enrichedContinents, continentLabels, mapModeRef.current)
        })
        .catch((error) => {
          console.error(error)
        })
    })

    mapRef.current = map

    return () => {
      if (rotationFrame != null) cancelAnimationFrame(rotationFrame)
      canvas.removeEventListener('mousedown', noteUserInteraction)
      canvas.removeEventListener('touchstart', noteUserInteraction)
      canvas.removeEventListener('wheel', noteUserInteraction)
      map.remove()
      mapRef.current = null
    }
  }, [])

  const reloadVisibleData = async (countryId: string) => {
    const map = mapRef.current
    const continentId = currentContinentIdRef.current
    if (!map || !continentId) return

    const [{ enrichedContinents, continentLabels }, countryMetrics] = await Promise.all([
      fetchMapData(snapshotId, gameFilterRef.current),
      fetchContinentCountries(continentId, snapshotId),
    ])

    applyContinentColoring(map, enrichedContinents, continentLabels, mapModeRef.current)
    countryMetricsRef.current = countryMetrics
    applyCountryColoring(map, countryMetrics, gameFilterRef.current, mapModeRef.current)
    setSelectedCountry(countryMetrics.find((country) => country.id === countryId) ?? null)
  }

  const handleRequestRefresh = async () => {
    if (!selectedCountry || snapshotId !== '2026-07-18') return
    setIsRefreshing(true)
    setRefreshError(null)

    try {
      const response = await fetch('/twin/refresh/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_id: selectedCountry.id }),
      })
      if (!response.ok) throw new Error('The agent could not create a refresh proposal.')
      setRefreshProposal((await response.json()) as RefreshProposal)
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Refresh proposal failed.')
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleApplyProposal = async () => {
    if (!selectedCountry || !refreshProposal) return
    setIsRefreshing(true)
    setRefreshError(null)

    try {
      const response = await fetch(`/twin/refresh/proposals/${encodeURIComponent(refreshProposal.id)}/apply`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('The proposed update could not be applied.')
      await reloadVisibleData(selectedCountry.id)
      setRefreshProposal(null)
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Applying the proposal failed.')
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleRejectProposal = async () => {
    if (!refreshProposal) return
    setIsRefreshing(true)
    setRefreshError(null)

    try {
      const response = await fetch(`/twin/refresh/proposals/${encodeURIComponent(refreshProposal.id)}/reject`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('The proposed update could not be rejected.')
      setRefreshProposal(null)
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Rejecting the proposal failed.')
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleBackToWorld = () => {
    const map = mapRef.current
    if (!map || !isCountryZoom) {
      return
    }

    map.setLayoutProperty('countries-fill', 'visibility', 'none')
    map.setLayoutProperty('countries-outline', 'visibility', 'none')
    map.setLayoutProperty('country-labels', 'visibility', 'none')
    currentContinentIdRef.current = null
    setSelectedCountry(null)
    setRefreshProposal(null)
    setRefreshError(null)

    map.once('moveend', () => {
      map.setLayoutProperty('continents-fill', 'visibility', 'visible')
      map.setLayoutProperty('continent-labels', 'visibility', 'visible')
      map.setProjection({ type: 'globe' })
      isCountryZoomRef.current = false
      setIsCountryZoom(false)
    })

    map.fitBounds(WORLD_BOUNDS, {
      padding: { top: 48, right: 48, bottom: 48, left: 48 },
      duration: 1400,
    })
  }

  return (
    <>
      <div ref={containerRef} className="h-full w-full" aria-label="World map" />
      {mapMode !== 'users' ? (
        <div className="fixed bottom-5 left-4 z-20 rounded-lg border border-slate-700/70 bg-slate-950/90 px-3 py-2 text-xs text-slate-300 shadow-lg backdrop-blur">
          <span className="font-semibold text-amber-300">Modeled</span>
          <span className="ml-2">{mapMode === 'potential' ? 'opportunity estimate' : 'infrastructure scenario — not telemetry'}</span>
        </div>
      ) : null}
      {isCountryZoom ? (
        <button
          type="button"
          onClick={handleBackToWorld}
          className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full border border-slate-500/50 bg-slate-900/90 px-5 py-2 text-sm font-semibold text-slate-100 shadow-lg backdrop-blur hover:bg-slate-800"
        >
          Back to world view
        </button>
      ) : null}
      {selectedCountry ? (
        <CountryDetailPanel
          country={selectedCountry}
          gameFilter={gameFilter}
          canRefresh={snapshotId === '2026-07-18'}
          proposal={refreshProposal}
          isRefreshing={isRefreshing}
          refreshError={refreshError}
          onRequestRefresh={handleRequestRefresh}
          onApplyProposal={handleApplyProposal}
          onRejectProposal={handleRejectProposal}
          onClose={() => {
            setSelectedCountry(null)
            setRefreshProposal(null)
            setRefreshError(null)
          }}
        />
      ) : null}
    </>
  )
}
