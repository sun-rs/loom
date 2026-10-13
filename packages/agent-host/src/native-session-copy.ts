import { copyOpenCodeSession } from "./opencode-session-fork.ts";
import { copyCodexSession } from "./codex-session-fork.ts";

/** Provider-neutral Host boundary. Only native context and its opaque new ID cross it.
 * Membership, Role snapshots, Side grants and execution lanes remain Kernel-owned.
 */
export type NativeSessionCopyInput = Readonly<{
  executable: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  sourceId: string;
}>;
export type NativeSessionCopyAdapter = Readonly<{
  provider: string;
  copy: (input: NativeSessionCopyInput) => Promise<string>;
}>;
const adapters: Readonly<Record<string, NativeSessionCopyAdapter>> =
  Object.freeze({
    "opencode-server/v1": {
      provider: "opencode-server/v1",
      copy: copyOpenCodeSession,
    },
    "codex-app-server/v1": {
      provider: "codex-app-server/v1",
      copy: copyCodexSession,
    },
  });
/** Unknown adapters refuse; never silently start an empty replacement session. */
export function nativeSessionCopyAdapter(
  kind: string,
): NativeSessionCopyAdapter | undefined {
  return Object.hasOwn(adapters, kind) ? adapters[kind] : undefined;
}
