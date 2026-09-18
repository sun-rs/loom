/** Pure helpers for the shared render-failure boundary. They stay separate from
 *  the JSX owner so the sanitizing and reset rules are unit-testable without a
 *  browser: the boundary itself must not own message, draft or selection state. */

export const SURFACE_RECOVERY_RETRY_LABEL = "重试此区域";
export const SURFACE_RECOVERY_RELOAD_LABEL = "重新加载";
const REDACTED = "[已脱敏]";
const MAX_DIAGNOSTIC = 200;

// SurfaceErrorBoundary reports the sanitized error. React's default reporter
// would log the original exception again, bypassing that redaction.
export const SURFACE_ROOT_ERROR_OPTIONS = { onCaughtError: () => {} };

const REDACTIONS: readonly RegExp[] = [
  /\bbearer\s+\S+/gi,
  /\b(token|secret|password|passphrase|api[_-]?key|authorization|cookie|session)\b\s*[=:]\s*\S+/gi,
  /\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b[A-Za-z0-9_-]{24,}\b/g,
];

/** Error name plus message only. Stacks, frames and credential-shaped
 *  fragments never reach the recovery panel or the console. */
export function sanitizeSurfaceDiagnostic(error: unknown): string {
  const name =
    error instanceof Error &&
    typeof error.name === "string" &&
    error.name !== ""
      ? error.name
      : "Error";
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error === undefined || error === null
          ? ""
          : String(error);
  const message = raw.replace(/\s+/g, " ").trim();
  let text = `${name}: ${message === "" ? "未知渲染错误" : message}`.replace(
    /\s+/g,
    " ",
  );
  for (const pattern of REDACTIONS)
    text = text.replace(pattern, (match) =>
      pattern.source.includes("[=:]")
        ? `${match.replace(/\s*[=:]\s*[\s\S]*$/, "")}${match.includes("=") ? "=" : ": "}${REDACTED}`
        : REDACTED,
    );
  return text.length > MAX_DIAGNOSTIC
    ? `${text.slice(0, MAX_DIAGNOSTIC - 1)}…`
    : text;
}

export type SurfaceBoundaryState = {
  diagnostic: string | undefined;
  resetKey?: string | undefined;
};

export function boundaryStateFromError(error: unknown): SurfaceBoundaryState {
  return { diagnostic: sanitizeSurfaceDiagnostic(error) };
}

/** Props-only reset: a new resetKey clears the failure, an unchanged one must
 *  not, or a failing child would re-render forever. */
export function boundaryStateForProps(
  state: SurfaceBoundaryState,
  resetKey: string | undefined,
): SurfaceBoundaryState | null {
  return state.resetKey === resetKey
    ? null
    : { diagnostic: undefined, resetKey };
}
