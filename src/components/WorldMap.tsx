import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

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
        'background-color': '#ffffff',
      },
    },
  ],
}

type ContinentMetric = {
  id: string
  name: string
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

const continentFillColorExpression: any = [
  'case',
  ['==', ['get', 'total_users'], 0],
  'rgba(0, 0, 0, 0)',
  ['>=', ['get', 'confidence'], 0.88],
  ['interpolate', ['linear'], ['get', 'total_users'], 1, '#dbeafe', 250000, '#93c5fd', 600000, '#3b82f6', 1000000, '#1d4ed8'],
  ['>=', ['get', 'confidence'], 0.75],
  ['interpolate', ['linear'], ['get', 'total_users'], 1, '#e8f0ff', 250000, '#b8d0ff', 600000, '#69a0f3', 1000000, '#3d74d9'],
  ['interpolate', ['linear'], ['get', 'total_users'], 1, '#f0f5ff', 250000, '#d4e1ff', 600000, '#9abcf4', 1000000, '#6f92d1'],
]

const continentLabelCenters: Record<string, [number, number]> = {
  europe: [16, 54],
  'north-america': [-101, 45],
  'south-america': [-60, -20],
  asia: [95, 35],
  africa: [20, 5],
  oceania: [138, -24],
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

const buildLabelFeatureCollection = (features: GeoJsonFeature[]) => {
  const labelFeatures = features
    .map((feature) => {
      const featureId = String(feature.properties?.id ?? '')
      const fixedCenter = continentLabelCenters[featureId]
      if (fixedCenter) {
        return {
          type: 'Feature' as const,
          properties: {
            id: feature.properties.id,
            name: feature.properties.name,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: fixedCenter,
          },
        }
      }

      const points: Array<[number, number]> = []
      collectPositions(feature.geometry.coordinates, points)

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
        type: 'Feature' as const,
        properties: {
          id: feature.properties.id,
          name: feature.properties.name,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
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
  const continentLabels = buildLabelFeatureCollection(enrichedContinents.features)

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
      interactive: false,
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
          'fill-opacity': 1,
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
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      })

      map.fitBounds(WORLD_BOUNDS, {
        padding: { top: 48, right: 48, bottom: 48, left: 48 },
        duration: 0,
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
