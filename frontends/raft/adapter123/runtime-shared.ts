/** Native form APIs, with Loom's runtime admission policy; no presentation recipes. */
export * from "../upstream/web-1.21.23/packages/shared/src/index.ts";
import {
  RUNTIMES,
  REASONING_EFFORT_RUNTIMES as originalEfforts,
} from "../upstream/web-1.21.23/packages/shared/src/index.ts";
const supported = new Set([
  "codex",
  "claude",
  "opencode",
  "pi",
  "kimi",
  "antigravity",
]);
export const REASONING_EFFORT_RUNTIMES = new Set([
  ...originalEfforts,
  "kimi",
  "antigravity",
  "opencode",
]);
export function getCreatableRuntimeOptions() {
  return RUNTIMES.filter((r) => supported.has(r.id)).map((r) => ({
    ...r,
    deprecated: false,
  }));
}
export function getExistingAgentRuntimeOptions(current: string) {
  return RUNTIMES.filter((r) => supported.has(r.id) || r.id === current).map(
    (r) => ({ ...r, deprecated: false }),
  );
}
export function isRuntimeDeprecated(runtime: string) {
  return (
    !supported.has(runtime) &&
    RUNTIMES.some((r) => r.id === runtime && r.deprecated)
  );
}
