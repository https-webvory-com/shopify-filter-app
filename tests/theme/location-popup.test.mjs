import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../theme-fixes/uk/assets/lang.js', import.meta.url), 'utf8');
function fixture({readyState = 'complete', country = 'GB', languages, blockedStorage = false} = {}) {
  const nodes = new Map(), listeners = new Map(), timers = new Map(), storage = new Map();
  let writes = 0, nextTimer = 0;
  const document = {
    readyState, querySelector: selector => nodes.get(selector) || null,
    addEventListener(name, fn, options) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push({fn, once: !!options?.once});
    }
  };
  const context = vm.createContext({window: {Shopify: {country}}, document,
    localStorage: {
      getItem: key => {if (blockedStorage) throw Error('Storage disabled');return storage.get(key);},
      setItem: (key, value) => {if (blockedStorage) throw Error('Storage disabled');writes++;storage.set(key, value);}
    },
    setInterval: fn => {const id = ++nextTimer;timers.set(id, fn);return id;},
    clearInterval: id => timers.delete(id),
    ...(languages ? {metaLanguages: languages} : {})
  });
  const run = () => vm.runInContext(source, context);
  const emit = (name, target) => {
    for (const listener of [...(listeners.get(name) || [])]) {
      listener.fn({target});
      if (listener.once) listeners.set(name, listeners.get(name).filter(item => item !== listener));
    }
  };
  return {nodes, listeners, timers, storage, context, run, emit, writes: () => writes};
}
const control = {closest: selector => selector.includes('#close_location_popup') ? {} : null};

test('search pages without any popup controls initialize and remain safe to close/show', () => {
  const f = fixture();f.run();f.context.window.showLocationPopup();f.context.window.closeLocationPopup();
  f.emit('click', control);f.emit('shopify:section:load');
  assert.equal(f.writes(), 0);assert.equal(f.timers.size, 0);
});

test('initializes after DOMContentLoaded when loaded before popup markup', () => {
  const f = fixture({readyState: 'loading'});f.run();
  const popup = {style: {display: 'none'}};f.nodes.set('.location_popup', popup);
  f.emit('DOMContentLoaded');assert.equal(popup.style.display, 'block');
  assert.equal(f.listeners.get('DOMContentLoaded').length, 0);
});

test('late-loaded script initializes immediately and respects seven-day dismissal', () => {
  const f = fixture();const popup = {style: {}};f.nodes.set('.location_popup', popup);
  f.storage.set('location_popup_closed', new Date().toISOString());f.run();
  assert.equal(popup.style.display, 'none');
  f.storage.set('location_popup_closed', new Date(Date.now() - 8 * 86400000).toISOString());
  f.context.window.showLocationPopup();assert.equal(popup.style.display, 'block');
});

test('script reruns and section rerenders retain one close handler for replacement controls', () => {
  const f = fixture();f.run();f.run();f.run();
  for (let i = 0; i < 3; i++) {
    const popup = {style: {display: 'block'}};f.nodes.set('.location_popup', popup);
    f.emit('shopify:section:load');f.emit('click', control);
    assert.equal(popup.style.display, 'none');assert.equal(f.writes(), i + 1);
  }
  assert.equal(f.listeners.get('click').length, 1);
  assert.equal(f.listeners.get('shopify:section:load').length, 1);
});

test('unrelated search/filter clicks never close the popup', () => {
  const f = fixture();const popup = {style: {display: 'block'}};f.nodes.set('.location_popup', popup);f.run();
  f.emit('click', {closest: () => null});f.emit('click', null);
  assert.equal(popup.style.display, 'block');assert.equal(f.writes(), 0);
});

test('US popup behavior remains unchanged and blocked storage does not break controls', () => {
  const us = fixture({country: 'US'}), popup = {style: {display: 'none'}};
  us.nodes.set('.location_popup', popup);us.run();assert.equal(popup.style.display, 'none');
  const f = fixture({blockedStorage: true});f.nodes.set('.location_popup', popup);f.run();
  assert.equal(popup.style.display, 'block');f.emit('click', control);assert.equal(popup.style.display, 'none');
});

test('country helper, icons and delayed cookie banner survive repeated initialization with one timer', () => {
  const f = fixture({languages: {GB: {main_text: 'UK shipping', icon_1: 'Delivery', cookie_text: '<b>Cookies</b>'}}});
  const helper = {}, icon = {};f.nodes.set('.location_popup_text', helper);f.nodes.set('#loc_popup-icon-1 .item_title', icon);
  f.run();f.run();f.emit('shopify:section:load');f.emit('shopify:section:load');
  assert.equal(helper.innerText, 'UK shipping');assert.equal(icon.innerText, 'Delivery');assert.equal(f.timers.size, 1);
  const cookie = {};f.nodes.set('.shopify-pc__banner__body p', cookie);[...f.timers.values()][0]();
  assert.equal(cookie.innerHTML, '<b>Cookies</b>');assert.equal(f.timers.size, 0);
});
