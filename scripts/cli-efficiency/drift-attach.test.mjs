import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATTACH_RELATIVE_FILE,
  createAttachedFixture,
  gateLaunchRecord,
  kimiLocalConfigStatus,
  openCodeInstructionAttachedDirectories,
  openCodeRuleDenies,
  readChannelHomeReceipts,
  readJsonLines,
  summarizeAttachEvidence,
  summarizeOpenCodePermissions,
  summarizeUsageRecords,
} from "./drift-attach.mjs";

const PRIMARY = "/private/tmp/gate/channel-workspaces/room_1";
const ATTACHED = "/private/tmp/gate/attached";

test("fixture: a random passphrase in facts/attached-secret.txt under a canonical attached directory", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-attach-test-"));
  try {
    const a = createAttachedFixture(root);
    const b = createAttachedFixture(join(root, "second"));
    assert.equal(a.relativeFile, ATTACH_RELATIVE_FILE);
    assert.equal(a.relativeFile, "facts/attached-secret.txt");
    assert.equal(a.directory, realpathSync(join(root, "attached")));
    assert.match(a.passphrase, /^LOOM-ATT-[0-9a-f]{24}$/);
    assert.notEqual(a.passphrase, b.passphrase, "random per run");
    const file = join(a.directory, a.relativeFile);
    assert.ok(readFileSync(file, "utf8").includes(a.passphrase));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    // Deterministic with an injected random source.
    const c = createAttachedFixture(join(root, "third"), {
      random: () => "00ff",
    });
    assert.equal(c.passphrase, "LOOM-ATT-00ff");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("launch record: cwd, subcommand, probe flag and --add-dir values only (no other argv)", () => {
  const r = gateLaunchRecord(
    [
      "-p",
      "--model",
      "haiku",
      "--add-dir=/a/one",
      "--add-dir",
      "/a/two",
      "--mcp-config",
      '{"token":"secret"}',
    ],
    "/w",
    "2026-09-26T00:00:00.000Z",
  );
  assert.deepEqual(r, {
    at: "2026-09-26T00:00:00.000Z",
    cwd: "/w",
    subcommand: "-p",
    probe: false,
    addDirs: ["/a/one", "/a/two"],
  });
  assert.ok(!JSON.stringify(r).includes("secret"));
  for (const args of [
    ["--version"],
    ["debug", "models"],
    ["models", "--verbose"],
    ["provider", "list"],
    ["--no-session-persistence", "--tools", ""],
  ])
    assert.equal(gateLaunchRecord(args, "/w").probe, true, args.join(" "));
  assert.equal(gateLaunchRecord(["app-server"], "/w").probe, false);
  assert.equal(gateLaunchRecord(["acp"], "/w").probe, false);
  assert.equal(gateLaunchRecord(["serve", "--pure"], "/w").probe, false);
});

test("json lines: a missing file is empty; blank lines are skipped", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-attach-test-"));
  try {
    assert.deepEqual(readJsonLines(join(root, "none.jsonl")), []);
    writeFileSync(join(root, "x.jsonl"), '{"a":1}\n\n{"a":2}\n');
    assert.deepEqual(readJsonLines(join(root, "x.jsonl")), [
      { a: 1 },
      { a: 2 },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const kimiText = (dirs) => {
  const body = `[workspace]\nadditional_dir = [${dirs.map((d) => JSON.stringify(d)).join(", ")}]\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  return `# Managed by Loom (kimi-workspace v1 sha256:${digest}). Loom never overwrites an edited copy.\n${body}`;
};

test("kimi local.toml: platform-managed version listing the attached directory, else a named status", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-attach-test-"));
  try {
    const home = join(root, "home");
    mkdirSync(join(home, ".kimi-code"), { recursive: true });
    const path = join(home, ".kimi-code", "local.toml");
    assert.deepEqual(kimiLocalConfigStatus(join(root, "absent"), ATTACHED), {
      status: "missing",
      detail: "absent",
    });
    writeFileSync(path, kimiText([ATTACHED]));
    assert.deepEqual(kimiLocalConfigStatus(home, ATTACHED), {
      status: "effective",
      detail: "platform-managed",
    });
    writeFileSync(path, kimiText(["/other"]));
    assert.deepEqual(kimiLocalConfigStatus(home, ATTACHED), {
      status: "missing",
      detail: "attached directory not listed",
    });
    writeFileSync(path, kimiText([ATTACHED]) + "# edited\n");
    assert.deepEqual(kimiLocalConfigStatus(home, ATTACHED), {
      status: "missing",
      detail: "not the platform version",
    });
    writeFileSync(path, "[workspace]\n");
    assert.equal(kimiLocalConfigStatus(home, ATTACHED).status, "missing");
    assert.deepEqual(kimiLocalConfigStatus(null, ATTACHED), {
      status: "unknown",
      detail: "no primary directory",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("opencode instructions: the Attached directory lines of the configured instruction files", () => {
  const files = {
    "/rules/a.md": `## Current Runtime Context\n- Workspace: ${PRIMARY}\n- Attached directory: ${ATTACHED}\n- Room: r\n`,
    "/rules/b.md": "no context here\n",
  };
  const read = (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };
  assert.deepEqual(
    openCodeInstructionAttachedDirectories(
      JSON.stringify({
        model: "x/y",
        instructions: ["/rules/b.md", "/rules/a.md"],
      }),
      read,
    ),
    { status: "read", directories: [ATTACHED] },
  );
  assert.deepEqual(
    openCodeInstructionAttachedDirectories(
      JSON.stringify({ instructions: ["/rules/b.md"] }),
      read,
    ),
    { status: "read", directories: [] },
  );
  for (const content of [undefined, "", "not json", JSON.stringify({})])
    assert.equal(
      openCodeInstructionAttachedDirectories(content, read).status,
      "unknown",
      String(content),
    );
  assert.equal(
    openCodeInstructionAttachedDirectories(
      JSON.stringify({ instructions: ["/rules/missing.md"] }),
      read,
    ).status,
    "unknown",
  );
});

const PRODUCT_RULES = [
  { action: "allow", pattern: "*", permission: "*" },
  { action: "deny", pattern: "*", permission: "question" },
  { action: "deny", pattern: "*", permission: "plan_enter" },
  { action: "deny", pattern: "*", permission: "plan_exit" },
];

test("opencode permission: findLast wildcard evaluation per tool", () => {
  assert.deepEqual(openCodeRuleDenies(PRODUCT_RULES), {
    question: true,
    plan_enter: true,
    plan_exit: true,
  });
  assert.deepEqual(openCodeRuleDenies([PRODUCT_RULES[0]]), {
    question: false,
    plan_enter: false,
    plan_exit: false,
  });
  assert.deepEqual(
    openCodeRuleDenies([
      ...PRODUCT_RULES,
      { action: "allow", pattern: "*", permission: "plan_*" },
    ]),
    { question: true, plan_enter: false, plan_exit: false },
  );
  // A pattern-scoped deny does not hide the tool.
  assert.equal(
    openCodeRuleDenies([
      PRODUCT_RULES[0],
      { action: "deny", pattern: "x", permission: "question" },
    ]).question,
    false,
  );
  assert.equal(openCodeRuleDenies(undefined), null);
});

test("opencode permission summary: session creates and patches, unknown without records", () => {
  assert.deepEqual(summarizeOpenCodePermissions([]), {
    sessionCreates: 0,
    permissionPatches: 0,
    denied: { question: null, plan_enter: null, plan_exit: null },
    requests: [],
  });
  const s = summarizeOpenCodePermissions([
    { kind: "session-create", at: "t1", permission: PRODUCT_RULES },
    { kind: "prompt", at: "t2" },
    {
      kind: "session-permission",
      at: "t3",
      sessionId: "ses_1",
      permission: PRODUCT_RULES.slice(1),
    },
  ]);
  assert.equal(s.sessionCreates, 1);
  assert.equal(s.permissionPatches, 1);
  assert.deepEqual(s.denied, {
    question: true,
    plan_enter: true,
    plan_exit: true,
  });
  assert.equal(s.requests.length, 2);
  const weak = summarizeOpenCodePermissions([
    { kind: "session-create", at: "t1", permission: [PRODUCT_RULES[0]] },
  ]);
  assert.deepEqual(weak.denied, {
    question: false,
    plan_enter: false,
    plan_exit: false,
  });
});

test("host receipts: channel_home mount receipts of one participant", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-attach-test-"));
  try {
    const dir = join(root, "agent-workspaces", ".mount-receipts");
    mkdirSync(dir, { recursive: true });
    const receipt = (participantId, kind = "channel_home") => ({
      schemaVersion: kind === "channel_home" ? 2 : 1,
      kind,
      cwd: PRIMARY,
      roomId: "room_1",
      additionalDirectories: [ATTACHED],
      mount: {
        participantId,
        workspaceDefinitionId: "w",
        workspaceMountRevisionId: `channel-home-${participantId}`,
        workspaceMountDigest: "sha256:x",
        modes: ["in_place"],
      },
    });
    writeFileSync(join(dir, "a.json"), JSON.stringify(receipt("p1")));
    writeFileSync(join(dir, "b.json"), JSON.stringify(receipt("p2")));
    writeFileSync(join(dir, "c.json"), JSON.stringify(receipt("p1", "x")));
    writeFileSync(join(dir, "d.json.tmp"), "{");
    assert.deepEqual(readChannelHomeReceipts(root, "p1"), [
      {
        cwd: PRIMARY,
        roomId: "room_1",
        additionalDirectories: [ATTACHED],
        workspaceMountRevisionId: "channel-home-p1",
      },
    ]);
    assert.deepEqual(readChannelHomeReceipts(join(root, "none"), "p1"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const launch = (cwd, addDirs = [], at = "2026-09-26T00:00:10.000Z") => ({
  at,
  cwd,
  subcommand: "x",
  probe: false,
  addDirs,
});
const base = {
  primaryDirectory: PRIMARY,
  attachedDirectory: ATTACHED,
  from: "2026-09-26T00:00:05.000Z",
  receipts: [
    {
      cwd: PRIMARY,
      roomId: "room_1",
      additionalDirectories: [ATTACHED],
      workspaceMountRevisionId: "channel-home-1",
    },
  ],
  placementMounts: ["channel-home-1"],
  channelWorkspace: {
    kind: "channel_home",
    additionalDirectories: [ATTACHED],
    primaryDirectory: PRIMARY,
  },
  primaryState: { state: "ready" },
};

test("attach evidence (claude): cwd from Host receipt and launches; --add-dir on every turn launch", () => {
  const e = summarizeAttachEvidence({
    ...base,
    provider: "claude",
    launches: [
      { ...launch("/elsewhere"), probe: true },
      launch(PRIMARY, [`${ATTACHED}`]),
      launch(PRIMARY, [ATTACHED]),
      launch("/early", [], "2026-09-26T00:00:01.000Z"),
    ],
  });
  assert.deepEqual(e.channelWorkspace, {
    primaryDirectory: PRIMARY,
    additionalDirectories: [ATTACHED],
    primaryState: "ready",
    attachedRecorded: true,
  });
  assert.deepEqual(e.cwd, {
    status: "primary",
    hostReceiptCwds: [PRIMARY],
    placementOnChannelHome: true,
    launchCwds: [PRIMARY],
    turnLaunches: 2,
  });
  assert.deepEqual(e.attachment, {
    provider: "claude",
    mechanism: "--add-dir=",
    status: "effective",
    detail: "2/2 turn launches",
  });
  const missing = summarizeAttachEvidence({
    ...base,
    provider: "claude",
    launches: [launch(PRIMARY, [ATTACHED]), launch(PRIMARY, [])],
  });
  assert.equal(missing.attachment.status, "missing");
  assert.equal(missing.attachment.detail, "1/2 turn launches");
  const unknown = summarizeAttachEvidence({
    ...base,
    provider: "claude",
    launches: [],
  });
  assert.equal(unknown.attachment.status, "unknown");
  assert.equal(unknown.cwd.status, "primary", "receipt alone still proves it");
  assert.equal(unknown.cwd.turnLaunches, 0);
});

test("attach evidence: a cwd other than the primary directory is reported, never hidden", () => {
  const e = summarizeAttachEvidence({
    ...base,
    provider: "kimi",
    launches: [launch("/legacy/workspace")],
    kimiLocalConfig: { status: "effective", detail: "platform-managed" },
  });
  assert.equal(e.cwd.status, "other");
  assert.deepEqual(e.cwd.launchCwds, ["/legacy/workspace"]);
  const none = summarizeAttachEvidence({
    ...base,
    receipts: [],
    placementMounts: [],
    provider: "kimi",
    launches: [],
  });
  assert.equal(none.cwd.status, "unknown");
  assert.equal(none.cwd.placementOnChannelHome, null);
  assert.deepEqual(
    summarizeAttachEvidence({
      ...base,
      placementMounts: ["mount-legacy"],
      provider: "kimi",
      launches: [],
    }).cwd.placementOnChannelHome,
    false,
  );
});

test("attach evidence (codex): runtimeWorkspaceRoots on thread/start|resume, primary first", () => {
  const request = (method, roots, cwd = PRIMARY) => ({
    kind: "thread",
    at: "2026-09-26T00:00:10.000Z",
    method,
    cwd,
    runtimeWorkspaceRoots: roots,
  });
  const e = summarizeAttachEvidence({
    ...base,
    provider: "codex",
    launches: [launch(PRIMARY)],
    codexRequests: [
      request("thread/start", [PRIMARY, ATTACHED]),
      request("thread/resume", [PRIMARY, ATTACHED]),
    ],
  });
  assert.deepEqual(e.attachment, {
    provider: "codex",
    mechanism: "runtimeWorkspaceRoots",
    status: "effective",
    detail: "2/2 thread requests; primary first",
  });
  assert.deepEqual(e.cwd.threadCwds, [PRIMARY]);
  const missing = summarizeAttachEvidence({
    ...base,
    provider: "codex",
    launches: [],
    codexRequests: [request("thread/resume", null)],
  });
  assert.equal(missing.attachment.status, "missing");
  assert.equal(
    summarizeAttachEvidence({
      ...base,
      provider: "codex",
      launches: [],
      codexRequests: [],
    }).attachment.status,
    "unknown",
  );
  // A thread cwd elsewhere makes the cwd status "other".
  assert.equal(
    summarizeAttachEvidence({
      ...base,
      provider: "codex",
      launches: [launch(PRIMARY)],
      codexRequests: [request("thread/start", [PRIMARY, ATTACHED], "/x")],
    }).cwd.status,
    "other",
  );
});

test("attach evidence (kimi, opencode): local.toml status and standing-prompt line", () => {
  const kimi = summarizeAttachEvidence({
    ...base,
    provider: "kimi",
    launches: [launch(PRIMARY)],
    kimiLocalConfig: { status: "effective", detail: "platform-managed" },
  });
  assert.deepEqual(kimi.attachment, {
    provider: "kimi",
    mechanism: ".kimi-code/local.toml",
    status: "effective",
    detail: "platform-managed",
  });
  const serve = (status, directories = []) => ({
    kind: "serve-launch",
    at: "2026-09-26T00:00:10.000Z",
    instructions: { status, directories },
  });
  const oc = summarizeAttachEvidence({
    ...base,
    provider: "opencode",
    launches: [launch(PRIMARY)],
    openCodeRequests: [serve("read", [ATTACHED]), serve("read", [ATTACHED])],
  });
  assert.deepEqual(oc.attachment, {
    provider: "opencode",
    mechanism: "standing prompt '- Attached directory:' line",
    status: "effective",
    detail: "2/2 serve launches",
  });
  assert.equal(
    summarizeAttachEvidence({
      ...base,
      provider: "opencode",
      launches: [],
      openCodeRequests: [serve("read", [])],
    }).attachment.status,
    "missing",
  );
  assert.equal(
    summarizeAttachEvidence({
      ...base,
      provider: "opencode",
      launches: [],
      openCodeRequests: [serve("unknown")],
    }).attachment.status,
    "unknown",
  );
});

test("usage records: per-round product rows and gap reasons; Kimi rows come from its wire", () => {
  assert.deepEqual(summarizeUsageRecords("kimi", { rows: 3, gapReasons: [] }), {
    rows: 3,
    gapReasons: [],
    source: "kimi-wire",
  });
  assert.deepEqual(
    summarizeUsageRecords("kimi", { rows: 0, gapReasons: ["parse_error"] }),
    { rows: 0, gapReasons: ["parse_error"], source: "none" },
  );
  assert.deepEqual(
    summarizeUsageRecords("codex", { rows: 2, gapReasons: [] }),
    { rows: 2, gapReasons: [], source: "driver-frames" },
  );
});
