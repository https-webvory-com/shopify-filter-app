import { getCustomization } from '../services/customization.server.js';
import { normalizeThemeId } from '../utils/customization.js';
import { rateLimit } from '../services/rateLimiter.server';

const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const loader = async ({ request }) => {
  const url = new URL(request.url), shop = url.searchParams.get('shop') || '';
  let themeId;
  try {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) throw Error();
    themeId = normalizeThemeId(url.searchParams.get('themeId'));
  } catch { return Response.json({ error: 'Invalid shop or theme.' }, { status: 400, headers }); }
  if (!await rateLimit(request)) return Response.json({ error: 'Too many requests.' }, { status: 429, headers });
  const script = url.searchParams.get('asset') === 'javascript';
  try {
    const config = await getCustomization(shop, themeId);
    if (script) {
      const code = config?.enabled && config.javascriptEnabled ? config.javascript : '';
      return new Response(code ? `(function(){try{(function(){\n${code}\n}).call(window);}catch(error){console.error('[CFP Customization] Script failed', error);}})();` : '', { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } });
    }
    return Response.json({ customization: config?.enabled ? { css: config.css, swatches: config.swatches, javascriptEnabled: config.javascriptEnabled && !!config.javascript.trim() } : null }, { headers });
  } catch {
    // Customization must never prevent the existing widget from loading.
    return script ? new Response('', { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } }) : Response.json({ customization: null }, { headers });
  }
};
