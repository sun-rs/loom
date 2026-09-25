// Eighth review P2-3: retiring an `opencode serve` child returns an explicit
// exit proof ({code, signal}); SIGTERM, then SIGKILL, each bounded. Without a
// proof it throws, so a caller never starts a replacement server next to a
// possibly live old one (the whole warm runtime ends instead and the Host /
// janitor termination proof takes over).

/**
 * @param {{ child: { exitCode: number | null, signalCode: string | null, kill(signal: string): boolean }, exited: Promise<{ code: number | null, signal: string | null }> }} handle
 * @param {{ termTimeoutMs: number }} options
 */
export async function stopOpenCodeServer(handle, { termTimeoutMs }) {
  const proof = () =>
    handle.child.exitCode !== null || handle.child.signalCode !== null
      ? { code: handle.child.exitCode, signal: handle.child.signalCode }
      : undefined;
  const settled = proof();
  if (settled !== undefined) return settled;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      handle.child.kill(signal);
    } catch {
      // Judged by the exit proof below.
    }
    const exited = await Promise.race([
      handle.exited.then((exit) => exit),
      new Promise((resolve) => {
        setTimeout(() => resolve(undefined), termTimeoutMs).unref?.();
      }),
    ]);
    const current = exited ?? proof();
    if (current !== undefined) return current;
  }
  throw new Error(
    "OpenCode server did not exit after SIGTERM and SIGKILL; no exit proof",
  );
}
