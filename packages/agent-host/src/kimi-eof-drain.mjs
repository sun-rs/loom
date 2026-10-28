// Kimi 2.1.1 zero-model probes took up to 18.9s in native append-log
// retirement after EOF. Allow that durable cleanup a bounded 30s window;
// session/close alone does not remove this application-level drain.
// EOF starts normal native shutdown, not cancellation. Never substitute a
// signal-induced zero exit for clean shutdown once this deadline has expired.
export async function waitForKimiEofExit(processExited) {
  let timer;
  try {
    return await Promise.race([
      processExited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Kimi did not exit within 30000ms after EOF")),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
