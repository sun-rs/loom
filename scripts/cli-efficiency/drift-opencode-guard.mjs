// Test-only model fence for OpenCode (`opencode serve` over HTTP), used by
// the paid drift gate. Both product drivers (opencode-server-driver.mjs cold,
// opencode-warm-driver.mjs warm) launch `<exe> serve --pure --hostname
// 127.0.0.1 --port N` and talk HTTP to it. The guarded shim starts the real
// serve on another loopback port and serves N itself as a fail-closed
// proxy: every non-GET request is checked before it reaches OpenCode, and a
// violation answers 403 and closes the CLI.
//
//   - `POST /session/:id/message|prompt_async` must carry exactly the
//     approved `model` {providerID, modelID} and `variant` (the reasoning
//     level); no agent override, text/file parts only.
//   - `POST /session/:id/summarize` (the native manual compaction entry,
//     OpenCode 1.18.32 `SummarizePayload` = {providerID, modelID, auto?})
//     must name the approved model. It has no variant field: the compaction
//     request merges `agent.compaction.options` and then the (absent)
//     variant, so the shim injects the approved variant's options as
//     `agent.compaction.options` into the real serve's config content.
//   - Session create, abort, permission/question replies pass without model
//     fields; `PATCH /session/:id` passes only with a `permission` rule list
//     (the drivers' deny rules on a resumed session); every other mutation (command, shell, init, fork, config,
//     tui, ...) is refused. Session create must carry an explicit,
//     non-default title: with a default title OpenCode 1.18.32 titles the
//     session on its first user message through the small model
//     (`SessionPrompt.ensureTitle` -> `Provider.getSmallModel`), an internal
//     model call that never crosses this proxy (eighth review P2-1).
//   - The real serve's config content pins `model` and `small_model` to the
//     approved binding (overriding any configured value), and before the
//     proxy listens the merged `GET /config` must show exactly those, no
//     agent pinned to another model or variant, no reasoning options on any
//     agent but the compaction override, and that override in place.
//
// Scope of "fail-closed": only the HTTP requests the product drivers send
// pass through this proxy. Internal model calls OpenCode makes by itself
// (title, summaries, subagents, plugins) are constrained only through the
// pinned config above; small-model calls then use the approved model without
// a variant. The post-hoc transcript fence (`assertOpenCodeAssistants`) only
// DETECTS an unapproved model after the paid call happened; it never
// prevents one, and title calls leave no stored assistant to audit.
//
// Warm drift runs also get a compaction gate: the drift runner asks the shim
// (private Unix socket) to summarize the idle warm session; events of that
// session never reach the product driver meanwhile (it would abort an
// unprompted run), and a driver prompt that arrives is held until the end.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { openCodeInstructionAttachedDirectories } from "./drift-attach.mjs";
import { appendFileSync, existsSync, rmSync } from "node:fs";
import {
  request as httpRequest,
  createServer as createHttpServer,
} from "node:http";
import { createConnection, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function parseOpenCodeBinding(value) {
  const at = typeof value === "string" ? value.indexOf("/") : -1;
  if (at <= 0 || at === value.length - 1)
    throw new Error("OpenCode model must be a provider/model binding");
  return { providerID: value.slice(0, at), modelID: value.slice(at + 1) };
}

const PROMPT = /^\/session\/[^/]+\/(?:message|prompt_async)$/u;
const SUMMARIZE = /^\/session\/[^/]+\/summarize$/u;
const PLAIN_POSTS = [
  /^\/session$/u,
  /^\/session\/[^/]+\/abort$/u,
  /^\/permission\/[^/]+\/reply$/u,
  /^\/question\/[^/]+\/reject$/u,
];
const MODEL_FIELDS = ["model", "modelID", "providerID", "variant", "agent"];
// Review 2026-09-26 P1-1 (evo status §41): the drivers install the deny
// rules on a resumed session with `PATCH /session/:id {permission}`.
const SESSION_UPDATE = /^\/session\/([^/]+)$/u;
const RULE_KEYS = ["action", "pattern", "permission"];
function assertPermissionOnly(body, pathname) {
  const refuse = () => {
    throw new Error(`Unsupported gate request PATCH ${pathname} body`);
  };
  if (Object.keys(body).length !== 1 || !Array.isArray(body.permission))
    refuse();
  if (!body.permission.length) refuse();
  for (const rule of body.permission)
    if (
      !isRecord(rule) ||
      Object.keys(rule).length !== RULE_KEYS.length ||
      !RULE_KEYS.every((k) => typeof rule[k] === "string") ||
      !["allow", "deny", "ask"].includes(rule.action)
    )
      refuse();
}
// OpenCode's generated default titles (`Session.isDefaultTitle`).
const DEFAULT_TITLE = /^(?:New|Child) session - /u;
const PROMPT_PARTS = new Set(["text", "file"]);

const isRecord = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// (method, pathname, bodyText) => void; throws for anything unapproved.
export function createOpenCodeRequestGuard(approved) {
  assert.ok(
    approved?.model &&
      typeof approved.effort === "string" &&
      approved.effort !== "",
    "Guard needs model and effort",
  );
  const want = parseOpenCodeBinding(approved.model);
  const sameModel = (m) =>
    isRecord(m) &&
    Object.keys(m).length === 2 &&
    m.providerID === want.providerID &&
    m.modelID === want.modelID;
  return (method, pathname, bodyText) => {
    const verb = String(method).toUpperCase();
    if (verb === "GET" || verb === "HEAD") return;
    if (verb !== "POST" && !(verb === "PATCH" && SESSION_UPDATE.test(pathname)))
      throw new Error(`Unsupported gate request ${verb} ${pathname}`);
    let body = {};
    if (bodyText !== undefined && bodyText !== "") {
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw new Error(`Unsupported gate request body (not JSON) ${pathname}`);
      }
      if (!isRecord(body))
        throw new Error(`Unsupported gate request body ${pathname}`);
    }
    if (verb === "PATCH") return assertPermissionOnly(body, pathname);
    if (PROMPT.test(pathname)) {
      if (!sameModel(body.model))
        throw new Error("Unapproved model (exact approved model required)");
      if (body.variant !== approved.effort)
        throw new Error(
          `Unapproved variant ${body.variant ?? "none"} (approved ${approved.effort})`,
        );
      if (body.agent !== undefined)
        throw new Error("Unsupported prompt agent override");
      for (const part of Array.isArray(body.parts) ? body.parts : [])
        if (!PROMPT_PARTS.has(part?.type))
          throw new Error(`Unsupported prompt part ${part?.type}`);
      return;
    }
    if (SUMMARIZE.test(pathname)) {
      const { providerID, modelID, auto, ...rest } = body;
      if (Object.keys(rest).length)
        throw new Error("Unsupported summarize field");
      if (auto !== undefined && typeof auto !== "boolean")
        throw new Error("Unsupported summarize field");
      if (!sameModel({ providerID, modelID }))
        throw new Error("Unapproved compaction model");
      return;
    }
    if (PLAIN_POSTS.some((r) => r.test(pathname))) {
      for (const key of MODEL_FIELDS)
        if (body[key] !== undefined)
          throw new Error(`Unapproved model field ${key} on ${pathname}`);
      if (
        pathname === "/session" &&
        (typeof body.title !== "string" ||
          body.title.trim() === "" ||
          DEFAULT_TITLE.test(body.title))
      )
        throw new Error(
          "Unsupported session title (an explicit non-default title is required; a default title triggers an internal small-model call)",
        );
      return;
    }
    throw new Error(`Unsupported gate request POST ${pathname}`);
  };
}

// Drift evidence of an admitted request: the permission rules of a session
// create or permission PATCH (null for everything else; no prompt text).
export function openCodeRequestRecord(
  method,
  pathname,
  bodyText,
  at = new Date().toISOString(),
) {
  const verb = String(method).toUpperCase();
  const update = verb === "PATCH" && SESSION_UPDATE.exec(pathname);
  if (!(verb === "POST" && pathname === "/session") && !update) return null;
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = {};
  }
  const permission = Array.isArray(body?.permission) ? body.permission : null;
  return update
    ? {
        kind: "session-permission",
        at,
        sessionId: decodeURIComponent(update[1]),
        permission,
      }
    : { kind: "session-create", at, permission };
}

// {kind: "version" | "catalog" | "config"} or {kind: "serve", port, upstreamArgs(p)}.
export function classifyOpenCodeLaunch(args) {
  if (args.length === 1 && ["--version", "-v"].includes(args[0]))
    return { kind: "version" };
  if (
    args[0] === "models" &&
    args.slice(1).every((a) => a === "--verbose" || a === "--pure")
  )
    return { kind: "catalog" };
  // evo §57: the product drivers resolve MCP server names with OpenCode's
  // read-only `debug config --pure` before serve; it makes no model call.
  if (
    args.length === 3 &&
    args[0] === "debug" &&
    args[1] === "config" &&
    args[2] === "--pure"
  )
    return { kind: "config" };
  if (args[0] !== "serve") throw new Error("Unsupported gate CLI command");
  let port;
  let hostname;
  let portAt;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--pure") continue;
    if (a === "--hostname") hostname = args[++i];
    else if (a === "--port") {
      portAt = ++i;
      port = Number(args[i]);
    } else throw new Error(`Unsupported gate serve argument ${a}`);
  }
  if (hostname !== "127.0.0.1")
    throw new Error("Unsupported gate serve hostname");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Unsupported gate serve port");
  return {
    kind: "serve",
    port,
    upstreamArgs: (upstream) =>
      args.map((a, i) => (i === portAt ? String(upstream) : a)),
  };
}

export function assertOpenCodeServerConfig(config, approved) {
  if (config?.small_model !== approved.model)
    throw new Error(
      `Unapproved small_model: ${String(config?.small_model ?? "unset")}`,
    );
  if (config?.model !== approved.model)
    throw new Error(
      `Unapproved default model: ${String(config?.model ?? "unset")}`,
    );
  const agents = isRecord(config?.agent) ? config.agent : {};
  for (const [name, agent] of Object.entries(agents)) {
    if (!isRecord(agent)) continue;
    if (agent.model !== undefined && agent.model !== approved.model)
      throw new Error(
        `Unapproved agent model (${name}): ${String(agent.model)}`,
      );
    if (agent.variant !== undefined && agent.variant !== approved.effort)
      throw new Error(
        `Unapproved agent variant (${name}): ${String(agent.variant)}`,
      );
    if (
      name !== "compaction" &&
      isRecord(agent.options) &&
      Object.keys(agent.options).length
    )
      throw new Error(`Unapproved agent options (${name})`);
  }
  const options = agents.compaction?.options;
  for (const [key, value] of Object.entries(approved.compactionOptions ?? {}))
    if (
      !isRecord(options) ||
      JSON.stringify(options[key]) !== JSON.stringify(value)
    )
      throw new Error(
        "Missing compaction reasoning override in the served config",
      );
  if (!Object.keys(approved.compactionOptions ?? {}).length)
    throw new Error(
      "Missing compaction reasoning override in the served config",
    );
}

// The approved variant's provider options, read from `opencode models
// <provider> --verbose` output (a binding line followed by its JSON).
export function openCodeVariantOptions(text, model, effort) {
  const lines = String(text).split("\n");
  const at = lines.findIndex((l) => l.trim() === model);
  if (at < 0) throw new Error(`${model} is not in the OpenCode catalog`);
  const block = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (/^[^\s{}"]+\/[^\s{}"]+$/u.test(lines[i].trim())) break;
    block.push(lines[i]);
  }
  let metadata;
  try {
    metadata = JSON.parse(block.join("\n"));
  } catch {
    throw new Error(`${model} has no verbose catalog metadata`);
  }
  const options = metadata?.variants?.[effort];
  if (!isRecord(options) || !Object.keys(options).length)
    throw new Error(`${model} has no variant ${effort}`);
  return options;
}

// The single resolver of the gate's OpenCode compaction options (efficiency
// and drift arms): the approved variant's options from the installed CLI's
// own `opencode models <provider> --verbose --pure` catalog.
export function readOpenCodeCompactionOptions(executable, model, effort) {
  return openCodeVariantOptions(
    execFileSync(
      executable,
      ["models", parseOpenCodeBinding(model).providerID, "--verbose", "--pure"],
      { encoding: "utf8", timeout: 60_000 },
    ),
    model,
    effort,
  );
}

// The gate's served config: the approved model as the default and the small
// model (eighth review P2-1), and the approved variant's options for the
// compaction agent.
export function withCompactionOptions(content, options, model) {
  if (!isRecord(options) || !Object.keys(options).length)
    throw new Error("Compaction reasoning options are required");
  if (typeof model !== "string" || model === "")
    throw new Error("The approved model is required for the served config");
  parseOpenCodeBinding(model);
  const config = content ? JSON.parse(content) : {};
  if (!isRecord(config))
    throw new Error("OPENCODE_CONFIG_CONTENT is not an object");
  const agent = isRecord(config.agent) ? config.agent : {};
  const compaction = isRecord(agent.compaction) ? agent.compaction : {};
  return JSON.stringify({
    ...config,
    model,
    small_model: model,
    agent: {
      ...agent,
      compaction: {
        ...compaction,
        options: { ...(compaction.options ?? {}), ...options },
      },
    },
  });
}

// Forced-compaction evidence from `GET /session/:id/message` (after the
// summarize request): the compaction assistant created after startedAtMs.
export function openCodeCompactionEvidence(
  messages,
  { startedAtMs, approved },
) {
  const want = parseOpenCodeBinding(approved.model);
  const compactions = (Array.isArray(messages) ? messages : [])
    .map((m) => m?.info)
    .filter(
      (i) =>
        i?.role === "assistant" &&
        i.summary === true &&
        i.mode === "compaction" &&
        (i.time?.created ?? 0) >= startedAtMs,
    );
  const last = compactions.at(-1);
  if (
    last &&
    (last.providerID !== want.providerID || last.modelID !== want.modelID)
  )
    throw new Error(
      `Unapproved compaction model ${last.providerID}/${last.modelID}`,
    );
  return {
    observed: Boolean(
      last && last.time?.completed && last.finish && last.error === undefined,
    ),
    compactionsAfter: compactions.length,
    compaction: last
      ? {
          providerID: last.providerID,
          modelID: last.modelID,
          variant: last.variant ?? null,
          finish: last.finish ?? null,
          error: last.error?.name ?? (last.error ? "error" : null),
          tokens: last.tokens ?? null,
        }
      : null,
  };
}

// Post-hoc round fence over stored message infos (the session and its
// subagent children): every assistant used the approved model and variant.
export function assertOpenCodeAssistants(infos, approved) {
  const want = parseOpenCodeBinding(approved.model);
  let assistants = 0;
  let compactions = 0;
  for (const info of infos) {
    if (info?.role !== "assistant") continue;
    assistants += 1;
    if (info.providerID !== want.providerID || info.modelID !== want.modelID)
      throw new Error(`Unapproved model ${info.providerID}/${info.modelID}`);
    if (info.variant !== approved.effort)
      throw new Error(`Unapproved variant ${info.variant ?? "none"}`);
    if (info.summary === true && info.mode === "compaction") compactions += 1;
  }
  return { assistants, compactions };
}

export function openCodeDatabasePath(env = process.env) {
  if (env.OPENCODE_DB && isAbsolute(env.OPENCODE_DB)) return env.OPENCODE_DB;
  const data = env.XDG_DATA_HOME || join(homedir(), ".local/share");
  return join(data, "opencode", env.OPENCODE_DB || "opencode.db");
}

// Stored message infos of a session tree inside [fromMs, toMs].
export function readOpenCodeRound(
  sessionId,
  fromMs,
  toMs,
  dbPath = openCodeDatabasePath(),
) {
  if (!existsSync(dbPath)) throw new Error("OpenCode database not found");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT ? UNION SELECT s.id FROM session s JOIN tree t ON s.parent_id = t.id)
         SELECT data FROM message
          WHERE session_id IN (SELECT id FROM tree) AND time_created BETWEEN ? AND ?
          ORDER BY time_created, id`,
      )
      .all(sessionId, fromMs, toMs)
      .map((row) => JSON.parse(row.data));
  } finally {
    db.close();
  }
}

export function openCodeSessionDirectory(
  sessionId,
  dbPath = openCodeDatabasePath(),
) {
  if (!existsSync(dbPath)) return undefined;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare("SELECT directory FROM session WHERE id = ?")
      .get(sessionId)?.directory;
  } finally {
    db.close();
  }
}

export function createSseSessionFilter(isSuppressed) {
  let buffer = "";
  const sessionOf = (text) => {
    const data = text
      .split(/\r?\n/u)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) return undefined;
    try {
      const event = JSON.parse(data);
      const p = event?.properties ?? event?.payload?.properties ?? {};
      return p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID;
    } catch {
      return undefined;
    }
  };
  return {
    push(chunk) {
      buffer += chunk;
      let out = "";
      for (;;) {
        const m = /\r?\n\r?\n/u.exec(buffer);
        if (!m) break;
        const end = m.index + m[0].length;
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end);
        const id = sessionOf(event);
        if (id !== undefined && isSuppressed(id)) continue;
        out += event;
      }
      return out;
    },
  };
}

export function openCodeAuthHeader(env = process.env) {
  const password = env.OPENCODE_SERVER_PASSWORD;
  return password
    ? {
        Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      }
    : {};
}

export async function allocateLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Merged served config, once the server answers (bounded).
export async function waitForOpenCodeConfig(
  baseUrl,
  directory,
  { timeoutMs = 30_000, exited } = {},
) {
  const end = Date.now() + timeoutMs;
  let last;
  for (;;) {
    if (exited?.done) throw new Error("opencode serve exited during startup");
    try {
      const r = await fetch(
        `${baseUrl}/config?directory=${encodeURIComponent(directory)}`,
        {
          headers: openCodeAuthHeader(),
          signal: AbortSignal.timeout(2000),
        },
      );
      if (r.ok) return await r.json();
      last = new Error(`GET /config ${r.status}`);
    } catch (error) {
      last = error;
    }
    if (Date.now() > end)
      throw new Error(
        `opencode serve startup timed out: ${String(last?.message ?? last)}`,
      );
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Native manual compaction of one session through a served OpenCode.
export async function openCodeSummarize({
  baseUrl,
  directory,
  sessionId,
  approved,
  validate,
  timeoutMs = 240_000,
}) {
  const startedAtMs = Date.now();
  const q = `?directory=${encodeURIComponent(directory)}`;
  const path = `/session/${encodeURIComponent(sessionId)}/summarize`;
  const body = JSON.stringify(parseOpenCodeBinding(approved.model));
  validate("POST", path, body);
  const record = {};
  const response = await fetch(baseUrl + path + q, {
    method: "POST",
    headers: { "content-type": "application/json", ...openCodeAuthHeader() },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  record.summarize = {
    status: response.status,
    result: await response.json().catch(() => null),
  };
  if (!response.ok)
    throw new Error(`summarize answered HTTP ${response.status}`);
  const list = await fetch(
    `${baseUrl}/session/${encodeURIComponent(sessionId)}/message${q}&limit=50`,
    { headers: openCodeAuthHeader(), signal: AbortSignal.timeout(10_000) },
  );
  if (!list.ok) throw new Error(`message list answered HTTP ${list.status}`);
  return {
    ...record,
    ...openCodeCompactionEvidence(await list.json(), { startedAtMs, approved }),
  };
}

const deny = (e) =>
  process.stderr.write("PAID_GATE_MODEL_DENIED " + String(e) + "\n");

// Shim entry: `#!/usr/bin/env node` + runGuardedOpenCode(real, approved, opts).
// approved: {model, effort}; options.compactionOptions: the approved
// variant's provider options (required for serve); options.controlRecordPath
// (warm drift only): appends {socketPath, pid} for the compaction socket.
export async function runGuardedOpenCode(executable, approved, options = {}) {
  const args = process.argv.slice(2);
  let plan;
  let validate;
  try {
    plan = classifyOpenCodeLaunch(args);
    validate = createOpenCodeRequestGuard(approved);
  } catch (e) {
    deny(e);
    process.exitCode = 1;
    return;
  }
  if (plan.kind !== "serve") {
    const child = spawn(executable, args, { stdio: "inherit" });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    process.exitCode = code ?? 1;
    return;
  }
  const guarded = { ...approved, compactionOptions: options.compactionOptions };
  let env;
  try {
    env = {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: withCompactionOptions(
        process.env.OPENCODE_CONFIG_CONTENT,
        options.compactionOptions,
        approved.model,
      ),
    };
  } catch (e) {
    deny(e);
    process.exitCode = 1;
    return;
  }
  const recordRequest = (record) => {
    if (options.requestRecordPath && record)
      appendFileSync(options.requestRecordPath, JSON.stringify(record) + "\n", {
        mode: 0o600,
      });
  };
  // Drift attach evidence: the product's standing prompt (instructions
  // file) lists the Channel's attached directories.
  recordRequest({
    kind: "serve-launch",
    at: new Date().toISOString(),
    instructions: openCodeInstructionAttachedDirectories(
      process.env.OPENCODE_CONFIG_CONTENT,
    ),
  });
  const upstreamPort = await allocateLoopbackPort();
  const upstream = `http://127.0.0.1:${upstreamPort}`;
  const directory = process.cwd();
  const child = spawn(executable, plan.upstreamArgs(upstreamPort), {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const exited = { done: false };
  const closed = new Promise((resolve) =>
    child.once("close", (code) => {
      exited.done = true;
      resolve(code);
    }),
  );
  child.once("error", () => {});
  let rejected = false;
  let proxy;
  let control;
  let controlPath;
  // Blocks every later request at once; the CLI is closed after `flushed`.
  const refuse = (e, flushed = Promise.resolve()) => {
    if (rejected) return;
    rejected = true;
    deny(e);
    void flushed.then(() => {
      proxy?.close();
      proxy?.closeAllConnections?.();
      child.kill("SIGTERM");
    });
  };
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  try {
    assertOpenCodeServerConfig(
      await waitForOpenCodeConfig(upstream, directory, { exited }),
      guarded,
    );
  } catch (e) {
    refuse(e);
  }
  // Prompt requests in flight, and the compaction window (if any).
  let inflight = 0;
  let injection;
  const suppressed = (id) =>
    injection !== undefined && id === injection.sessionId;
  if (!rejected) {
    proxy = createHttpServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, "http://127.0.0.1");
      try {
        validate(
          req.method,
          url.pathname,
          body.length ? body.toString("utf8") : undefined,
        );
      } catch (e) {
        res.writeHead(403, { "content-type": "application/json" });
        refuse(
          e,
          new Promise((r) =>
            res.end(JSON.stringify({ error: "PAID_GATE_MODEL_DENIED" }), r),
          ),
        );
        return;
      }
      if (rejected) {
        res.writeHead(503);
        res.end();
        return;
      }
      recordRequest(
        openCodeRequestRecord(
          req.method,
          url.pathname,
          body.length ? body.toString("utf8") : undefined,
        ),
      );
      const prompt = req.method === "POST" && PROMPT.test(url.pathname);
      if (prompt && injection) await injection.done;
      let settled = !prompt;
      const settle = () => {
        if (settled) return;
        settled = true;
        inflight -= 1;
      };
      if (prompt) inflight += 1;
      const up = httpRequest(
        upstream + req.url,
        {
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
          agent: false,
        },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          const sse = String(upRes.headers["content-type"] ?? "").includes(
            "text/event-stream",
          );
          if (sse) {
            const filter = createSseSessionFilter(suppressed);
            upRes.setEncoding("utf8");
            upRes.on("data", (chunk) => {
              const out = filter.push(chunk);
              if (out) res.write(out);
            });
            upRes.on("end", () => res.end());
          } else upRes.pipe(res);
          upRes.on("close", settle);
        },
      );
      up.on("error", () => {
        settle();
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.on("close", () => {
        if (!res.writableFinished) up.destroy();
        settle();
      });
      up.end(body);
    });
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(plan.port, "127.0.0.1", resolve);
    }).catch((e) => refuse(e));
  }
  if (!rejected && options.controlRecordPath) {
    controlPath = join(tmpdir(), `loom-og-${process.pid}.sock`);
    rmSync(controlPath, { force: true });
    const compact = async ({ sessionId, timeoutMs }) => {
      if (typeof sessionId !== "string" || !sessionId)
        throw new Error("Compaction needs a sessionId");
      if (inflight > 0 || injection) return { refused: "busy" };
      let release;
      injection = { sessionId, done: new Promise((r) => (release = r)) };
      try {
        return await openCodeSummarize({
          baseUrl: upstream,
          directory,
          sessionId,
          approved,
          validate,
          timeoutMs,
        });
      } catch (e) {
        if (/Unapproved/u.test(String(e.message))) refuse(e);
        return { error: String(e.message ?? e).slice(0, 300) };
      } finally {
        // Trailing events of the compaction stay hidden for a short while.
        setTimeout(() => {
          injection = undefined;
          release();
        }, 1500);
      }
    };
    control = createServer((socket) => {
      let buffer = "";
      socket.on("data", async (chunk) => {
        buffer += chunk;
        const n = buffer.indexOf("\n");
        if (n < 0) return;
        let request = {};
        try {
          request = JSON.parse(buffer.slice(0, n));
        } catch {
          // handled below
        }
        buffer = "";
        let record;
        try {
          if (request.command !== "compact")
            throw new Error("Unsupported compaction command");
          record = await compact(request);
        } catch (e) {
          record = { error: String(e.message ?? e) };
        }
        socket.end(JSON.stringify(record) + "\n");
      });
      socket.on("error", () => {});
    });
    control.listen(controlPath, () =>
      appendFileSync(
        options.controlRecordPath,
        JSON.stringify({
          socketPath: controlPath,
          pid: process.pid,
          at: new Date().toISOString(),
        }) + "\n",
        { mode: 0o600 },
      ),
    );
  }
  const code = await closed;
  proxy?.close();
  proxy?.closeAllConnections?.();
  control?.close();
  if (controlPath) rmSync(controlPath, { force: true });
  process.exitCode = rejected ? 1 : (code ?? 1);
}

// Drift runner side of the compaction socket.
export function requestOpenCodeCompaction(
  socketPath,
  sessionId,
  timeoutMs = 240_000,
) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setTimeout(timeoutMs + 30_000, () => {
      socket.destroy();
      reject(new Error("Compaction socket timed out"));
    });
    let buffer = "";
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({ command: "compact", sessionId, timeoutMs }) + "\n",
      ),
    );
    socket.on("data", (chunk) => (buffer += chunk));
    socket.on("end", () => {
      try {
        resolve(JSON.parse(buffer.trim()));
      } catch {
        reject(new Error("Compaction socket returned no record"));
      }
    });
    socket.on("error", reject);
  });
}
