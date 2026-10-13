import { copyKimiSession } from "./kimi-session-fork.ts";
import { copyPiSession } from "./pi-session-fork.ts";
import { isSea } from "node:sea";
import { copyClaudeSession } from "./claude-session-fork.ts";
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
  /** Host-owned native storage; never provided by the client or model. */
  supervisorDirectory?: string;
}>;
export type NativeSessionCopyAdapter = Readonly<{
  provider: string;
  copy: (input: NativeSessionCopyInput) => Promise<string>;
}>;
const adapters: Readonly<Record<string, NativeSessionCopyAdapter>> =
  Object.freeze({
    "kimi-acp/v1": { provider: "kimi-acp/v1", copy: copyKimiSession },
    "pi-print-json/v1": { provider: "pi-print-json/v1", copy: copyPiSession },
    "claude-stream-json/v1": {
      provider: "claude-stream-json/v1",
      copy: copyClaudeSession,
    },
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
  // The SDK storage helper ships with the Node distribution, not the frozen SEA assets.
  if (["claude-stream-json/v1", "pi-print-json/v1"].includes(kind) && isSea())
    return undefined;
  return Object.hasOwn(adapters, kind) ? adapters[kind] : undefined;
}
