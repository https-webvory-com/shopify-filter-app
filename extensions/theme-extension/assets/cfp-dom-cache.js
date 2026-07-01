/**
 * CFP DOM Cache V2
 * Responsible for caching found DOM selectors in localStorage 
 * to speed up subsequent page loads.
 */

window.CFP_V2 = window.CFP_V2 || {};

window.CFP_V2.DOMCache = (function() {
  const CACHE_KEY = 'cfp_dom_selectors';

  return {
    get: (name) => {
      try {
        const data = localStorage.getItem(CACHE_KEY);
        const parsed = data ? JSON.parse(data) : {};
        return parsed[name] || null;
      } catch(e) { 
        return null; 
      }
    },
    
    set: (name, selector) => {
      try {
        const data = localStorage.getItem(CACHE_KEY);
        const parsed = data ? JSON.parse(data) : {};
        parsed[name] = selector;
        localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
      } catch(e) {}
    }
  };
})();
