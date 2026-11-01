/** Chart time windows. `ms: null` = everything. */
export const TIME_PERIODS = [
  { value: '1h', ms: 1 * 3600_000 },
  { value: '6h', ms: 6 * 3600_000 },
  { value: '24h', ms: 24 * 3600_000 },
  { value: '7d', ms: 7 * 24 * 3600_000 },
  { value: 'All', ms: null },
] as const;
export type PeriodValue = (typeof TIME_PERIODS)[number]['value'];
