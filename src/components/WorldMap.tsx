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
}

type CountryMetric = {
  id: string
  name: string
  continent_id: string
  total_users: number
  confidence: number
  growth_rate_30d: number
  games: Array<{
    id: string
    name: string
    users: number
  }>
}

export type GameFilter = 'all' | string

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
      },
    }
  })

  return {
    type: 'FeatureCollection' as const,
    features,
  }
}

const fetchMapData = async () => {
  const [continentsResponse, metricsResponse] = await Promise.all([
    fetch('/continents.geojson'),
    fetch('/twin/continents'),
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

const fetchContinentCountries = async (continentId: string) => {
  const response = await fetch(`/twin/countries?continent=${encodeURIComponent(continentId)}`)

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
        },
      }
    })

  return {
    type: 'FeatureCollection' as const,
    features,
  }
}

const applyCountryColoring = (map: MapLibreMap, countryMetrics: CountryMetric[], gameFilter: GameFilter) => {
  const countrySource = map.getSource('countries') as GeoJSONSource | undefined
  countrySource?.setData(buildCountryFeatureCollection(countryMetrics, gameFilter) as any)

  const nonZeroUsers = countryMetrics
    .map((entry) => getDisplayUsers(entry, gameFilter))
    .filter((value) => value > 0)
  const minUsers = nonZeroUsers.length ? Math.min(...nonZeroUsers) : 0
  const maxUsers = nonZeroUsers.length ? Math.max(...nonZeroUsers) : 1
  const safeMaxUsers = maxUsers <= minUsers ? minUsers + 1 : maxUsers

  map.setPaintProperty('countries-fill', 'fill-color', [
    'case',
    ['==', ['get', 'display_users'], 0],
    'rgba(0, 0, 0, 0)',
    userConfidenceColorScale(minUsers, safeMaxUsers, 'display_users'),
  ] as any)
}

const numberFormatter = new Intl.NumberFormat('en-US')

const buildPopupContent = (properties: Record<string, any>) => {
  const container = document.createElement('div')
  const title = document.createElement('div')
  title.textContent = String(properties.name ?? 'Unknown')
  title.style.fontSize = '14px'
  title.style.fontWeight = '700'
  title.style.marginBottom = '8px'
  container.appendChild(title)

  const rows = [
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
}

export function WorldMap({ gameFilter }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const countryMetricsRef = useRef<CountryMetric[]>([])
  const gameFilterRef = useRef(gameFilter)
  const [isCountryZoom, setIsCountryZoom] = useState(false)

  useEffect(() => {
    gameFilterRef.current = gameFilter
    const map = mapRef.current
    if (map?.isStyleLoaded() && countryMetricsRef.current.length) {
      applyCountryColoring(map, countryMetricsRef.current, gameFilter)
    }
  }, [gameFilter])

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

    map.on('load', () => {
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
          'line-color': continentOutlineColor,
          'line-width': 1,
          'line-opacity': [
            'case',
            ['==', ['get', 'total_users'], 0],
            0.72,
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
          'line-color': '#7f8ca3',
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

        const countriesRequest = fetchContinentCountries(continentId)

        const geometryBounds = getBoundsFromGeometry(clickedFeature.geometry)
        if (!geometryBounds) {
          return
        }

        const camera = map.cameraForBounds(geometryBounds.bounds, {
          padding: { top: 72, right: 72, bottom: 72, left: 72 },
        })

        map.once('moveend', () => {
          countriesRequest
            .then((countryMetrics) => {
              countryMetricsRef.current = countryMetrics
              applyCountryColoring(map, countryMetrics, gameFilterRef.current)

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
        hoverPopup.setLngLat(event.lngLat).setDOMContent(buildPopupContent(feature.properties)).addTo(map)
      })

      map.on('mouseleave', 'continents-fill', () => {
        map.getCanvas().style.cursor = ''
        hoverPopup.remove()
      })

      map.on('mouseenter', 'countries-fill', () => {
        map.getCanvas().style.cursor = 'default'
      })

      map.on('mousemove', 'countries-fill', (event) => {
        const feature = event.features?.[0]
        if (!feature?.properties) return
        hoverPopup.setLngLat(event.lngLat).setDOMContent(buildPopupContent(feature.properties)).addTo(map)
      })

      map.on('mouseleave', 'countries-fill', () => {
        map.getCanvas().style.cursor = ''
        hoverPopup.remove()
      })

      fetchMapData()
        .then(({ enrichedContinents, continentLabels }) => {
          const continentSource = map.getSource('continents') as GeoJSONSource | undefined
          continentSource?.setData(enrichedContinents as any)

          const nonZeroUsers = enrichedContinents.features
            .map((feature) => Number(feature.properties.total_users ?? 0))
            .filter((value) => value > 0)
          const minUsers = nonZeroUsers.length ? Math.min(...nonZeroUsers) : 0
          const maxUsers = nonZeroUsers.length ? Math.max(...nonZeroUsers) : 1
          const safeMaxUsers = maxUsers <= minUsers ? minUsers + 1 : maxUsers
          map.setPaintProperty('continents-fill', 'fill-color', [
            'case',
            ['==', ['get', 'total_users'], 0],
            'rgba(0, 0, 0, 0)',
            userConfidenceColorScale(minUsers, safeMaxUsers),
          ] as any)

          const labelSource = map.getSource('continent-labels') as GeoJSONSource | undefined
          labelSource?.setData(continentLabels as any)
        })
        .catch((error) => {
          console.error(error)
        })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  const handleBackToWorld = () => {
    const map = mapRef.current
    if (!map || !isCountryZoom) {
      return
    }

    map.setLayoutProperty('countries-fill', 'visibility', 'none')
    map.setLayoutProperty('countries-outline', 'visibility', 'none')
    map.setLayoutProperty('country-labels', 'visibility', 'none')

    map.once('moveend', () => {
      map.setLayoutProperty('continents-fill', 'visibility', 'visible')
      map.setLayoutProperty('continent-labels', 'visibility', 'visible')
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
      {isCountryZoom ? (
        <button
          type="button"
          onClick={handleBackToWorld}
          className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full border border-slate-500/50 bg-slate-900/90 px-5 py-2 text-sm font-semibold text-slate-100 shadow-lg backdrop-blur hover:bg-slate-800"
        >
          Back to world view
        </button>
      ) : null}
    </>
  )
}
