import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { userColorScale } from '../lib/colorScale'

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
}

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

const continentFillColorExpression: any = [
  'case',
  ['==', ['get', 'total_users'], 0],
  'rgba(0, 0, 0, 0)',
  userColorScale(69000, 941000),
]

const continentFillOpacityExpression: any = [
  'case',
  ['==', ['get', 'total_users'], 0],
  0,
  ['interpolate', ['linear'], ['coalesce', ['get', 'confidence'], 0.3], 0.3, 0.35, 0.65, 0.72, 1, 1],
]

const continentOutlineColor = '#4b5563'

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

export function WorldMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)

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

      map.fitBounds(WORLD_BOUNDS, {
        padding: { top: 48, right: 48, bottom: 48, left: 48 },
        duration: 0,
      })

      map.on('click', 'continents-fill', (event) => {
        const clickedFeature = event.features?.[0] as GeoJsonFeature | undefined
        if (!clickedFeature?.geometry) {
          return
        }

        const geometryBounds = getBoundsFromGeometry(clickedFeature.geometry)
        if (!geometryBounds) {
          return
        }

        const camera = map.cameraForBounds(geometryBounds.bounds, {
          padding: { top: 72, right: 72, bottom: 72, left: 72 },
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

      map.on('mouseleave', 'continents-fill', () => {
        map.getCanvas().style.cursor = ''
      })

      fetchMapData()
        .then(({ enrichedContinents, continentLabels }) => {
          const continentSource = map.getSource('continents') as GeoJSONSource | undefined
          continentSource?.setData(enrichedContinents as any)

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

  return <div ref={containerRef} className="h-full w-full" aria-label="World map" />
}
