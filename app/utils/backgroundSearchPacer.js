// Background preparation shares the search engine with shoppers. When the
// worker issued several large collection scans at once, shopper searches waited
// 0.5-1.4 s in the engine's queue (they waited ~5 ms while the ranking queue was
// paused). In the worker process only, send engine requests one at a time and
// rest after each for half as long as it took, so background work never holds
// more than about two thirds of one engine thread. Results and errors are unchanged.
export function createPacedFetch(baseFetch, origin, {restRatio = 0.5, maxRestMs = 1000, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  let slot = Promise.resolve();
  return function pacedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url !== 'string' || !url.startsWith(origin)) return baseFetch(input, init);
    let release;
    const response = slot.then(() => {
      const started = now();
      const request = Promise.resolve().then(() => baseFetch(input, init));
      // The next request may start only after this one ends plus its rest.
      release = request.then(() => {}, () => {}).then(() => sleep(Math.min(maxRestMs, Math.max(0, (now() - started) * restRatio))));
      return request;
    });
    slot = response.then(() => release, () => release);
    return response;
  };
}
