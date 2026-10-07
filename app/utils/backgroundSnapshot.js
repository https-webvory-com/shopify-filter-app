// Cold or expired snapshots refresh once in the background; readers never
// await the expensive refresh and can keep using the last successful value.
export function createBackgroundSnapshot({ read, write, refresh, now = Date.now, maxAge = 300000, retryAfter = 30000, onError = console.error }) {
  const states = new Map();
  return async function getSnapshot(key, context) {
    let state = states.get(key);
    if (!state) {
      state = { value: null, updatedAt: 0, retryAt: 0, pending: null };
      states.set(key, state);
      state.loading = Promise.resolve().then(() => read(key)).then(saved => {
        if (saved) { state.value = saved.value; state.updatedAt = saved.updatedAt; }
      }).catch(onError);
    }
    await state.loading;
    if (!state.pending && now() >= state.retryAt && (!state.updatedAt || now() - state.updatedAt >= maxAge)) {
      state.pending = Promise.resolve().then(() => refresh(context)).then(async value => {
        state.value = value;
        state.updatedAt = now();
        await write(key, { value, updatedAt: state.updatedAt });
      }).catch(error => { state.retryAt = now() + retryAfter; onError(error); }).finally(() => { state.pending = null; });
    }
    return { value: state.value, status: state.value === null ? "refreshing" : state.pending ? "stale" : "ready" };
  };
}
