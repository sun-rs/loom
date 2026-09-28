import { realpath } from "node:fs/promises";

/**
 * Owner ruling 2026-09-28: Loom follows the user's stable CLI command. A CLI
 * that updates itself repoints its launcher (`~/.local/bin/claude` →
 * `versions/<new>`, Homebrew `bin/codex` → `Caskroom/codex/<new>`). Loom still
 * pins and verifies the exact file it spawns (process supervisor identity
 * check); this watcher only notices that the launcher now names another file
 * and asks the existing idle-only in-process restart
 * (`restartable-local-workbench.ts`) to rediscover and re-pin it. Busy means
 * "try again later": active work is never interrupted for an update.
 */
export type CliExecutableIdentity = {
  cliId: string;
  /** The PATH entry (the launcher), as the user's shell would run it. */
  launcherPath: string;
  /** The file it resolved to when this generation started. */
  resolvedPath: string;
};

export type CliUpdateTick = "unchanged" | "busy" | "accepted" | "stopped";

export function startCliUpdateWatcher(input: {
  identities: readonly CliExecutableIdentity[];
  /** 0 disables the timer (ticks are driven by the caller). */
  intervalMs: number;
  requestRestart: () => "accepted" | "busy" | "stale";
  resolve?: (launcherPath: string) => Promise<string | undefined>;
  onChange?: (cliId: string, from: string, to: string) => void;
}): { tick(): Promise<CliUpdateTick>; stop(): void } {
  const resolve =
    input.resolve ??
    (async (path: string) => {
      try {
        return await realpath(path);
      } catch {
        return undefined;
      }
    });
  let stopped = false;
  let running: Promise<CliUpdateTick> | undefined;
  const tick = async (): Promise<CliUpdateTick> => {
    if (stopped) return "stopped";
    let changed = false;
    for (const identity of input.identities) {
      const now = await resolve(identity.launcherPath);
      // A launcher briefly missing mid-update is not yet a new target.
      if (now === undefined || now === identity.resolvedPath) continue;
      changed = true;
      input.onChange?.(identity.cliId, identity.resolvedPath, now);
    }
    if (!changed) return "unchanged";
    const reply = input.requestRestart();
    if (reply === "busy") return "busy";
    stopped = true;
    clear();
    return "accepted";
  };
  const timer =
    input.intervalMs > 0
      ? setInterval(() => {
          running ??= tick().finally(() => {
            running = undefined;
          });
        }, input.intervalMs)
      : undefined;
  timer?.unref();
  function clear() {
    if (timer !== undefined) clearInterval(timer);
  }
  return {
    tick,
    stop() {
      stopped = true;
      clear();
    },
  };
}
