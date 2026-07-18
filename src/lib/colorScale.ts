export const userColorScale = (minValue: number, maxValue: number) => [
  'interpolate',
  ['linear'],
  ['get', 'total_users'],
  minValue,
  '#B5D4F4',
  maxValue,
  '#26215C',
] as const
