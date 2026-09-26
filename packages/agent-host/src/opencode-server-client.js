// Shared by the per-turn and warm OpenCode drivers (drivers review P2-6): the
// pieces of the `opencode serve` client that were identical in both, plus the
// full review batch 3 child-session recovery. Wire shapes follow the installed
// OpenCode 1.18.32 (probed against a real `opencode serve --pure` with no
// model): `GET /session/:id` carries `parentID` for a child session, `GET
// /session/:id/children` lists direct children, and `GET /permission` / `GET
// /question` list the pending requests across all sessions (answering one
// already answered is 404 `PermissionNotFoundError`). Host-private
// observation only: nothing here is Room truth.

/**
 * The session rules both drivers create: every tool allowed, then the tools
 * that wait for a Human answer or switch the session into a native mode
 * denied — the same three denies OpenCode 1.18.32's own non-interactive
 * `opencode run` puts on its session. Evaluation is `findLast` over the agent
 * rules then these session rules, and a trailing `*` deny removes the tool
 * from the model's tool list, so a user config cannot re-open them (evo §40).
 */
export const OPENCODE_SESSION_PERMISSION = Object.freeze([
  Object.freeze({ action: "allow", pattern: "*", permission: "*" }),
  Object.freeze({ action: "deny", pattern: "*", permission: "question" }),
  Object.freeze({ action: "deny", pattern: "*", permission: "plan_enter" }),
  Object.freeze({ action: "deny", pattern: "*", permission: "plan_exit" }),
]);

const MAX_LINEAGE_DEPTH = 8;
const MAX_PRELOADED_CHILDREN = 64;

export function extractSseData(buffer) {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const items = blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim(),
    )
    .filter((value) => value !== "");
  return { items, remainder };
}

export function openCodeEventError(properties) {
  const error = record(properties.error);
  const data = record(error.data);
  return (
    [
      stringField(error, "name"),
      stringField(data, "message"),
      stringField(error, "message"),
    ]
      .filter((value) => value !== undefined)
      .join(": ") || "OpenCode session error"
  );
}

/**
 * The prompt's answer after an abort: the last assistant carries
 * `MessageAbortedError`, or still ends in `tool-calls` (the loop exits on its
 * own only with another finish, so a `tool-calls` answer means the run was
 * cut between steps).
 */
export function abortedByInterrupt(response) {
  if (!isRecord(response) || !isRecord(response.info)) return false;
  const error = record(response.info.error);
  if (stringField(error, "name") === "MessageAbortedError") return true;
  return (
    response.info.error === undefined && response.info.finish === "tool-calls"
  );
}

export function serverAuthHeader(environment = process.env) {
  const password = environment.OPENCODE_SERVER_PASSWORD;
  if (password === undefined || password === "") return undefined;
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

export async function safeResponseText(response) {
  return (await response.text().catch(() => "")).slice(0, 2_048);
}

/** The server's output tail, bounded to the last `maximum` bytes. */
export function boundedServerOutput(tail, chunk, maximum) {
  const next = Buffer.concat([tail, Buffer.from(chunk)]);
  return next.byteLength <= maximum
    ? next
    : next.subarray(next.byteLength - maximum);
}

/**
 * Whether `sessionId` is `parentSessionId`'s descendant, proven by walking
 * the native `parentID` chain (bounded). Every session on a proven chain is
 * remembered as a child. Any read failure proves nothing (fail closed: the
 * request stays unanswered by this driver).
 */
export async function verifyOpenCodeChildSession({
  childSessions,
  parentSessionId,
  requestJson,
  sessionId,
}) {
  if (typeof sessionId !== "string" || typeof parentSessionId !== "string")
    return false;
  const chain = [];
  let current = sessionId;
  for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth += 1) {
    if (current === parentSessionId || childSessions.has(current)) {
      for (const id of chain) childSessions.add(id);
      return chain.length > 0;
    }
    chain.push(current);
    let info;
    try {
      info = await requestJson(`/session/${encodeURIComponent(current)}`);
    } catch {
      return false;
    }
    const parent = stringField(info, "parentID");
    if (parent === undefined) return false;
    current = parent;
  }
  return false;
}

/**
 * A resumed session's existing subagent sessions (`GET /session/:id/children`,
 * breadth first, bounded), so their requests need no live announcement. Best
 * effort: an unreadable listing leaves the per-request lineage check.
 */
export async function preloadOpenCodeChildSessions({
  childSessions,
  parentSessionId,
  requestJson,
}) {
  const queue = [parentSessionId];
  let loaded = 0;
  while (queue.length > 0 && loaded < MAX_PRELOADED_CHILDREN) {
    const id = queue.shift();
    let children;
    try {
      children = await requestJson(
        `/session/${encodeURIComponent(id)}/children`,
      );
    } catch {
      return;
    }
    if (!Array.isArray(children)) return;
    for (const child of children) {
      const childId = stringField(child, "id");
      if (childId === undefined || stringField(child, "parentID") !== id)
        continue;
      childSessions.add(childId);
      queue.push(childId);
      loaded += 1;
    }
  }
}

/**
 * The pending permission and question requests, as the events that asked
 * them (`GET /permission` / `GET /question` items are the `permission.asked`
 * / `question.asked` properties).
 */
export async function pendingOpenCodeRequests(requestJson) {
  const events = [];
  for (const [path, type] of [
    ["/permission", "permission.asked"],
    ["/question", "question.asked"],
  ]) {
    const listed = await requestJson(path);
    if (!Array.isArray(listed)) continue;
    for (const properties of listed)
      if (isRecord(properties) && stringField(properties, "id") !== undefined)
        events.push({ type, properties });
  }
  return events;
}

/** A child session's `step-finish` part (a subagent model step), if any. */
export function openCodeStepFinishPart(event) {
  if (!isRecord(event) || event.type !== "message.part.updated")
    return undefined;
  const part = record(record(event.properties).part);
  return part.type === "step-finish" ? part : undefined;
}

export function stringField(value, name) {
  return isRecord(value) &&
    typeof value[name] === "string" &&
    value[name] !== ""
    ? value[name]
    : undefined;
}

export function record(value) {
  return isRecord(value) ? value : {};
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
