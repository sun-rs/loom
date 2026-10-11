// EOF starts normal native shutdown, not cancellation. Never substitute a
// signal-induced zero exit for clean shutdown once this deadline has expired.
export async function waitForKimiEofExit(processExited) {
  let timer;
  try {
    return await Promise.race([
      processExited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Kimi did not exit within 5000ms after EOF")),
          5_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
