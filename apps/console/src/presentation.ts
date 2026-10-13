import { el } from "./dom.ts";

/** Name-based display filter only, never an authority to delete or stop work. */
export function isTestRecord(name: string): boolean {
  return /^(?:e2e[- ]|smoke[- ]|console-gate[- ]|p\d+[- ](?:codex|claude|kimi|deepseek|opencode|held|task)\b|auth-fixed-|first-wake-check-|task-policy-acceptance-|sonnet-fresh-|claude-kimi-check-|value-0930-|value codex |disc-(?:sol|astra)(?:-|$))/i.test(
    name,
  );
}

export function disclosure(
  title: string,
  children: readonly HTMLElement[],
  id?: string,
): HTMLDetailsElement {
  return el(
    "details",
    { className: "disclosure", ...(id === undefined ? {} : { attrs: { id } }) },
    [el("summary", { text: title }), ...children],
  );
}

export function friendlyCli(id: string): string {
  return (
    /(?:^|[-:])(claude|codex|opencode|kimi|pi)(?:$|[-:])/i.exec(id)?.[1] ?? id
  );
}
