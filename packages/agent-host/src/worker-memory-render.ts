/**
 * evo S6 batch A: text rendering of `"$RAH_WORKER_CLI" worker memory <action>` results.
 * The index line mirrors the future standing index:
 * `- name [type] (rN[, pinned][, invalidated]) — description`.
 */
type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

function indexLine(entry: Json): string {
  const flags = [`r${String(entry.revision)}`];
  if (entry.pinned === true) flags.push("pinned");
  if (entry.state !== "active") flags.push(String(entry.state));
  return `- ${String(entry.name)} [${String(entry.type)}] (${flags.join(", ")}) — ${String(entry.description)}`;
}

function author(provenance: Json): string {
  const who =
    provenance.actorKind === "human"
      ? `Human ${String(provenance.actorPrincipalId)}`
      : `instance ${String(provenance.actorPrincipalId)}`;
  const details = [
    provenance.roleId ? `role ${String(provenance.roleId)}` : undefined,
    provenance.modelBindingId
      ? `model ${String(provenance.modelBindingId)}`
      : undefined,
    typeof provenance.sessionGeneration === "number"
      ? `session generation ${String(provenance.sessionGeneration)}`
      : undefined,
  ].filter((value) => value !== undefined);
  return `${who}${details.length ? ` (${details.join(", ")})` : ""} at ${String(provenance.recordedAt)}`;
}

function renderEntries(heading: string, result: Json, empty: string): string {
  const entries = Array.isArray(result.entries)
    ? result.entries.map(record)
    : [];
  if (entries.length === 0) return empty;
  const lines = [heading, ...entries.map(indexLine)];
  if (result.truncated === true)
    lines.push(
      typeof result.total === "number"
        ? `Showing ${entries.length} of ${String(result.total)}; narrow with memory search or raise --limit.`
        : "More matches exist; refine the query or raise --limit.",
    );
  return lines.join("\n");
}

function renderDetail(result: Json): string {
  const entry = record(result.entry);
  const provenance = record(entry.provenance);
  return [
    `## Memory ${String(entry.name)}`,
    indexLine(entry),
    `Written by: ${author(provenance)}`,
    "Provenance shows who wrote it, not that it is still true.",
    "",
    entry.body === null ? "(body deleted by a Human)" : String(entry.body),
  ].join("\n");
}

/** A change returns a receipt only; the content is read with `memory read`. */
function renderMutation(op: string, result: Json): string {
  const state = result.state === "active" ? "" : `, ${String(result.state)}`;
  return `Memory ${op}: ${String(result.name)} (revision ${String(result.revision)}${state})${result.deduplicated === true ? " — already applied; nothing new was written" : ""}`;
}

function renderHistory(result: Json): string {
  const entry = record(result.entry);
  const revisions = Array.isArray(result.revisions)
    ? result.revisions.map(record)
    : [];
  const lines = [`## Memory history ${String(entry.name)}`];
  for (const revision of revisions) {
    const provenance = record(revision.provenance);
    lines.push(
      `r${String(revision.revision)} ${String(revision.op)} by ${author(provenance)}${revision.reason ? ` — reason: ${String(revision.reason)}` : ""}`,
    );
  }
  if (result.truncated === true) lines.push("Older revisions are omitted.");
  return lines.join("\n");
}

export const WORKER_MEMORY_RENDERERS: Readonly<
  Record<string, (body: Json, result: Json) => string>
> = {
  "/v1/worker/memory/history": (_body, result) => renderHistory(result),
  "/v1/worker/memory/invalidate": (_body, result) =>
    renderMutation("invalidate", result),
  "/v1/worker/memory/list": (_body, result) =>
    renderEntries(
      `## Channel memory (${String(result.total ?? 0)})`,
      result,
      "No channel memory entries.",
    ),
  "/v1/worker/memory/read": (_body, result) => renderDetail(result),
  "/v1/worker/memory/restore": (_body, result) =>
    renderMutation("restore", result),
  "/v1/worker/memory/search": (body, result) =>
    renderEntries(
      `## Memory matches for "${String(body.query)}"`,
      result,
      `No active memory matches "${String(body.query)}".`,
    ),
  "/v1/worker/memory/update": (_body, result) =>
    renderMutation("update", result),
  "/v1/worker/memory/write": (_body, result) =>
    renderMutation("create", result),
};
