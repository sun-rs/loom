// Installed Kimi 2.1.1 with MCP took 6.3s to exit after EOF even without
// a model request. Allow native resource cleanup a bounded 15s window.
// EOF starts normal native shutdown, not cancellation. Never substitute a
// signal-induced zero exit for clean shutdown once this deadline has expired.
export async function waitForKimiEofExit(processExited) {
  let timer;
  try {
    return await Promise.race([
      processExited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Kimi did not exit within 15000ms after EOF")),
          15_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
