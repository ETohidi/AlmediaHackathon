import countries110m from 'world-atlas/countries-110m.json'
import { feature } from 'topojson-client'

type CountryFeature = {
  type: 'Feature'
  id?: string | number
  properties?: Record<string, unknown>
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: unknown
  }
}

type CountryFeatureCollection = {
  type: 'FeatureCollection'
  features: CountryFeature[]
}

const SEEDED_COUNTRY_CODES = [
  'DE',
  'GB',
  'NL',
  'FR',
  'AT',
  'IT',
  'BE',
  'SE',
  'PL',
  'US',
  'CA',
  'JP',
  'KR',
  'CN',
  'AU',
] as const

const ISO2_TO_NUMERIC3: Readonly<Record<(typeof SEEDED_COUNTRY_CODES)[number], string>> = {
  DE: '276',
  GB: '826',
  NL: '528',
  FR: '250',
  AT: '040',
  IT: '380',
  BE: '056',
  SE: '752',
  PL: '616',
  US: '840',
  CA: '124',
  JP: '392',
  KR: '410',
  CN: '156',
  AU: '036',
}

const NUMERIC3_TO_ISO2 = new Map<string, string>(
  Object.entries(ISO2_TO_NUMERIC3).map(([iso2, numeric3]) => [numeric3, iso2]),
)

const worldCountries = feature(countries110m as any, (countries110m as any).objects.countries) as unknown as CountryFeatureCollection

const isPolygonLike = (featureEntry: CountryFeature) => {
  const geometryType = featureEntry.geometry?.type
  return geometryType === 'Polygon' || geometryType === 'MultiPolygon'
}

export const buildSeedCountryGeoJson = () => {
  const filtered = worldCountries.features
    .filter((featureEntry) => isPolygonLike(featureEntry))
    .map((featureEntry) => {
      const numericCode = String(featureEntry.id ?? '').padStart(3, '0')
      const iso2 = NUMERIC3_TO_ISO2.get(numericCode)
      if (!iso2) {
        return null
      }

      return {
        type: 'Feature' as const,
        properties: {
          id: iso2,
          name: String(featureEntry.properties?.name ?? iso2),
        },
        geometry: featureEntry.geometry,
      }
    })
    .filter((featureEntry) => featureEntry !== null)

  return {
    type: 'FeatureCollection' as const,
    features: filtered,
  }
}
