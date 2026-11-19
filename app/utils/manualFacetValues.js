// Canonical storage is string[]. Read compatibility accepts the older JSON
// array string and comma/newline list, including quoted commas and quotes.
export function normalizeManualValues(value) {
  if (value == null) return [];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      try { value = JSON.parse(text); }
      catch { throw new Error('Manual values must be a list of text values.'); }
    } else {
      const values = [];
      let field = '', quoted = false, closed = false, wasQuoted = false;
      const finish = () => { const item = wasQuoted ? field : field.trim(); if (item || wasQuoted) values.push(item); field = ''; closed = false; wasQuoted = false; };
      for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (quoted) {
          if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
          else if (character === '"') { quoted = false; closed = true; }
          else field += character;
        } else if (character === ',' || character === '\n' || character === '\r') {
          finish();
          if (character === '\r' && text[index + 1] === '\n') index++;
        } else if (character === '"' && !field.trim() && !closed) {
          field = ''; quoted = true; wasQuoted = true;
        } else if (closed) {
          if (character.trim()) throw new Error('Manual values contain an invalid quoted list.');
        } else field += character;
      }
      if (quoted) throw new Error('Manual values contain an unclosed quote.');
      finish();
      value = values;
    }
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw new Error('Manual values must be a list of text values.');
  return value.slice();
}

export function normalizeManualFacetConfig(value, {strict = false} = {}) {
  let config;
  try {
    config = typeof value === 'string' ? JSON.parse(value) : value ?? {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Filter configuration must be an object.');
    if (!Object.prototype.hasOwnProperty.call(config, 'manualValues')) return config;
    if (!strict && config.manualValuesInvalid) return {...config, manualValues: [], manualValuesInvalid: true};
    const result = {...config, manualValues: normalizeManualValues(config.manualValues)};
    delete result.manualValuesInvalid;
    return result;
  } catch (error) {
    if (strict) throw new Error(error instanceof SyntaxError ? 'Filter configuration must be valid JSON.' : error.message);
    // A malformed saved allow-list must neither crash nor broaden its values.
    return {...(config && typeof config === 'object' && !Array.isArray(config) ? config : {}), manualValues: [], manualValuesInvalid: true};
  }
}

export function normalizeManualFacetFilter(filter) {
  if (filter?.config == null) return filter;
  const config = normalizeManualFacetConfig(filter.config);
  return Object.prototype.hasOwnProperty.call(config, 'manualValues') ? {...filter, config} : filter;
}
