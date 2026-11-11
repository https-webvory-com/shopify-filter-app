export const FILTER_WIDTH_LIMITS = {min:240,max:600,default:420};
export const FILTER_WIDTH_KEYS = ['drawerWidth','verticalFilterWidth'];

export function isValidFilterWidth(value) {
  const width = Number(value);
  return Number.isInteger(width) && width >= FILTER_WIDTH_LIMITS.min && width <= FILTER_WIDTH_LIMITS.max;
}

export function normalizeFilterWidth(value) {
  return isValidFilterWidth(value) ? Number(value) : FILTER_WIDTH_LIMITS.default;
}
