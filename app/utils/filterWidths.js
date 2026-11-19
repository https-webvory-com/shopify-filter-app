export const FILTER_WIDTH_LIMITS = {min:240,max:600,default:420};
// Retain the former mobile vertical key for cached admin clients only.
export const FILTER_WIDTH_KEYS = ['drawerWidth','verticalFilterWidth','mobileDrawerWidth','mobileHorizontalFilterWidth','mobileVerticalFilterWidth'];

export function isValidFilterWidth(value) {
  const width = Number(value);
  return Number.isInteger(width) && width >= FILTER_WIDTH_LIMITS.min && width <= FILTER_WIDTH_LIMITS.max;
}

export function normalizeFilterWidth(value,key) {
  return isValidFilterWidth(value) ? Number(value) : key==='mobileHorizontalFilterWidth'?300:FILTER_WIDTH_LIMITS.default;
}
