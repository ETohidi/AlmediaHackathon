import { useEffect, useRef } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
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
        data: '/continents.geojson',
      })

      map.addLayer({
        id: 'continents-fill',
        type: 'fill',
        source: 'continents',
        paint: {
          'fill-color': '#cbd5e1',
          'fill-opacity': 0.95,
        },
      })

      map.fitBounds(WORLD_BOUNDS, {
        padding: { top: 48, right: 48, bottom: 48, left: 48 },
        duration: 0,
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
