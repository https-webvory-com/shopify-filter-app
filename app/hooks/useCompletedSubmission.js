import {useEffect, useRef} from 'react';

// Action data can arrive before loader revalidation ends. Consume each result
// once, after the request becomes idle, rather than announcing an unfinished save.
export function useCompletedSubmission(result, state, onComplete) {
  const handled = useRef();
  const callback = useRef(onComplete);
  callback.current = onComplete;
  useEffect(() => {
    if (state !== 'idle' || !result || handled.current === result) return;
    handled.current = result;
    callback.current(result);
  }, [result, state]);
}
