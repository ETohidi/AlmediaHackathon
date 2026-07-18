export const USER_COLOR_RANGE = {
  lowConfidence: {
    low: '#D5F5F1',
    high: '#EADCF8',
  },
  highConfidence: {
    low: '#0F766E',
    high: '#581C87',
  },
} as const

type ColorRange = { low: string; high: string }

export const userColorScale = (
  minValue: number,
  maxValue: number,
  property = 'total_users',
  range: ColorRange = USER_COLOR_RANGE.highConfidence,
) => [
  'interpolate',
  ['linear'],
  ['get', property],
  minValue,
  range.low,
  maxValue,
  range.high,
] as const

export const userConfidenceColorScale = (minValue: number, maxValue: number, property = 'total_users') => [
  'interpolate',
  ['linear'],
  ['coalesce', ['get', 'confidence'], 0.3],
  0.3,
  userColorScale(minValue, maxValue, property, USER_COLOR_RANGE.lowConfidence),
  1,
  userColorScale(minValue, maxValue, property, USER_COLOR_RANGE.highConfidence),
] as const
