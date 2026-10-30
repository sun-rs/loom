/** Lost hints recover by reading the SDK; this owns no delivery cursor or mutation. */
export function installReadRecovery(
  refresh: () => Promise<unknown>,
  port: {
    visible(): boolean;
    every(fn: () => void): () => void;
    listen(name: string, fn: () => void): () => void;
  },
) {
  let disposed = false,
    busy = false;
  const run = () => {
    if (disposed || busy || !port.visible()) return;
    busy = true;
    void refresh()
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  };
  const clean = [
    port.every(run),
    ...["focus", "online", "pageshow", "visibilitychange"].map((name) =>
      port.listen(name, run),
    ),
  ];
  run();
  return () => {
    disposed = true;
    for (const stop of clean) stop();
  };
}
