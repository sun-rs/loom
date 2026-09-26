// Opt-in Channel attached-directory check of the drift gate
// (RAH_DRIFT_ATTACH=1). The gate creates an attached directory holding a
// random passphrase file, creates the Channel with it through the real
// `room.create` API, and one scenario round asks the instance to read the
// file (drift-scenario.mjs attached-read; judged from the committed Room
// reply in drift-checks.mjs). This module creates the fixture and turns the
// gate-private records (guard shim launch/request records, Host mount
// receipts, the Kimi workspace file) into evidence. Everything here is
// diagnostic: a mechanism status is never inferred when its source is
// missing; it is `unknown`.
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const ATTACH_RELATIVE_FILE = "facts/attached-secret.txt";

// The Host requires canonical attached paths (realpath equal to the path),
// so the returned directory is resolved (macOS tmpdir sits under a symlink).
export function createAttachedFixture(
  root,
  { random = () => randomBytes(12).toString("hex") } = {},
) {
  const directory = join(root, "attached");
  mkdirSync(join(directory, "facts"), { recursive: true, mode: 0o700 });
  const passphrase = `LOOM-ATT-${random()}`;
  writeFileSync(
    join(directory, ATTACH_RELATIVE_FILE),
    `口令：${passphrase}\n`,
    { mode: 0o600 },
  );
  return {
    directory: realpathSync(directory),
    relativeFile: ATTACH_RELATIVE_FILE,
    passphrase,
  };
}

const PROBE_SUBCOMMANDS = new Set([
  "--version",
  "-v",
  "debug",
  "models",
  "provider",
]);

// One guarded CLI launch, recorded by the shim before the guard runs. Only
// the cwd, the subcommand, whether it is a catalog/version probe and the
// `--add-dir` values are kept: other argv (for example an MCP config) may
// carry credentials and is never recorded.
export function gateLaunchRecord(args, cwd, at = new Date().toISOString()) {
  const addDirs = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === "--add-dir" && typeof args[i + 1] === "string")
      addDirs.push(args[++i]);
    else if (a.startsWith("--add-dir=")) addDirs.push(a.slice(10));
  }
  return {
    at,
    cwd,
    subcommand: args[0] ?? null,
    probe:
      PROBE_SUBCOMMANDS.has(args[0]) ||
      args.includes("--no-session-persistence"),
    addDirs,
  };
}

// Called from the generated shim (guarded-shim.mjs launchRecordPath).
export function appendGateLaunchRecord(path) {
  appendFileSync(
    path,
    JSON.stringify(gateLaunchRecord(process.argv.slice(2), process.cwd())) +
      "\n",
    { mode: 0o600 },
  );
}

export function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

// kimi-code reads `<cwd>/.kimi-code/local.toml`; the Host driver writes a
// Loom-managed version whose first line carries the sha256 of the rest
// (agent-host channel-attached-directories.js).
const KIMI_MARKER = "# Managed by Loom (kimi-workspace v1 sha256:";
export function kimiLocalConfigStatus(primaryDirectory, attachedDirectory) {
  if (!primaryDirectory)
    return { status: "unknown", detail: "no primary directory" };
  const path = join(primaryDirectory, ".kimi-code", "local.toml");
  if (!existsSync(path)) return { status: "missing", detail: "absent" };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { status: "unknown", detail: String(error?.message ?? error) };
  }
  const newline = text.indexOf("\n");
  const header = newline < 0 ? text : text.slice(0, newline);
  const body = newline < 0 ? "" : text.slice(newline + 1);
  const digest = header.slice(KIMI_MARKER.length, KIMI_MARKER.length + 64);
  if (
    !header.startsWith(KIMI_MARKER) ||
    digest !== createHash("sha256").update(body).digest("hex")
  )
    return { status: "missing", detail: "not the platform version" };
  const match = /^additional_dir = \[(.*)\]$/mu.exec(body);
  let listed = [];
  try {
    listed = match ? JSON.parse(`[${match[1]}]`) : [];
  } catch {
    listed = [];
  }
  return listed.includes(attachedDirectory)
    ? { status: "effective", detail: "platform-managed" }
    : { status: "missing", detail: "attached directory not listed" };
}

// OpenCode's standing prompt is an `instructions` file named in the serve's
// OPENCODE_CONFIG_CONTENT (agent-host opencode-standing-instructions.js);
// the runtime context in it lists `- Attached directory: <abs>`.
export function openCodeInstructionAttachedDirectories(
  configContent,
  read = (p) => readFileSync(p, "utf8"),
) {
  let config;
  try {
    config = JSON.parse(configContent);
  } catch {
    return { status: "unknown", reason: "no readable config content" };
  }
  const files = Array.isArray(config?.instructions)
    ? config.instructions.filter((p) => typeof p === "string")
    : [];
  if (!files.length) return { status: "unknown", reason: "no instructions" };
  const directories = [];
  for (const file of files) {
    let text;
    try {
      text = read(file);
    } catch (error) {
      return {
        status: "unknown",
        reason: `instructions unreadable: ${String(error?.message ?? error).slice(0, 120)}`,
      };
    }
    for (const m of text.matchAll(/^- Attached directory: (.+)$/gmu))
      directories.push(m[1].trim());
  }
  return { status: "read", directories };
}

export const OPENCODE_DENIED_TOOLS = ["question", "plan_enter", "plan_exit"];
const wildcard = (value, pattern) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
      .replace(/\*/gu, ".*")
      .replace(/\?/gu, ".")}$`,
    "su",
  ).test(value);

// OpenCode 1.18.32 tool-list evaluation: the last rule whose permission
// wildcard matches decides; only a `pattern: "*"` deny hides the tool.
export function openCodeRuleDenies(rules) {
  if (!Array.isArray(rules)) return null;
  return Object.fromEntries(
    OPENCODE_DENIED_TOOLS.map((tool) => {
      const decisive = rules.findLast(
        (r) =>
          typeof r?.permission === "string" && wildcard(tool, r.permission),
      );
      return [tool, decisive?.action === "deny" && decisive.pattern === "*"];
    }),
  );
}

// Session creates carry the full product ruleset; a PATCH appends (OpenCode
// merges), so its own rules are evaluated alone. A tool counts as denied
// only when every recorded request denies it; no request is unknown.
export function summarizeOpenCodePermissions(records) {
  const requests = records
    .filter((r) => ["session-create", "session-permission"].includes(r.kind))
    .map((r) => ({
      kind: r.kind,
      at: r.at,
      ...(r.sessionId ? { sessionId: r.sessionId } : {}),
      rules: Array.isArray(r.permission) ? r.permission.length : null,
      denied: openCodeRuleDenies(r.permission),
    }));
  const denied = Object.fromEntries(
    OPENCODE_DENIED_TOOLS.map((tool) => [
      tool,
      requests.length ? requests.every((r) => r.denied?.[tool] === true) : null,
    ]),
  );
  return {
    sessionCreates: requests.filter((r) => r.kind === "session-create").length,
    permissionPatches: requests.filter((r) => r.kind === "session-permission")
      .length,
    denied,
    requests,
  };
}

// Host channel_home mount receipts (agent-host agent-execution-workspace-
// catalog.ts, schemaVersion 2) of one participant.
export function readChannelHomeReceipts(stateDirectory, participantId) {
  const out = [];
  for (const path of globSync(
    join(stateDirectory, "agent-workspaces", ".mount-receipts", "*.json"),
  )) {
    let r;
    try {
      r = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (r?.kind !== "channel_home" || r.mount?.participantId !== participantId)
      continue;
    out.push({
      cwd: r.cwd,
      roomId: r.roomId,
      additionalDirectories: r.additionalDirectories,
      workspaceMountRevisionId: r.mount.workspaceMountRevisionId,
    });
  }
  return out;
}

const distinct = (values) => [...new Set(values)];
const ratio = (ok, all, what) => `${ok}/${all} ${what}`;

function attachmentOf(input) {
  const { provider, attachedDirectory, primaryDirectory, turnLaunches } = input;
  const verdict = (ok, all) =>
    all === 0 ? "unknown" : ok === all ? "effective" : "missing";
  if (provider === "claude") {
    const ok = turnLaunches.filter((l) =>
      l.addDirs.includes(attachedDirectory),
    ).length;
    return {
      provider,
      mechanism: "--add-dir=",
      status: verdict(ok, turnLaunches.length),
      detail: ratio(ok, turnLaunches.length, "turn launches"),
    };
  }
  if (provider === "codex") {
    const requests = (input.codexRequests ?? []).filter(
      (r) => r.kind === "thread",
    );
    const ok = requests.filter(
      (r) =>
        Array.isArray(r.runtimeWorkspaceRoots) &&
        r.runtimeWorkspaceRoots.includes(attachedDirectory),
    );
    const primaryFirst =
      ok.length > 0 &&
      ok.every((r) => r.runtimeWorkspaceRoots[0] === primaryDirectory);
    return {
      provider,
      mechanism: "runtimeWorkspaceRoots",
      status: verdict(ok.length, requests.length),
      detail:
        ratio(ok.length, requests.length, "thread requests") +
        (ok.length
          ? primaryFirst
            ? "; primary first"
            : "; primary not first"
          : ""),
    };
  }
  if (provider === "kimi")
    return {
      provider,
      mechanism: ".kimi-code/local.toml",
      ...(input.kimiLocalConfig ?? {
        status: "unknown",
        detail: "not inspected",
      }),
    };
  const serves = (input.openCodeRequests ?? []).filter(
    (r) => r.kind === "serve-launch",
  );
  const readable = serves.filter((s) => s.instructions?.status === "read");
  const ok = readable.filter((s) =>
    s.instructions.directories.includes(attachedDirectory),
  ).length;
  return {
    provider,
    mechanism: "standing prompt '- Attached directory:' line",
    status:
      readable.length < serves.length
        ? "unknown"
        : verdict(ok, readable.length),
    detail: ratio(ok, serves.length, "serve launches"),
  };
}

// The attach evidence block of result.json. cwd status: "primary" when
// every observed cwd (Host receipt, turn launches, Codex thread cwd) is the
// primary directory, "other" when any differs, "unknown" without any.
export function summarizeAttachEvidence(input) {
  const {
    primaryDirectory,
    attachedDirectory,
    from,
    receipts = [],
    placementMounts = [],
    channelWorkspace,
    primaryState,
    launches = [],
  } = input;
  const turnLaunches = launches.filter(
    (l) => !l.probe && (from === undefined || l.at >= from),
  );
  const hostReceiptCwds = distinct(receipts.map((r) => r.cwd));
  const launchCwds = distinct(turnLaunches.map((l) => l.cwd));
  const threadCwds =
    input.provider === "codex"
      ? distinct(
          (input.codexRequests ?? [])
            .filter((r) => r.kind === "thread" && typeof r.cwd === "string")
            .map((r) => r.cwd),
        )
      : undefined;
  const observed = [...hostReceiptCwds, ...launchCwds, ...(threadCwds ?? [])];
  const receiptMounts = new Set(
    receipts.map((r) => r.workspaceMountRevisionId),
  );
  return {
    channelWorkspace: {
      primaryDirectory: channelWorkspace?.primaryDirectory ?? null,
      additionalDirectories: channelWorkspace?.additionalDirectories ?? null,
      primaryState: primaryState?.state ?? null,
      attachedRecorded: Boolean(
        channelWorkspace?.additionalDirectories?.includes(attachedDirectory),
      ),
    },
    cwd: {
      status: !observed.length
        ? "unknown"
        : observed.every((c) => c === primaryDirectory)
          ? "primary"
          : "other",
      hostReceiptCwds,
      placementOnChannelHome: placementMounts.length
        ? placementMounts.every((m) => receiptMounts.has(m))
        : null,
      launchCwds,
      turnLaunches: turnLaunches.length,
      ...(threadCwds ? { threadCwds } : {}),
    },
    attachment: attachmentOf({ ...input, turnLaunches }),
  };
}

// Product usage rows of a round's RunAttempts. Kimi rows are read by the
// Host driver from the session wire (evo status §40); the other CLIs
// report fd3 usage frames.
export function summarizeUsageRecords(provider, { rows, gapReasons }) {
  return {
    rows,
    gapReasons,
    source:
      provider === "kimi" ? (rows > 0 ? "kimi-wire" : "none") : "driver-frames",
  };
}
