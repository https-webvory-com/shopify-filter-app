const numericFields = new Set(['Price', 'Discount', 'Percent sales', 'Available', 'Rating']);
const text = value => value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);

export function normalizeCondition(c) {
  const numeric = numericFields.has(c.field);
  return {
    action: c.action, field: c.field,
    value: text(c.value),
    minValue: numeric ? text(c.minValue ?? c.value) : null,
    maxValue: text(c.maxValue ?? c.value2),
    operator: c.operator, operand: text(c.operand), dateValue: c.dateValue,
  };
}

export function validConditions(conditions) {
  return Array.isArray(conditions) && conditions.length > 0 && conditions.every(c => {
    if (!c.field?.trim() || !c.action?.trim()) return false;
    if (numericFields.has(c.field)) {
      const min = c.minValue ?? c.value;
      const max = c.maxValue ?? c.value2;
      const present = v => v != null && String(v).trim() !== '';
      return (present(min) || present(max)) &&
        (!present(min) || Number.isFinite(Number(min))) &&
        (!present(max) || Number.isFinite(Number(max))) &&
        !(present(min) && present(max) && Number(min) > Number(max));
    }
    if (c.field === 'Date') {
      const [start, end] = String(c.dateValue || '').split(' - ');
      return Boolean(start && end && Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && Date.parse(start) <= Date.parse(end));
    }
    return Array.isArray(c.value) ? c.value.length > 0 : Boolean(String(c.value ?? '').trim());
  });
}
