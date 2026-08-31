// An AbortSignal alone is insufficient: transports can settle after cancellation.
export function createLatestRequest() {
  let generation = 0;
  let controller: AbortController | undefined;
  return {
    begin(valid = () => true) {
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      const ticket = ++generation;
      return {
        signal: currentController.signal,
        cancel: () => currentController.abort(),
        // Cleanup belongs to this action even when its destination was invalidated.
        // A newer begin/cancel revokes that ownership as well.
        owns: () => ticket === generation,
        current: () =>
          ticket === generation && !currentController.signal.aborted && valid(),
      };
    },
    cancel() {
      generation++;
      controller?.abort();
    },
  };
}
