// Real-browser gate for the throwaway evo console (batch 1 read-only views,
// batch 2 intervention writes, review fixes, batch 3 private box / run
// drill-down / Role revision, and the S6 batch B channel memory panel;
// docs/evo/status.zh-CN.md §44–§46). Deleted in phase 4 with apps/console.
//
// FIXTURE ONLY: the Loom service started here uses a temporary HOME,
// RAH_DATA_HOME, random port and a fake `codex` executable. Its URL, Role,
// messages and every "FAKE final answer" reply are test fixtures and must
// never be handed to a user as the product. No paid provider runs.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HttpRahClient } from "@rah-os/client-sdk";

import {
  CdpConnection,
  delay,
  evaluate,
  findChromeExecutable,
  waitForBrowserValue,
  waitForDevToolsPort,
} from "./real-browser-gate-support.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const consoleDirectory = join(repositoryDirectory, "apps", "console", "dist");
const fakeWarmAppServer = join(
  repositoryDirectory,
  "packages",
  "agent-host",
  "test",
  "fixtures",
  "fake-codex-warm-app-server.mjs",
);
if (!existsSync(join(consoleDirectory, "index.html"))) {
  throw new Error("apps/console/dist is missing; run npm run build:console");
}
if (
  !existsSync(
    join(repositoryDirectory, "apps", "web", "dist-workbench", "index.html"),
  )
) {
  throw new Error(
    "apps/web/dist-workbench is missing; run npm run build:web:workbench",
  );
}
const temporaryDirectory = realpathSync(
  mkdtempSync(join(tmpdir(), "loom-console-gate-")),
);
const screenshotDirectory = join(
  tmpdir(),
  "loom-console-browser-gate",
  new Date().toISOString().replace(/[:.]/gu, "-"),
);
const fakeHome = join(temporaryDirectory, "home");
const dataHome = join(temporaryDirectory, "data-home");
const workspaceCwd = join(temporaryDirectory, "workspace");
const binDirectory = join(temporaryDirectory, "bin");
const attachedDirectory = join(temporaryDirectory, "attached-fixture");
const missingDirectory = join(temporaryDirectory, "missing-fixture");
const fakeCodexState = join(temporaryDirectory, "fake-codex-state");
const fakeCodexModes = join(temporaryDirectory, "fake-codex-modes.jsonl");
const chromeProfileDirectory = join(temporaryDirectory, "chrome-profile");
// The gateway serves a temporary copy of the console build so the symlink
// probes below never touch the repository's dist directory.
const consoleCopy = join(temporaryDirectory, "console-dist");
const outsideSecret = join(temporaryDirectory, "outside-secret.txt");
const outsideDirectory = join(temporaryDirectory, "outside-directory");
const xssBody =
  'FIXTURE xss probe <img src=x onerror="window.__consoleXss=1"> (not a real request)';
const screenshots = [];
let browser;
let chrome;
let workbench;

try {
  for (const directory of [
    fakeHome,
    workspaceCwd,
    binDirectory,
    attachedDirectory,
    fakeCodexState,
    screenshotDirectory,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  // The startup repository guard needs git and the leftover-process sweeper
  // needs ps/lsof; nothing else leaks from PATH (no real provider CLI).
  cpSync(consoleDirectory, consoleCopy, { recursive: true });
  mkdirSync(outsideDirectory);
  writeFileSync(outsideSecret, "FIXTURE outside secret (must never be served)");
  writeFileSync(join(outsideDirectory, "leak.js"), "FIXTURE outside asset");
  symlinkSync(outsideSecret, join(consoleCopy, "linked-secret.txt"));
  symlinkSync(outsideDirectory, join(consoleCopy, "linked-directory"));
  symlinkSync(outsideDirectory, join(consoleCopy, "assets", "linked-assets"));
  for (const tool of ["git", "ps", "lsof"]) {
    symlinkSync(
      execFileSync("which", [tool], { encoding: "utf8" }).trim(),
      join(binDirectory, tool),
    );
  }
  const codexPath = join(binDirectory, "codex");
  // FAKE CLI: answers discovery; the warm app-server (`--listen unix://`) is
  // the repository's scripted fake (a `[fake:final]` turn posts "FAKE final
  // answer ..." through the Worker CLI); the per-turn stdio path posts the
  // same kind of fixture reply. No model is called.
  writeFileSync(
    codexPath,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
const mode = (value) => appendFileSync(${JSON.stringify(fakeCodexModes)}, JSON.stringify({ mode: value, args }) + "\\n");
if (args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-console-fixture",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"high"}],service_tiers:[]}]}));
} else if (args[0] === "mcp" && args[1] === "list" && args.includes("--json")) {
  // FAKE \`codex mcp list --json\`: no user MCP servers (launch isolation probe).
  process.stdout.write("[]");
} else if (args[0] === "app-server" && args.some((value) => value.startsWith("unix://"))) {
  mode("warm");
  process.env.FAKE_CODEX_STATE_DIR = ${JSON.stringify(fakeCodexState)};
  await import(${JSON.stringify(new URL(`file://${fakeWarmAppServer}`).href)});
} else if (args[0] === "app-server") {
  mode("per-turn");
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
  const threadId = "console-gate-thread";
  createInterface({input:process.stdin}).on("line", (line) => {
    const frame = JSON.parse(line);
    if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{userAgent:"console-gate-fake-codex/1"}});
    else if (frame.method === "thread/start") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:threadId}}});
    else if (frame.method === "thread/resume") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:frame.params.threadId}}});
    else if (frame.method === "turn/start") {
      const turn = "console-gate-turn-" + Date.now();
      send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:turn,status:"inProgress"}}});
      const text = frame.params.input?.[0]?.text ?? "";
      const reply = /--based-on-room-seq (\\d+)/.exec(text);
      const done = () => send({jsonrpc:"2.0",method:"turn/completed",params:{threadId,turn:{id:turn,status:"completed"}}});
      if (!reply || !text.includes("[fake:final]")) { done(); return; }
      const child = spawn(process.env.RAH_WORKER_CLI, ["worker", "message-post", "--based-on-room-seq", reply[1], "--final"], { env: process.env, stdio: ["pipe", "ignore", "ignore"] });
      child.stdin.end("FAKE final answer (per-turn fixture)");
      child.once("close", done);
    }
  });
} else process.exitCode = 2;
`,
    { mode: 0o700 },
  );
  chmodSync(codexPath, 0o700);

  const started = await startWorkbench();
  workbench = started.processHandle;
  const origin = started.descriptor.webOrigin;
  process.stdout.write(
    `CONSOLE_GATE_FIXTURE_ORIGIN (fixture only) ${origin}\n`,
  );
  const { client, cookie } = await gatewayClient(origin);
  const me = await client.request("principal.me", {});
  const humanId = me.principal.principalId;
  const humanName = me.principal.displayName ?? me.principal.handle;
  const workspace = (await client.request("workspace.list", {})).workspaces[0];
  assert.ok(workspace?.controlRoomId);
  const controlRoomId = workspace.controlRoomId;
  const head = async (roomId) =>
    (
      await client.request("room.sync", {
        consumerId: "console-gate-probe",
        roomId,
      })
    ).latestRoomSeq;
  const listChannels = async () =>
    (
      await client.request("room.list", { workspaceId: workspace.workspaceId })
    ).rooms.filter(({ kind }) => kind === "channel");
  const listMessages = async (roomId) =>
    (await client.request("message.list", { limit: 200, roomId })).messages;
  const activityOf = async (roomId, instanceId) =>
    (await client.request("room.agent.activity.list", { roomId })).agents.find(
      ({ participantId }) => participantId === instanceId,
    );

  const chromeExecutable = await findChromeExecutable();
  chrome = spawn(
    chromeExecutable,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-features=Translate",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-default-browser-check",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${chromeProfileDirectory}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const devToolsPort = await waitForDevToolsPort(
    join(chromeProfileDirectory, "DevToolsActivePort"),
    chrome,
  );
  const target = await waitForPageTarget(devToolsPort);
  browser = await CdpConnection.open(target.webSocketDebuggerUrl);
  const browserErrors = [];
  const networkErrors = [];
  const cspViolations = [];
  browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserErrors.push(
      exceptionDetails?.exception?.description ??
        exceptionDetails?.text ??
        "uncaught browser exception",
    );
  });
  browser.on("Runtime.consoleAPICalled", ({ args, type }) => {
    if (type !== "error") return;
    browserErrors.push(
      args
        .map(({ description, value }) => description ?? String(value ?? ""))
        .join(" "),
    );
  });
  browser.on("Log.entryAdded", ({ entry }) => {
    if (/Content Security Policy/iu.test(entry?.text ?? "")) {
      cspViolations.push(entry.text);
    } else if (entry?.source === "network") {
      // Refused writes (expected below) surface as failed-resource entries.
      networkErrors.push(entry.url ?? entry.text);
    } else if (entry?.level === "error") {
      browserErrors.push(`${entry.source}: ${entry.text}`);
    }
  });
  await Promise.all([
    browser.command("Page.enable"),
    browser.command("Runtime.enable"),
    browser.command("Log.enable"),
  ]);
  // CDP Fetch interception (instrumentation, not page code): holds a request
  // (delayed response) or drops a committed write's response (result unknown).
  let interceptor;
  const interceptErrors = [];
  browser.on("Fetch.requestPaused", (params) => {
    const handler = interceptor;
    const settle =
      handler === undefined
        ? browser.command("Fetch.continueRequest", {
            requestId: params.requestId,
          })
        : handler(params);
    void Promise.resolve(settle).catch((error) =>
      interceptErrors.push(String(error)),
    );
  });
  const intercept = async (patterns, handler) => {
    interceptor = handler;
    await browser.command("Fetch.enable", { patterns });
  };
  const stopIntercept = async () => {
    await browser.command("Fetch.disable");
    interceptor = undefined;
  };
  // Instrumentation injected by CDP (not page content): record CSP reports.
  await browser.command("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__cspViolations.push(event.violatedDirective + " " + event.blockedURI);
      });`,
  });
  await viewport(1_440, 1_000, false);

  await browser.command("Page.navigate", { url: `${origin}/_rah/console/` });
  await waitForBrowserValue(
    browser,
    `document.querySelector("#connection")?.textContent?.includes("已连接")`,
    { description: "console connection and identity", timeoutMs: 20_000 },
  );
  const connectionText = await textOf("#connection");
  assert.match(connectionText, new RegExp(escapeRegExp(humanName), "u"));
  assert.match(connectionText, new RegExp(escapeRegExp(workspace.name), "u"));

  // --- 1. Create a Channel through the UI (with attached directory). ---
  await waitForBrowserValue(
    browser,
    `document.querySelector("#create-channel-form") !== null`,
    { description: "create channel form" },
  );
  const channelsBefore = (await listChannels()).length;
  await setValue("#create-channel-name", "console-gate-fixture");
  await setValue("#create-channel-slug", "console-gate-fixture");
  await setValue("#create-channel-directories", "relative/fixture-path");
  await click("#create-channel-submit");
  await waitForText("#create-channel-status", "附加目录无效");
  assert.equal(
    (await listChannels()).length,
    channelsBefore,
    "the frontend schema precheck sends nothing",
  );
  await setValue("#create-channel-directories", missingDirectory);
  await click("#create-channel-submit");
  await waitForText("#create-channel-status", "创建失败：");
  let hostRefusal;
  try {
    await client.request("room.create", {
      additionalDirectories: [missingDirectory],
      basedOnControlRoomSeq: await head(controlRoomId),
      idempotencyKey: "console-gate-missing-directory-probe",
      kind: "channel",
      name: "console-gate-probe",
      slug: "console-gate-probe",
      workspaceId: workspace.workspaceId,
    });
  } catch (error) {
    hostRefusal = error;
  }
  assert.ok(hostRefusal, "the server refuses a missing attached directory");
  assert.ok(
    (await textOf("#create-channel-status")).includes(hostRefusal.message),
    "the Host refusal is shown verbatim",
  );
  const hostRefusalText = await textOf("#create-channel-status");
  assert.equal((await listChannels()).length, channelsBefore);
  await setValue("#create-channel-directories", `${attachedDirectory}\n`);
  // Delayed response + stale retry: the first request is held, another
  // control-Room write lands meanwhile (so it comes back stale) and the form
  // is edited by script while disabled; the retried payload must not change.
  const createRequests = [];
  let releaseCreate;
  const createHeld = new Promise((resolvePromise) => {
    releaseCreate = resolvePromise;
  });
  await intercept(
    [{ requestStage: "Request", urlPattern: "*/v3/client/rooms/create" }],
    async (params) => {
      createRequests.push(JSON.parse(params.request.postData ?? "{}"));
      if (createRequests.length === 1) {
        releaseCreate(params.requestId);
        return;
      }
      await browser.command("Fetch.continueRequest", {
        requestId: params.requestId,
      });
    },
  );
  await click("#create-channel-submit");
  const heldCreate = await createHeld;
  const frozenForm = await evaluate(
    browser,
    `["#create-channel-name", "#create-channel-slug", "#create-channel-directories"].map((selector) => document.querySelector(selector).disabled)`,
  );
  assert.deepEqual(
    frozenForm,
    [true, true, true],
    "the create form is frozen while its intent is pending",
  );
  await client.request("room.create", {
    basedOnControlRoomSeq: await head(controlRoomId),
    idempotencyKey: "console-gate-side-channel",
    kind: "channel",
    name: "console-gate-side",
    slug: "console-gate-side",
    workspaceId: workspace.workspaceId,
  });
  await setValue("#create-channel-name", "console-gate-edited");
  await browser.command("Fetch.continueRequest", { requestId: heldCreate });
  await waitForText("#create-channel-status", "已创建 #console-gate-fixture");
  await stopIntercept();
  assert.ok(
    createRequests.length >= 2,
    `the stale refusal was retried (${String(createRequests.length)} requests)`,
  );
  for (const request of createRequests) {
    assert.equal(request.idempotencyKey, createRequests[0].idempotencyKey);
    assert.equal(request.name, "console-gate-fixture");
    assert.equal(request.slug, "console-gate-fixture");
    assert.deepEqual(request.additionalDirectories, [attachedDirectory]);
  }
  assert.equal(
    (await listChannels()).filter(({ slug }) => slug === "console-gate-fixture")
      .length,
    1,
  );
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#create-channel-name").value`,
    ),
    "console-gate-edited",
    "an edited field is not cleared by the success of the earlier intent",
  );
  const createStaleRequests = createRequests.length;
  const channelHref = await waitForBrowserValue(
    browser,
    `document.querySelector("#create-channel-result a")?.getAttribute("href")`,
    { description: "created channel link", timeoutMs: 20_000 },
  );
  const channelId = decodeURIComponent(
    channelHref.replace(/^#\/channel\//u, ""),
  );
  const createdRoom = (await listChannels()).find(
    ({ roomId }) => roomId === channelId,
  );
  const primaryDirectory = createdRoom?.channelWorkspace?.primaryDirectory;
  assert.ok(primaryDirectory, "the channel records its primary directory");
  assert.ok(
    primaryDirectory.startsWith(join(fakeHome, ".loom", "channel-workspaces")),
    "the primary directory lives under the temporary HOME",
  );
  assert.deepEqual(createdRoom.channelWorkspace.additionalDirectories, [
    attachedDirectory,
  ]);
  await waitForBrowserValue(
    browser,
    `document.querySelector("#create-channel-result .primary-state .field-value")?.textContent === "ready"`,
    { description: "created channel primary.state ready", timeoutMs: 40_000 },
  );
  assert.equal(
    await textOf("#create-channel-result .primary-directory .field-value"),
    primaryDirectory,
  );
  await screenshot("create-channel-1440x1000.png");

  // --- 2. Channel page: XSS probe posted through the composer. ---
  await navigateHash(`#/channel/${encodeURIComponent(channelId)}`);
  await waitForBrowserValue(
    browser,
    `document.querySelector("#composer-input") !== null && document.querySelector("#channel-title")?.textContent === "#console-gate-fixture"`,
    { description: "channel page with composer" },
  );
  await waitForText("#sos-state", "急停状态未知（当前事件窗口无记录）");
  const sosUnknownText = await textOf("#sos-state");
  await typeInto("#composer-input", xssBody);
  await pressEnter();
  await waitForBrowserValue(
    browser,
    `[...document.querySelectorAll("#message-list .message-body")].some((node) => node.textContent === ${JSON.stringify(xssBody)})`,
    { description: "injected message body rendered as text" },
  );
  assert.equal(
    await evaluate(browser, `document.querySelectorAll("img").length`),
    0,
  );
  assert.equal(
    await evaluate(browser, `window.__consoleXss === undefined`),
    true,
  );

  // --- 3. Create a Role through the UI from the Host catalog. ---
  await navigateHash("#/roles");
  await waitForBrowserValue(
    browser,
    `document.querySelector("#role-runtime")?.options.length > 1`,
    { description: "published CLI choices", timeoutMs: 20_000 },
  );
  const inventory = await client.request("host.runtime.list", {});
  const runtime = inventory.runtimes.find(
    ({ runtimeOfferId }) => runtimeOfferId !== undefined,
  );
  const binding = runtime?.modelBindingDescriptors.find(
    ({ modelId }) => modelId === "gpt-console-fixture",
  );
  assert.ok(runtime?.runtimeOfferId && binding);
  const runtimeOptions = await evaluate(
    browser,
    `[...document.querySelector("#role-runtime").options].map((option) => option.value).filter(Boolean)`,
  );
  assert.deepEqual(
    runtimeOptions,
    inventory.runtimes
      .filter((entry) => entry.available && entry.runtimeOfferId !== undefined)
      .map((entry) => entry.runtimeOfferId),
    "CLI choices are exactly the published available offers",
  );
  await setValue("#role-display-name", "FIXTURE 门禁 Reviewer");
  await setValue("#role-handle", "console-gate-reviewer");
  await setValue("#role-role", "fixture reviewer");
  await setValue(
    "#role-instructions",
    "FIXTURE ONLY: console browser gate role.",
  );
  await setValue("#role-runtime", runtime.runtimeOfferId);
  const bindingOptions = await evaluate(
    browser,
    `[...document.querySelector("#role-binding").options].map((option) => option.value).filter(Boolean)`,
  );
  assert.deepEqual(
    bindingOptions,
    runtime.modelBindingDescriptors.map(({ modelBindingId }) => modelBindingId),
    "model choices are exactly the offer's published bindings",
  );
  await setValue("#role-binding", binding.modelBindingId);
  await setValue("#role-reasoning", "high");
  await click("#role-create-submit");
  await waitForText("#role-create-status", "已创建 Role");
  const roles = await client.request("role.list", { controlRoomId });
  const role = roles.roles.find(
    ({ configuration }) => configuration.handle === "console-gate-reviewer",
  );
  assert.deepEqual(role?.configuration.modelIntent, {
    exactBindingIds: [binding.modelBindingId],
    fallback: "disabled",
    reasoning: "high",
  });
  assert.equal(role.configuration.runtimeOfferId, runtime.runtimeOfferId);

  // --- 4. Instantiate it into the Channel; the panel shows idle. ---
  await navigateHash(`#/channel/${encodeURIComponent(channelId)}`);
  await waitForBrowserValue(
    browser,
    `[...document.querySelector("#instantiate-role")?.options ?? []].some((option) => option.value === ${JSON.stringify(role.roleId)})`,
    { description: "role choice on the channel page" },
  );
  await setValue("#instantiate-role", role.roleId);
  await click("#instantiate-submit");
  await waitForText("#instantiate-status", "已实例化");
  const instance = (
    await client.request("role.list", { controlRoomId })
  ).instances.find(
    ({ channelId: id, roleId }) => id === channelId && roleId === role.roleId,
  );
  assert.ok(instance, "the instance exists in the channel");
  const instanceId = instance.instanceId;
  const instanceHandle = (
    await client.request("agent.list", { controlRoomId })
  ).agents.find(
    ({ definition }) => definition.agentId === instance.agentId,
  )?.handle;
  assert.ok(instanceHandle);
  const card = `.instance-card[data-instance-id=${JSON.stringify(instanceId)}]`;
  const stateText = `document.querySelector('${card} .instance-state .field-value')?.textContent`;
  await waitForBrowserValue(browser, `${stateText} === "空闲"`, {
    description: "new instance shows idle",
    timeoutMs: 20_000,
  });
  assert.equal(await textOf(`${card} .instance-queued .field-value`), "排队 0");
  // Contract §5: no run yet, so the session's compaction count is unknown.
  assert.equal(
    await textOf(`${card} .instance-compactions .field-value`),
    "未知（本 session 尚无运行轨迹）",
  );

  // --- 4b. Revise the Role (binding only from the Host catalog). ---
  await navigateHash("#/roles");
  const roleCard = `.role-card[data-role-id=${JSON.stringify(role.roleId)}]`;
  await click(`${roleCard} .role-revise-open`);
  await waitForText("#role-revise-target", role.roleRevisionId);
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#role-revise-binding").value`,
    ),
    binding.modelBindingId,
    "the revision form starts from the current configuration",
  );
  assert.deepEqual(
    await evaluate(
      browser,
      `[...document.querySelector("#role-revise-binding").options].map((option) => option.value).filter(Boolean)`,
    ),
    runtime.modelBindingDescriptors.map(({ modelBindingId }) => modelBindingId),
    "revision model choices are exactly the offer's published bindings",
  );
  await setValue(
    "#role-revise-instructions",
    "FIXTURE ONLY: console browser gate role, revision 2.",
  );
  await click("#role-revise-submit");
  await waitForText("#role-revise-status", "已保存为修订");
  const revisedRole = (
    await client.request("role.list", { controlRoomId })
  ).roles.find(({ roleId }) => roleId === role.roleId);
  assert.notEqual(revisedRole.roleRevisionId, role.roleRevisionId);
  assert.equal(
    revisedRole.configuration.instructions,
    "FIXTURE ONLY: console browser gate role, revision 2.",
  );
  assert.deepEqual(revisedRole.configuration.modelIntent, {
    exactBindingIds: [binding.modelBindingId],
    fallback: "disabled",
    reasoning: "high",
  });
  assert.ok(
    (await textOf("#role-revise-status")).includes(revisedRole.roleRevisionId),
  );
  await navigateHash(`#/channel/${encodeURIComponent(channelId)}`);
  await waitForText(`${card} .revision`, "Role 已有新修订");
  const staleInstance = (
    await client.request("role.list", { controlRoomId })
  ).instances.find(({ instanceId: id }) => id === instanceId);
  assert.equal(staleInstance.isCurrent, false);
  assert.equal(staleInstance.roleRevisionId, role.roleRevisionId);

  // --- 5. Send with Enter (mention): waking/working, reply, back to idle. ---
  await evaluate(
    browser,
    `(() => {
      window.__stateLog = [];
      window.__queuedLog = [];
      window.__stateTimer = setInterval(() => {
        const value = ${stateText};
        if (value && window.__stateLog.at(-1) !== value) window.__stateLog.push(value);
        const queued = document.querySelector('${card} .instance-queued .field-value')?.textContent;
        if (queued && window.__queuedLog.at(-1) !== queued) window.__queuedLog.push(queued);
      }, 50);
    })()`,
  );
  const apiStates = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const entry = await activityOf(channelId, instanceId).catch(
        () => undefined,
      );
      const label =
        entry === undefined
          ? "absent"
          : `${entry.state}${entry.queued ? "+queued" : ""}`;
      if (apiStates.at(-1) !== label) apiStates.push(label);
      await delay(100);
    }
  })();
  const pingBody = "FIXTURE ping [fake:final]";
  await setValue("#composer-mention", instanceId);
  await typeInto("#composer-input", pingBody);
  await pressEnter();
  await waitForText("#composer-status", "已发送");
  assert.equal(
    await evaluate(browser, `document.querySelector("#composer-input").value`),
    "",
  );
  const humanPing = (await listMessages(channelId)).find(
    ({ actorId, body }) => actorId === humanId && body.endsWith(pingBody),
  );
  assert.equal(humanPing?.body, `@${instanceHandle} ${pingBody}`);
  await waitForBrowserValue(
    browser,
    `[...document.querySelectorAll('#message-list .message[data-actor-id=${JSON.stringify(instanceId)}] .message-body')].some((node) => node.textContent.startsWith("FAKE final answer"))`,
    { description: "fake CLI reply in the channel", timeoutMs: 120_000 },
  );
  await waitForBrowserValue(browser, `${stateText} === "空闲"`, {
    description: "instance back to idle",
    timeoutMs: 30_000,
  });
  sampling = false;
  await sampler;
  const uiStates = await evaluate(
    browser,
    `(() => { clearInterval(window.__stateTimer); return window.__stateLog; })()`,
  );
  const uiQueued = await evaluate(browser, "window.__queuedLog");
  assert.ok(
    uiQueued.includes("排队 1（频道 1，私聊 0）"),
    `the panel showed the queued count (${uiQueued.join(" -> ")})`,
  );
  assert.equal(uiQueued.at(-1), "排队 0");
  assert.ok(
    uiStates.includes("排队或启动中") || uiStates.includes("运行中"),
    `the panel showed waking or working (${uiStates.join(" -> ")})`,
  );
  assert.equal(uiStates.at(-1), "空闲");
  assert.ok(
    apiStates.some(
      (label) => label.startsWith("waking") || label.startsWith("working"),
    ),
    `the API reported waking or working (${apiStates.join(" -> ")})`,
  );
  await screenshot("channel-reply-1440x1000.png");

  // --- 5b. RunAttempt drill-down equals the raw API response. ---
  const channelRunIds = await waitForBrowserValue(
    browser,
    `(() => { const ids = [...document.querySelectorAll('${card} .run-open')].map((node) => node.getAttribute("data-run-attempt-id")); return ids.length > 0 ? ids : null; })()`,
    { description: "channel runs in the instance card", timeoutMs: 20_000 },
  );
  await click(`${card} .run-open`);
  const channelRun = await checkRunDetail(
    client,
    instance.agentId,
    channelRunIds[0],
  );
  await screenshot("run-detail-1440x1000.png");

  // --- 5c. Private box: open, send, and the Channel never shows it. ---
  await click(`${card} .action-open-direct`);
  await waitForBrowserValue(
    browser,
    `location.hash.startsWith("#/direct/") && (document.querySelector("#direct-title")?.textContent ?? "").startsWith("私聊")`,
    { description: "private box page", timeoutMs: 20_000 },
  );
  const directId = decodeURIComponent(
    (await evaluate(browser, "location.hash")).replace(/^#\/direct\//u, ""),
  );
  const directRoom = (
    await client.request("room.list", { workspaceId: workspace.workspaceId })
  ).rooms.find(({ roomId }) => roomId === directId);
  assert.equal(directRoom?.kind, "direct");
  assert.deepEqual(directRoom.instancePrivateBox, {
    active: true,
    instanceId,
  });
  // Full review 2 A-P2-3: the private box states the shared memory scope.
  await waitForText("#direct-memory-scope", "私聊中写入的记忆属于频道共享记忆");
  const privateBody = "FIXTURE private-box secret [fake:final]";
  await typeInto("#composer-input", privateBody);
  await pressEnter();
  await waitForText("#composer-status", "已发送");
  const privateMessages = await listMessages(directId);
  assert.ok(
    privateMessages.some(
      ({ actorId, body }) => actorId === humanId && body === privateBody,
    ),
    "the private message is in the private box",
  );
  await waitForBrowserValue(
    browser,
    `[...document.querySelectorAll('#message-list .message[data-actor-id=${JSON.stringify(instanceId)}] .message-body')].some((node) => node.textContent.startsWith("FAKE final answer"))`,
    { description: "fake CLI reply in the private box", timeoutMs: 120_000 },
  );
  const directRunIds = await waitForBrowserValue(
    browser,
    `(() => { const ids = [...document.querySelectorAll("#direct-instance .run-open")].map((node) => node.getAttribute("data-run-attempt-id")); return ids.length > 0 ? ids : null; })()`,
    { description: "private-box runs", timeoutMs: 30_000 },
  );
  await click("#direct-instance .run-open");
  await checkRunDetail(client, instance.agentId, directRunIds[0]);
  await screenshot("private-box-1440x1000.png");
  await navigateHash(`#/channel/${encodeURIComponent(channelId)}`);
  await waitForBrowserValue(
    browser,
    `document.querySelector("#channel-title")?.textContent === "#console-gate-fixture" && document.querySelectorAll("#message-list .message").length > 0 && document.querySelector('${card} .open-direct-link') !== null && !document.querySelector('${card} .open-direct-link').hidden`,
    { description: "channel page again with the private-box link" },
  );
  await waitForBrowserValue(
    browser,
    `document.querySelectorAll('${card} .run-open').length > 0`,
    { description: "channel runs again" },
  );
  const channelApiMessages = (await listMessages(channelId)).slice(-50);
  const channelView = await evaluate(
    browser,
    `({
      bodies: [...document.querySelectorAll("#message-list .message-body")].map((node) => node.textContent),
      text: document.querySelector("#console-main")?.innerText ?? document.body.innerText,
      runIds: [...document.querySelectorAll('${card} .run-open')].map((node) => node.getAttribute("data-run-attempt-id")),
    })`,
  );
  assert.equal(
    channelView.text.includes("private-box secret"),
    false,
    "the Channel page shows no private-box content",
  );
  assert.deepEqual(
    channelView.bodies,
    channelApiMessages.map(({ body }) => body),
    "the Channel page shows exactly the Channel's own messages",
  );
  for (const runId of directRunIds) {
    assert.equal(
      channelView.runIds.includes(runId),
      false,
      "a private-box run is not listed on the Channel",
    );
  }
  await waitForBrowserValue(browser, `${stateText} === "空闲"`, {
    description: "idle after the private-box turn",
    timeoutMs: 30_000,
  });

  // --- 5d. Result unknown: the response of a committed post is dropped. ---
  const lostBody = "FIXTURE lost response probe [fake:final]";
  const lostRequests = [];
  await intercept(
    [{ requestStage: "Response", urlPattern: "*/v3/client/messages/post" }],
    async (params) => {
      lostRequests.push(JSON.parse(params.request.postData ?? "{}"));
      await browser.command(
        lostRequests.length === 1
          ? "Fetch.failRequest"
          : "Fetch.continueRequest",
        lostRequests.length === 1
          ? { errorReason: "ConnectionReset", requestId: params.requestId }
          : { requestId: params.requestId },
      );
    },
  );
  const countBody = async (roomId, body) =>
    (await listMessages(roomId)).filter((message) => message.body === body)
      .length;
  await setValue("#composer-mention", "");
  await typeInto("#composer-input", lostBody);
  await pressEnter();
  await waitForText("#composer-status", "结果未知");
  assert.equal(
    await countBody(channelId, lostBody),
    1,
    "the server committed the post whose response was lost",
  );
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#composer-unknown").hidden`,
    ),
    false,
  );
  const unknownText = await textOf("#composer-status");
  await screenshot("unknown-result-1440x1000.png");
  const draftWhileUnknown = "FIXTURE draft typed while the result is unknown";
  await typeInto("#composer-input", draftWhileUnknown);
  await pressEnter();
  await waitForText("#composer-status", "上一次操作结果未知");
  assert.equal(await countBody(channelId, draftWhileUnknown), 0);
  await click("#composer-retry");
  await waitForText("#composer-status", "重试核实：原请求已执行");
  await stopIntercept();
  assert.equal(
    await countBody(channelId, lostBody),
    1,
    "the retry replayed the committed post instead of posting again",
  );
  assert.equal(lostRequests.length, 2);
  assert.deepEqual(lostRequests[1], lostRequests[0], "identical retry request");
  assert.equal(
    await evaluate(browser, `document.querySelector("#composer-input").value`),
    draftWhileUnknown,
    "the new draft survives the retried intent's success",
  );
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#composer-unknown").hidden`,
    ),
    true,
  );

  // --- 5d-2. Unknown -> the verification gets 401 -> access restored ->
  // the original key replays once. Request 1 commits and its response is
  // dropped; request 2 (the first verification) is answered 401 by CDP before
  // it reaches the gateway; request 3 goes through and replays. ---
  const authBody = "FIXTURE unknown then 401 probe [fake:final]";
  const authRequests = [];
  let authResponses = 0;
  await intercept(
    [
      { requestStage: "Request", urlPattern: "*/v3/client/messages/post" },
      { requestStage: "Response", urlPattern: "*/v3/client/messages/post" },
    ],
    async (params) => {
      if (
        params.responseStatusCode !== undefined ||
        params.responseErrorReason !== undefined
      ) {
        authResponses += 1;
        await browser.command(
          authResponses === 1 ? "Fetch.failRequest" : "Fetch.continueRequest",
          authResponses === 1
            ? { errorReason: "ConnectionReset", requestId: params.requestId }
            : { requestId: params.requestId },
        );
        return;
      }
      authRequests.push(JSON.parse(params.request.postData ?? "{}"));
      if (authRequests.length === 2) {
        await browser.command("Fetch.fulfillRequest", {
          body: Buffer.from(
            JSON.stringify({
              error: {
                code: "session_expired",
                message: "FIXTURE injected 401 (CDP), not the gateway",
              },
            }),
          ).toString("base64"),
          requestId: params.requestId,
          responseCode: 401,
          responseHeaders: [
            { name: "content-type", value: "application/json" },
          ],
        });
        return;
      }
      await browser.command("Fetch.continueRequest", {
        requestId: params.requestId,
      });
    },
  );
  await setValue("#composer-input", "");
  await typeInto("#composer-input", authBody);
  await pressEnter();
  await waitForText("#composer-status", "结果未知");
  assert.equal(await countBody(channelId, authBody), 1, "committed once");
  await click("#composer-retry");
  await waitForText("#composer-status", "本次核实未成功");
  const verifyFailedText = await textOf("#composer-status");
  assert.match(verifyFailedText, /HTTP 401/u);
  assert.match(verifyFailedText, /原操作结果仍未知/u);
  assert.doesNotMatch(verifyFailedText, /请刷新页面/u);
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#composer-unknown").hidden`,
    ),
    false,
    "the unknown intent survives the refused verification",
  );
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#composer-send").disabled`,
    ),
    true,
    "no new send (new key) while the original result is unknown",
  );
  await screenshot("unknown-verify-401-1440x1000.png");
  // Leaving the page asks first; dismissing keeps the page and the intent.
  const dialogs = [];
  const onDialog = (params) => {
    dialogs.push(params);
    void browser
      .command("Page.handleJavaScriptDialog", { accept: false })
      .catch((error) => interceptErrors.push(String(error)));
  };
  browser.on("Page.javascriptDialogOpening", onDialog);
  const hashBeforeLeave = await evaluate(browser, "location.hash");
  await navigateHash("#/roles");
  await waitUntil(async () => dialogs.length === 1, 10_000);
  await waitUntil(
    async () => (await evaluate(browser, "location.hash")) === hashBeforeLeave,
    10_000,
  );
  assert.equal(dialogs[0].type, "confirm");
  assert.match(dialogs[0].message, /幂等键/u);
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#composer-unknown")?.hidden`,
    ),
    false,
    "dismissing the leave prompt keeps the page and the unknown intent",
  );
  await click("#composer-retry");
  await waitForText("#composer-status", "重试核实：原请求已执行");
  await stopIntercept();
  assert.equal(authRequests.length, 3);
  assert.deepEqual(authRequests[1], authRequests[0], "verification = original");
  assert.deepEqual(authRequests[2], authRequests[0], "replay = original");
  assert.equal(
    await countBody(channelId, authBody),
    1,
    "unknown -> 401 -> restored -> replay took effect exactly once",
  );
  // Resolved: navigation no longer asks.
  await navigateHash("#/roles");
  await waitUntil(
    async () =>
      (await evaluate(
        browser,
        `document.querySelector("#role-create-submit") !== null`,
      )) === true,
    20_000,
  );
  assert.equal(dialogs.length, 1, "no prompt once nothing is unresolved");
  await navigateHash(hashBeforeLeave);
  await waitUntil(
    async () =>
      (await evaluate(
        browser,
        `document.querySelector("#composer-input") !== null`,
      )) === true,
    20_000,
  );

  // --- 5e. Delayed response + stale retry: the draft typed meanwhile stays. ---
  const delayedBody = "FIXTURE delayed original [fake:final]";
  const editedDraft = "FIXTURE edited while the send was in flight";
  const delayedRequests = [];
  let releaseDelayed;
  const delayedHeld = new Promise((resolvePromise) => {
    releaseDelayed = resolvePromise;
  });
  await intercept(
    [{ requestStage: "Request", urlPattern: "*/v3/client/messages/post" }],
    async (params) => {
      delayedRequests.push(JSON.parse(params.request.postData ?? "{}"));
      if (delayedRequests.length === 1) {
        releaseDelayed(params.requestId);
        return;
      }
      await browser.command("Fetch.continueRequest", {
        requestId: params.requestId,
      });
    },
  );
  await typeInto("#composer-input", delayedBody);
  await pressEnter();
  const heldPost = await delayedHeld;
  await client.request("message.post", {
    basedOnRoomSeq: await head(channelId),
    body: "FIXTURE concurrent write while a send is held [fake:final]",
    idempotencyKey: "console-gate-concurrent-write",
    recipients: [],
    roomId: channelId,
  });
  await typeInto("#composer-input", editedDraft);
  await browser.command("Fetch.continueRequest", { requestId: heldPost });
  await waitForText("#composer-status", "已发送");
  await stopIntercept();
  assert.ok(
    delayedRequests.length >= 2,
    `the stale refusal was retried (${String(delayedRequests.length)} requests)`,
  );
  for (const request of delayedRequests) {
    assert.equal(request.idempotencyKey, delayedRequests[0].idempotencyKey);
    assert.equal(request.body, delayedBody);
  }
  assert.equal(await countBody(channelId, delayedBody), 1);
  assert.equal(await countBody(channelId, editedDraft), 0);
  assert.equal(
    await evaluate(browser, `document.querySelector("#composer-input").value`),
    editedDraft,
    "a draft edited during the delayed send is not cleared",
  );
  await setValue("#composer-input", "");
  await waitForBrowserValue(browser, `${stateText} === "空闲"`, {
    description: "idle after the unknown-result probes",
    timeoutMs: 60_000,
  });

  // --- 6. Shift+Enter inserts a newline; IME confirmation never sends. ---
  const countBefore = (await listMessages(channelId)).length;
  await setValue("#composer-mention", "");
  await typeInto("#composer-input", "FIXTURE line one");
  await pressEnter({ shift: true });
  await browser.command("Input.insertText", { text: "line two" });
  assert.equal(
    await evaluate(browser, `document.querySelector("#composer-input").value`),
    "FIXTURE line one\nline two",
  );
  const imeNotCanceled = await evaluate(
    browser,
    `document.querySelector("#composer-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }))`,
  );
  assert.equal(imeNotCanceled, true, "a composing Enter is left to the IME");
  await delay(1_500);
  assert.equal(
    (await listMessages(channelId)).length,
    countBefore,
    "nothing was sent",
  );

  // --- 7. One pending send refuses keyboard and button alike. ---
  const doubleBody = "FIXTURE double submit probe [fake:final]";
  await setValue("#composer-input", doubleBody);
  await evaluate(
    browser,
    `(() => {
      const input = document.querySelector("#composer-input");
      const enter = () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      enter();
      const disabledWhilePending = document.querySelector("#composer-send").disabled;
      enter();
      document.querySelector("#composer-send").click();
      window.__disabledWhilePending = disabledWhilePending;
    })()`,
  );
  assert.equal(await evaluate(browser, "window.__disabledWhilePending"), true);
  await waitForText("#composer-status", "已发送");
  await delay(500);
  assert.equal(
    (await listMessages(channelId)).filter(({ body }) => body === doubleBody)
      .length,
    1,
    "exactly one message for one pending action",
  );
  await waitForBrowserValue(
    browser,
    `[...document.querySelectorAll('#message-list .message[data-actor-id=${JSON.stringify(instanceId)}]')].length >= 2`,
    { description: "second fake reply", timeoutMs: 60_000 },
  );
  await waitForBrowserValue(browser, `${stateText} === "空闲"`, {
    description: "idle after the double-submit probe",
    timeoutMs: 30_000,
  });

  // --- 7b. Channel memory panel (S6 batch B): legacy import seeds memory
  // through the Human API, then list, search, body + history, pin,
  // invalidate + restore, a 409 revision conflict, delete with the boundary
  // dialog and a switch change; the backend state is asserted after each. ---
  // FIXTURE legacy per-instance memory, written where the Host keeps it
  // (state/supervisors/agent-memory/<sha256(participant)>): evo instances no
  // longer create it, so this stands in for data left by an older install.
  const legacyWorkspace = join(
    dataHome,
    "state",
    "supervisors",
    "agent-memory",
    createHash("sha256").update(instanceId).digest("hex"),
  );
  mkdirSync(join(legacyWorkspace, "notes"), { mode: 0o700, recursive: true });
  for (const directory of [
    dirname(legacyWorkspace),
    legacyWorkspace,
    join(legacyWorkspace, "notes"),
  ]) {
    chmodSync(directory, 0o700);
  }
  writeFileSync(
    join(legacyWorkspace, "MEMORY.md"),
    "# FIXTURE legacy index\n- notes/gate-alpha.md\n- notes/gate-beta.md\n",
    { mode: 0o600 },
  );
  writeFileSync(
    join(legacyWorkspace, "notes", "gate-alpha.md"),
    "# FIXTURE alpha\nFIXTURE periwinkle fact for the console gate.\n",
    { mode: 0o600 },
  );
  writeFileSync(
    join(legacyWorkspace, "notes", "gate-beta.md"),
    "# FIXTURE beta\nFIXTURE second legacy note.\n",
    { mode: 0o600 },
  );
  const memoryList = async (flags = {}) =>
    await client.request("memory.list", { channelId, ...flags });
  const memoryRead = async (entryId) =>
    (await client.request("memory.read", { entryId })).entry;
  assert.equal((await memoryList()).total, 0, "no memory before the import");
  await waitForBrowserValue(
    browser,
    `document.querySelector("#memory-panel") !== null && document.querySelector("#memory-import-note")?.textContent.includes("一次性 Human 导入")`,
    { description: "memory panel with the import note" },
  );
  await waitForText("#memory-list", "没有记忆");
  const importRow = `.memory-import-row[data-instance-id=${JSON.stringify(instanceId)}]`;
  await waitForBrowserValue(
    browser,
    `document.querySelector('${importRow} .memory-import-files') !== null`,
    { description: "per-instance import controls" },
  );
  await setValue(
    `${importRow} .memory-import-paths`,
    "notes/gate-alpha.md\nnotes/gate-beta.md",
  );
  await click(`${importRow} .memory-import-files`);
  await waitForText("#memory-import-status", "导入完成");
  assert.equal(
    await evaluate(
      browser,
      `document.querySelectorAll('#memory-import-results [data-status="created"]').length`,
    ),
    2,
  );
  let listed = await memoryList();
  assert.equal(listed.total, 2, "exactly the two selected files were imported");
  const alpha = listed.entries.find(({ description }) =>
    description.includes("notes/gate-alpha.md"),
  );
  const beta = listed.entries.find(({ description }) =>
    description.includes("notes/gate-beta.md"),
  );
  assert.ok(alpha && beta);
  const alphaDetail = await memoryRead(alpha.entryId);
  assert.equal(alphaDetail.provenance.actorKind, "human");
  assert.deepEqual(alphaDetail.provenance.importedFrom, {
    instanceId,
    path: "notes/gate-alpha.md",
  });
  // A second click is a new request: the files are reported as imported.
  await click(`${importRow} .memory-import-files`);
  await waitForBrowserValue(
    browser,
    `document.querySelectorAll('#memory-import-results [data-status="existing"]').length === 2`,
    { description: "second import reports existing" },
  );
  assert.equal((await memoryList()).total, 2, "the import never duplicates");

  const entryRow = (entryId) =>
    `#memory-list .memory-entry[data-entry-id=${JSON.stringify(entryId)}]`;
  await waitForText(`${entryRow(alpha.entryId)} .memory-author`, "导入自实例");
  assert.equal(
    await textOf(`${entryRow(alpha.entryId)} .memory-revision .field-value`),
    String(alpha.revision),
  );
  assert.equal(
    await textOf(`${entryRow(alpha.entryId)} .memory-description .field-value`),
    alpha.description,
  );

  // Search goes to memory.search; the UI shows exactly its result.
  const found = await client.request("memory.search", {
    channelId,
    query: "periwinkle",
  });
  assert.deepEqual(
    found.entries.map(({ entryId }) => entryId),
    [alpha.entryId],
  );
  await setValue("#memory-search", "periwinkle");
  await click("#memory-search-submit");
  await waitForText("#memory-list-status", "检索");
  await waitForBrowserValue(
    browser,
    `JSON.stringify([...document.querySelectorAll("#memory-list .memory-entry")].map((node) => node.getAttribute("data-entry-id"))) === ${JSON.stringify(JSON.stringify([alpha.entryId]))}`,
    { description: "search result rows" },
  );
  await click("#memory-search-clear");
  await waitForBrowserValue(
    browser,
    `document.querySelectorAll("#memory-list .memory-entry").length === 2`,
    { description: "full list after clearing the search" },
  );

  // Body and revision history.
  await click(`${entryRow(alpha.entryId)} .memory-open`);
  await waitForText("#memory-detail-body", "FIXTURE periwinkle fact");
  await waitForBrowserValue(
    browser,
    `document.querySelectorAll("#memory-history .memory-revision").length === 1`,
    { description: "revision history" },
  );

  // Pin.
  await click("#memory-pin");
  await waitForText("#memory-action-status", "已置顶");
  let alphaNow = await memoryRead(alpha.entryId);
  assert.equal(alphaNow.pinned, true);
  assert.equal(alphaNow.revision, alpha.revision + 1);

  // Invalidate needs a reason: nothing is sent without one.
  await click("#memory-invalidate");
  await waitForText("#memory-action-status", "请填写原因");
  assert.equal((await memoryRead(alpha.entryId)).state, "active");
  await setValue("#memory-reason", "FIXTURE outdated fact");
  await click("#memory-invalidate");
  await waitForText("#memory-action-status", "已标为失效");
  alphaNow = await memoryRead(alpha.entryId);
  assert.equal(alphaNow.state, "invalidated");
  assert.equal(
    (await memoryList()).entries.some(
      ({ entryId }) => entryId === alpha.entryId,
    ),
    false,
    "the default list excludes invalidated memory",
  );
  await click("#memory-include-invalidated");
  await waitForBrowserValue(
    browser,
    `document.querySelector('${entryRow(alpha.entryId)}')?.getAttribute("data-state") === "invalidated"`,
    { description: "invalidated row shown when included" },
  );
  await click("#memory-restore");
  await waitForText("#memory-action-status", "已恢复");
  alphaNow = await memoryRead(alpha.entryId);
  assert.equal(alphaNow.state, "active");
  const history = await client.request("memory.history", {
    entryId: alpha.entryId,
  });
  assert.deepEqual(history.revisions.map(({ op }) => op).sort(), [
    "create",
    "invalidate",
    "pin",
    "restore",
  ]);
  assert.equal(
    history.revisions.find(({ op }) => op === "invalidate")?.reason,
    "FIXTURE outdated fact",
  );
  await waitForBrowserValue(
    browser,
    `document.querySelectorAll("#memory-history .memory-revision").length === ${history.revisions.length}`,
    { description: "history shows every revision" },
  );

  // Someone else changes the entry: the UI's revision is stale -> 409.
  const shownRevision = alphaNow.revision;
  await client.request("memory.pin", {
    entryId: alpha.entryId,
    expectedRevision: shownRevision,
    idempotencyKey: "console-gate-memory-conflict-probe",
    pinned: false,
  });
  await click("#memory-pin"); // still labelled "取消置顶" at the old revision
  await waitForText("#memory-action-status", "修订冲突");
  alphaNow = await memoryRead(alpha.entryId);
  assert.equal(alphaNow.revision, shownRevision + 1, "the UI wrote nothing");
  assert.equal(alphaNow.pinned, false);
  await waitForText(
    "#memory-detail-title",
    `修订 ${String(alphaNow.revision)}`,
  );

  // Delete: the dialog states the boundary and needs a reason.
  await click("#memory-delete-open");
  await waitForText(
    "#memory-delete-text",
    "删除后平台在线读取与检索不再能取得正文与描述（当前与所有修订都清空）；不追溯清理已进入 session、诊断、备份或 SQLite 物理残留（WAL）的副本。",
  );
  await click("#memory-delete-submit");
  await waitForText("#memory-action-status", "请填写原因");
  assert.equal((await memoryRead(alpha.entryId)).state, "active");
  await setValue("#memory-delete-reason", "FIXTURE privacy delete");
  await click("#memory-delete-submit");
  await waitForText("#memory-action-status", "已删除");
  alphaNow = await memoryRead(alpha.entryId);
  assert.equal(alphaNow.state, "deleted");
  assert.equal(alphaNow.body, null);
  assert.ok(
    (
      await client.request("memory.history", { entryId: alpha.entryId })
    ).revisions.every(({ body }) => body === null),
    "every revision body is redacted",
  );
  // Owner ruling 2026-09-27: the description is cleared with the body.
  assert.equal(alphaNow.description, "");
  assert.ok(
    (
      await client.request("memory.history", { entryId: alpha.entryId })
    ).revisions.every(({ description }) => description === ""),
    "every revision description is cleared",
  );
  await waitForText("#memory-detail-body", "正文已删除");
  await click("#memory-include-deleted");
  await waitForBrowserValue(
    browser,
    `document.querySelector('${entryRow(alpha.entryId)}')?.getAttribute("data-state") === "deleted"`,
    { description: "deleted row shown when included" },
  );
  listed = await memoryList();
  assert.deepEqual(
    listed.entries.map(({ entryId }) => entryId),
    [beta.entryId],
  );

  // Full review 2 A-P2-1: an unknown entry result stays bound to its entry.
  // The pin response for beta is dropped after commit; switching to alpha is
  // refused, and the retry replays beta's request once and reports beta.
  await click(`${entryRow(beta.entryId)} .memory-open`);
  await waitForText("#memory-detail-title", beta.name);
  const betaBefore = await memoryRead(beta.entryId);
  const alphaBeforePin = await memoryRead(alpha.entryId);
  const lostPins = [];
  await intercept(
    [{ requestStage: "Response", urlPattern: "*/v3/client/memory/pin" }],
    async (params) => {
      lostPins.push(JSON.parse(params.request.postData ?? "{}"));
      await browser.command(
        lostPins.length === 1 ? "Fetch.failRequest" : "Fetch.continueRequest",
        lostPins.length === 1
          ? { errorReason: "ConnectionReset", requestId: params.requestId }
          : { requestId: params.requestId },
      );
    },
  );
  await click("#memory-pin");
  await waitForText("#memory-action-status", "结果未知");
  assert.equal(
    (await memoryRead(beta.entryId)).revision,
    betaBefore.revision + 1,
    "the server committed the pin whose response was lost",
  );
  await click(`${entryRow(alpha.entryId)} .memory-open`);
  await waitForText("#memory-action-status", "当前条目的操作结果未知");
  assert.ok(
    (await textOf("#memory-detail-title")).includes(beta.name),
    "the detail stays on the entry of the unknown operation",
  );
  assert.equal(
    await evaluate(
      browser,
      `document.querySelectorAll("#memory-entry-unknown").length`,
    ),
    1,
    "one retry control for the entry, never accumulated",
  );
  await click("#memory-entry-retry");
  await waitForText("#memory-action-status", "重试核实：原请求已执行");
  await stopIntercept();
  assert.equal(lostPins.length, 2);
  assert.deepEqual(lostPins[1], lostPins[0], "identical retry request");
  assert.equal(lostPins[0].entryId, beta.entryId);
  const betaAfter = await memoryRead(beta.entryId);
  assert.equal(betaAfter.revision, betaBefore.revision + 1, "pinned once");
  assert.equal(betaAfter.pinned, true);
  assert.ok((await textOf("#memory-detail-title")).includes(beta.name));
  assert.equal(
    (await memoryRead(alpha.entryId)).revision,
    alphaBeforePin.revision,
    "the other entry is untouched",
  );
  // Resolved: switching works again.
  await click(`${entryRow(alpha.entryId)} .memory-open`);
  await waitForText("#memory-detail-title", alpha.name);

  // Switches: a per-member write override, then back to inherit.
  const policyBefore = await client.request("memory.policy.read", {
    channelId,
  });
  const policyRow = `.memory-policy-row[data-instance-id=${JSON.stringify(instanceId)}]`;
  await waitForBrowserValue(
    browser,
    `document.querySelector('${policyRow} .memory-override-write') !== null`,
    { description: "policy row for the instance" },
  );
  await setValue(`${policyRow} .memory-override-write`, "off");
  await click("#memory-policy-submit");
  await waitForText(
    "#memory-policy-status",
    `已保存为开关修订 ${String(policyBefore.revision + 1)}`,
  );
  let policyNow = await client.request("memory.policy.read", { channelId });
  assert.deepEqual(policyNow.overrides, [
    { instanceId, read: null, write: false },
  ]);
  assert.deepEqual(
    policyNow.members.find((member) => member.instanceId === instanceId),
    { instanceId, read: policyBefore.readDefault, write: false },
  );
  await waitForText(`${policyRow} .memory-effective`, "写 关");
  await setValue(`${policyRow} .memory-override-write`, "inherit");
  await click("#memory-policy-submit");
  await waitForText(
    "#memory-policy-status",
    `已保存为开关修订 ${String(policyBefore.revision + 2)}`,
  );
  policyNow = await client.request("memory.policy.read", { channelId });
  assert.deepEqual(policyNow.overrides, []);
  // Full review 2 A-P2-2: while a save is pending or its result is unknown
  // the form fields are locked (the success rebuild cannot swallow edits).
  const policyFieldsDisabled = async () =>
    await evaluate(
      browser,
      `(() => { const nodes = [...document.querySelectorAll("#memory-policy-fields select")]; return nodes.length > 0 && nodes.every((node) => node.disabled); })()`,
    );
  const policyRequests = [];
  let releaseHeldPolicy;
  const heldPolicy = new Promise((resolve) => (releaseHeldPolicy = resolve));
  await intercept(
    [
      {
        requestStage: "Response",
        urlPattern: "*/v3/client/memory/policy/update",
      },
    ],
    async (params) => {
      policyRequests.push(JSON.parse(params.request.postData ?? "{}"));
      if (policyRequests.length === 1) {
        await heldPolicy;
        await browser.command("Fetch.failRequest", {
          errorReason: "ConnectionReset",
          requestId: params.requestId,
        });
      } else {
        await browser.command("Fetch.continueRequest", {
          requestId: params.requestId,
        });
      }
    },
  );
  assert.equal(await policyFieldsDisabled(), false);
  await setValue(`${policyRow} .memory-override-read`, "off");
  await click("#memory-policy-submit");
  await waitForText("#memory-policy-status", "保存中");
  assert.equal(await policyFieldsDisabled(), true, "locked while pending");
  releaseHeldPolicy();
  await waitForText("#memory-policy-status", "结果未知");
  assert.equal(await policyFieldsDisabled(), true, "locked while unknown");
  await click("#memory-policy-retry");
  await waitForText("#memory-policy-status", "重试核实：原请求已执行");
  await stopIntercept();
  assert.equal(policyRequests.length, 2);
  assert.deepEqual(policyRequests[1], policyRequests[0]);
  assert.equal(await policyFieldsDisabled(), false, "unlocked after success");
  policyNow = await client.request("memory.policy.read", { channelId });
  assert.deepEqual(policyNow.overrides, [
    { instanceId, read: false, write: null },
  ]);
  await waitForText(`${policyRow} .memory-effective`, "读 关");
  await setValue(`${policyRow} .memory-override-read`, "inherit");
  await click("#memory-policy-submit");
  await waitForText(
    "#memory-policy-status",
    `已保存为开关修订 ${String(policyNow.revision + 1)}`,
  );
  policyNow = await client.request("memory.policy.read", { channelId });
  assert.deepEqual(policyNow.overrides, []);
  await screenshot("channel-memory-1440x1000.png");

  // --- 8. Runtime settings: edit, read back, stale revision conflict. ---
  await navigateHash("#/settings");
  await waitForBrowserValue(
    browser,
    `document.querySelector("#settings-wakeChainLimit") !== null`,
    { description: "settings form" },
  );
  // Watchdog thresholds apply to running work at once; limits do not.
  const scopeText = {
    future: await textOf("#settings-scope-future"),
    immediate: await textOf("#settings-scope-immediate"),
  };
  assert.match(scopeText.future, /只影响之后的调度/u);
  assert.match(scopeText.immediate, /立即适用于正在运行的工作/u);
  assert.match(scopeText.immediate, /终止/u);
  assert.match(scopeText.immediate, /续接/u);
  assert.deepEqual(
    await evaluate(
      browser,
      `[...document.querySelectorAll('#settings-fields [data-scope="immediate"] input')].map((node) => node.id)`,
    ),
    [
      "settings-noProgressWarnMinutes",
      "settings-queuedStallTerminateMinutes",
      "settings-maxRunMinutes",
    ],
  );
  assert.equal(
    (await textOf("#console-main")).includes("不会被中断"),
    false,
    "no blanket promise that running work is never interrupted",
  );
  const settingsBefore = await client.request("runtime.settings.read", {});
  const newLimit = settingsBefore.wakeGuard.instanceChainLimit === 7 ? 6 : 7;
  await setValue("#settings-wakeChainLimit", String(newLimit));
  await click("#settings-submit");
  await waitForText("#settings-status", "已保存为修订");
  const settingsSaved = await client.request("runtime.settings.read", {});
  assert.equal(settingsSaved.wakeGuard.instanceChainLimit, newLimit);
  assert.equal(settingsSaved.revision, settingsBefore.revision + 1);
  assert.equal(
    settingsSaved.maxConcurrentRuns,
    settingsBefore.maxConcurrentRuns,
    "only the edited field changed",
  );
  assert.match(
    await textOf("#runtime-settings"),
    new RegExp(`实例互相唤醒上限${String(newLimit)}`, "u"),
  );
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#settings-wakeChainLimit").value`,
    ),
    String(newLimit),
  );
  // Someone else saves first; the form still holds the older revision.
  const external = await client.request("runtime.settings.update", {
    expectedRevision: settingsSaved.revision,
    minStartIntervalMs: settingsSaved.minStartIntervalMs === 250 ? 300 : 250,
  });
  await setValue("#settings-wakeChainLimit", String(newLimit + 1));
  await click("#settings-submit");
  await waitForText("#settings-status", "修订冲突");
  const settingsAfterConflict = await client.request(
    "runtime.settings.read",
    {},
  );
  assert.equal(settingsAfterConflict.revision, external.revision);
  assert.equal(settingsAfterConflict.wakeGuard.instanceChainLimit, newLimit);
  await waitForText(
    "#settings-base",
    `表单基于修订 ${String(external.revision)}`,
  );
  const conflictText = await textOf("#settings-status");
  await screenshot("settings-conflict-1440x1000.png");

  // --- 9. Session reset with confirmation and a recorded reset event. ---
  await navigateHash(`#/channel/${encodeURIComponent(channelId)}`);
  await waitForBrowserValue(browser, `${stateText} === "空闲"`, {
    description: "idle before reset",
    timeoutMs: 20_000,
  });
  const beforeReset = await head(channelId);
  await click(`${card} .action-reset`);
  await waitForText(`${card} .confirm-box`, "新的原生 CLI session");
  // Full review 2 A-P2-4: no "private memory" claim; the S6 Channel memory.
  const resetText = await textOf(`${card} .confirm-box`);
  assert.ok(!resetText.includes("私有记忆"), resetText);
  assert.ok(
    resetText.includes(
      "Room 历史与频道记忆保留，新 session 启动时按读开关重新提供频道记忆索引",
    ),
    resetText,
  );
  await click(`${card} .confirm-reset`);
  await waitForText(`${card} .action-result`, "session 已重置");
  await waitForBrowserValue(
    browser,
    `document.querySelector('#lifecycle-events [data-event-type="instance.session_reset"]') !== null`,
    { description: "reset event in the lifecycle list" },
  );
  const resetSync = await client.request("room.sync", {
    afterSeq: beforeReset,
    consumerId: "console-gate-probe",
    roomId: channelId,
  });
  const resetEvent = resetSync.events.find(
    ({ type }) => type === "instance.session_reset",
  );
  assert.equal(resetEvent?.payload.instanceId, instanceId);
  assert.equal(resetEvent.actorId, humanId);

  // --- 10. Removal: refused with active work (reason + hint), then done. ---
  await click(`${card} .action-remove`);
  await waitForText(`${card} .confirm-box`, "移出后不再向该实例投递");
  await client.request("message.post", {
    basedOnRoomSeq: await head(channelId),
    body: "FIXTURE removal probe [fake:final]",
    idempotencyKey: "console-gate-removal-probe",
    recipients: [],
    roomId: channelId,
  });
  await click(`${card} .confirm-remove`);
  await waitForText(`${card} .action-result`, "移出被拒绝");
  const refusalText = await textOf(`${card} .action-result`);
  assert.match(refusalText, /active collaboration work/u);
  assert.match(await textOf(`${card} .action-hint`), /急停/u);
  await waitUntil(async () => {
    const entry = await activityOf(channelId, instanceId);
    return entry?.state === "idle" && entry.queued === false;
  }, 60_000);
  await click(`${card} .action-remove`);
  await click(`${card} .confirm-remove`);
  await waitForText(`${card} .action-result`, "已移出频道");
  await waitForBrowserValue(browser, `${stateText} === "已移出频道"`, {
    description: "removed instance label",
  });
  assert.equal(await activityOf(channelId, instanceId), undefined);
  assert.equal(
    await evaluate(
      browser,
      `getComputedStyle(document.querySelector('${card} .instance-actions')).display`,
    ),
    "none",
    "a removed instance offers no further actions",
  );

  // --- 11. Channel emergency stop and resume. ---
  await click("#sos-stop");
  await waitForText("#sos-confirm .confirm-box", "急停会终止");
  await click(".confirm-sos-stop");
  await waitForText("#sos-status", "已急停");
  await waitForText("#sos-state", "已急停");
  await setValue("#sos-guidance", "FIXTURE resume guidance");
  await click("#sos-resume");
  await waitForText("#sos-status", "已恢复");
  await waitForText("#sos-state", "运行中（已恢复）");
  await screenshot("channel-actions-1440x1000.png");

  // --- 11b. Result unknown for an instantiation: retry, one instance. ---
  const instancesOfRole = async () =>
    (await client.request("role.list", { controlRoomId })).instances.filter(
      ({ channelId: id, roleId }) => id === channelId && roleId === role.roleId,
    ).length;
  const instancesBefore = await instancesOfRole();
  const instantiateRequests = [];
  await intercept(
    [{ requestStage: "Response", urlPattern: "*/v3/client/roles/instantiate" }],
    async (params) => {
      instantiateRequests.push(JSON.parse(params.request.postData ?? "{}"));
      await browser.command(
        instantiateRequests.length === 1
          ? "Fetch.failRequest"
          : "Fetch.continueRequest",
        instantiateRequests.length === 1
          ? { errorReason: "ConnectionReset", requestId: params.requestId }
          : { requestId: params.requestId },
      );
    },
  );
  await setValue("#instantiate-role", role.roleId);
  await click("#instantiate-submit");
  await waitForText("#instantiate-status", "结果未知");
  assert.equal(await instancesOfRole(), instancesBefore + 1);
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector("#instantiate-submit").disabled`,
    ),
    true,
    "no new instantiation while the last result is unknown",
  );
  await click("#instantiate-retry");
  await waitForText("#instantiate-status", "重试核实：原请求已执行");
  await stopIntercept();
  assert.equal(
    await instancesOfRole(),
    instancesBefore + 1,
    "the retried instantiation created exactly one instance",
  );
  assert.equal(instantiateRequests.length, 2);
  assert.deepEqual(instantiateRequests[1], instantiateRequests[0]);

  // --- 11c. An invalid percent-encoding in the hash is an invalid route. ---
  await navigateHash("#/channel/%E0%A4%A");
  await waitForText("#invalid-route", "无效路由");
  assert.deepEqual(browserErrors, [], "the invalid route threw nothing");

  // --- 11d. Symlinks in the console root are refused with 404. ---
  const symlinkProbes = await evaluate(
    browser,
    `Promise.all(${JSON.stringify([
      "/_rah/console/linked-secret.txt",
      "/_rah/console/linked-directory/leak.js",
      "/_rah/console/linked-directory/some-route",
      "/_rah/console/assets/linked-assets/leak.js",
    ])}.map(async (path) => {
      const response = await fetch(path);
      return { body: await response.text(), path, status: response.status };
    }))`,
  );
  for (const probe of symlinkProbes) {
    assert.equal(probe.status, 404, probe.path);
    assert.doesNotMatch(probe.body, /FIXTURE outside/u, probe.path);
    assert.doesNotMatch(probe.body, /console-root/u, `${probe.path} no SPA`);
  }

  // --- 12. A cross-origin write is refused by the gateway. ---
  const foreign = await fetch(`${origin}/v3/client/rooms/list`, {
    body: JSON.stringify({ workspaceId: workspace.workspaceId }),
    headers: {
      authorization: "Bearer trusted-proxy-auth",
      "content-type": "application/json",
      cookie,
      origin: "http://evil.example",
    },
    method: "POST",
  });
  assert.equal(foreign.status, 403, "external Origin POST is refused");

  // --- 13. 390x844: key controls fit and work with real pointer input. ---
  await viewport(390, 844, true);
  await navigateHash(`#/channel/${encodeURIComponent(channelId)}`);
  await waitForBrowserValue(
    browser,
    `document.querySelector("#message-list .message") !== null && document.querySelector("#instance-list") !== null`,
    { description: "channel at 390x844" },
  );
  const mobileLayout = await evaluate(
    browser,
    `(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect === undefined ? null : { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      return {
        scrollWidth: document.documentElement.scrollWidth,
        regions: Object.fromEntries(${JSON.stringify([
          "#connection",
          ".console-nav",
          "#channel-title",
          "#instance-list",
          "#message-list",
          "#composer-input",
          "#composer-send",
          "#composer-mention",
          "#sos-stop",
          "#sos-resume",
          "#instantiate-role",
          "#instantiate-submit",
        ])}.map((selector) => [selector, box(selector)])),
      };
    })()`,
  );
  assert.equal(mobileLayout.scrollWidth, 390);
  for (const [name, rect] of Object.entries(mobileLayout.regions)) {
    assert.ok(rect && rect.width > 0 && rect.height > 0, `${name} is visible`);
    assert.ok(
      rect.left >= 0 && rect.right <= 390,
      `${name} fits the 390px viewport`,
    );
  }
  const mobileBody = "FIXTURE mobile send (390x844)";
  await typeInto("#composer-input", mobileBody);
  await click("#composer-send");
  await waitForBrowserValue(
    browser,
    `[...document.querySelectorAll("#message-list .message-body")].some((node) => node.textContent === ${JSON.stringify(mobileBody)})`,
    { description: "message sent by tapping at 390x844" },
  );
  await screenshot("channel-390x844.png");
  await navigateHash("#/channels");
  await waitForBrowserValue(
    browser,
    `document.querySelector("#create-channel-submit") !== null`,
    { description: "create form at 390x844" },
  );
  const mobileForm = await evaluate(
    browser,
    `(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        rects: ["#create-channel-name", "#create-channel-directories", "#create-channel-submit"].map((selector) => {
          const r = rect(selector);
          return { left: r.left, right: r.right, width: r.width };
        }),
      };
    })()`,
  );
  assert.equal(mobileForm.scrollWidth, 390);
  for (const rect of mobileForm.rects) {
    assert.ok(rect.width > 0 && rect.left >= 0 && rect.right <= 390);
  }
  await screenshot("channels-390x844.png");

  const pageCsp = await evaluate(browser, "window.__cspViolations");
  assert.deepEqual([...cspViolations, ...pageCsp], [], "no CSP violations");
  assert.deepEqual(browserErrors, [], "no console errors");
  assert.equal(dialogs.length, 1, "only the deliberate leave prompt opened");
  const expectedFailures = [
    "/v3/client/rooms/create",
    "/v3/client/rooms/members/remove",
    "/v3/client/runtime-settings/update",
    // The deliberate memory revision conflict (409) and the dropped pin
    // response of the entry-binding probe.
    "/v3/client/memory/pin",
    // The dropped response of the policy-lock probe.
    "/v3/client/memory/policy/update",
    // Stale refusals and the deliberately dropped responses above.
    "/v3/client/messages/post",
    "/v3/client/roles/instantiate",
    // Symlink probes (404).
    "/_rah/console/linked-",
    "/_rah/console/assets/linked-",
  ];
  assert.deepEqual(interceptErrors, [], "interception commands succeeded");
  for (const url of networkErrors) {
    assert.ok(
      expectedFailures.some((path) => String(url).includes(path)),
      `unexpected failed request ${String(url)}`,
    );
  }
  const modes = existsSync(fakeCodexModes)
    ? [
        ...new Set(
          readFileSync(fakeCodexModes, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line).mode),
        ),
      ]
    : [];
  process.stdout.write(
    `LOOM_CONSOLE_BROWSER_GATE ${JSON.stringify(
      {
        apiStates,
        browser: chromeExecutable,
        channelRun: channelRun.rows,
        conflictText,
        createStaleRequests,
        delayedRequests: delayedRequests.length,
        directRoom: directId,
        expectedRefusedRequests: networkErrors.length,
        scopeText,
        sosUnknownText,
        symlinkProbes: symlinkProbes.map(
          ({ path, status }) => `${path} ${String(status)}`,
        ),
        unknownText,
        verifyFailedText,
        fakeCodexModes: modes,
        fixture: "temporary HOME/RAH_DATA_HOME, fake codex, random port",
        hostRefusalText,
        refusalText,
        screenshots,
        uiQueued,
        uiStates,
        viewports: ["1440x1000", "390x844"],
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  if (browser !== undefined) {
    await screenshot("failure.png").catch(() => undefined);
    const text = await evaluate(
      browser,
      `document.querySelector("#console-main")?.innerText ?? ""`,
    ).catch(() => "");
    process.stderr.write(
      `LOOM_CONSOLE_GATE_FAILURE_PAGE ${screenshots.at(-1) ?? ""}\n${String(text).slice(0, 4_000)}\n`,
    );
  }
  throw error;
} finally {
  browser?.close();
  await terminate(chrome);
  await terminate(workbench);
  if (process.env.RAH_KEEP_GATE_TEMP === "1") {
    process.stderr.write(`LOOM_CONSOLE_GATE_TEMP ${temporaryDirectory}\n`);
  } else {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

async function viewport(width, height, mobile) {
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height,
    mobile,
    width,
  });
}

async function navigateHash(hash) {
  await evaluate(browser, `location.hash = ${JSON.stringify(hash)}`);
}

async function textOf(selector) {
  return await evaluate(
    browser,
    `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`,
  );
}

async function waitForText(selector, fragment, timeoutMs = 20_000) {
  try {
    return await waitForBrowserValue(
      browser,
      `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? "").includes(${JSON.stringify(fragment)})`,
      { description: `${selector} contains ${fragment}`, timeoutMs },
    );
  } catch (error) {
    throw new Error(
      `${error.message}; last text: ${JSON.stringify(await textOf(selector))}`,
    );
  }
}

async function setValue(selector, value) {
  const found = await evaluate(
    browser,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (node === null) return false;
      node.value = ${JSON.stringify(value)};
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return node.value === ${JSON.stringify(value)};
    })()`,
  );
  assert.ok(found, `${selector} accepts ${value}`);
}

async function typeInto(selector, text) {
  await evaluate(
    browser,
    `(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.value = ""; node.focus(); })()`,
  );
  await browser.command("Input.insertText", { text });
}

async function pressEnter({ shift = false } = {}) {
  const key = {
    code: "Enter",
    key: "Enter",
    modifiers: shift ? 8 : 0,
    nativeVirtualKeyCode: 13,
    windowsVirtualKeyCode: 13,
  };
  await browser.command("Input.dispatchKeyEvent", {
    ...key,
    text: "\r",
    type: "keyDown",
    unmodifiedText: "\r",
  });
  await browser.command("Input.dispatchKeyEvent", { ...key, type: "keyUp" });
}

/** Real pointer click at the element centre; it must be the hit target. */
async function click(selector) {
  const point = await waitForBrowserValue(
    browser,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (node === null || node.disabled) return null;
      node.scrollIntoView({ block: "center", inline: "center" });
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return hit === node || node.contains(hit) ? { x, y } : null;
    })()`,
    { description: `${selector} is an enabled pointer hit target` },
  );
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await browser.command("Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type,
      x: point.x,
      y: point.y,
    });
  }
}

async function screenshot(name) {
  const { data } = await browser.command("Page.captureScreenshot", {
    format: "png",
  });
  const path = join(screenshotDirectory, name);
  writeFileSync(path, Buffer.from(data, "base64"));
  screenshots.push(path);
}

/**
 * The open run-detail panel shows exactly what `agent.run.usage.get` returns:
 * formatted numbers, and "未知" (never 0) for every null the API reports.
 */
async function checkRunDetail(client, agentId, runAttemptId) {
  await waitForBrowserValue(
    browser,
    `document.querySelector("#run-detail .run-detail-title")?.getAttribute("data-run-attempt-id") === ${JSON.stringify(runAttemptId)} && document.querySelectorAll("#run-detail [data-field]").length > 0`,
    { description: `run detail for ${runAttemptId}`, timeoutMs: 20_000 },
  );
  const raw = await client.request("agent.run.usage.get", {
    agentId,
    runAttemptId,
  });
  const view = await evaluate(
    browser,
    `({
      generations: document.querySelectorAll("#run-detail .run-generations li").length,
      rows: Object.fromEntries([...document.querySelectorAll("#run-detail [data-field]")].map((node) => [node.getAttribute("data-field"), node.querySelector(".field-value").textContent])),
    })`,
  );
  const count = (value) =>
    value === null ? "未知" : value.toLocaleString("en-US");
  const total = (value) =>
    value === null
      ? "未知"
      : `${count(value)}${raw.completeness === "partial" ? "（部分）" : ""}`;
  const expected = {
    推理token: total(raw.totals.reasoningOutputTokens),
    生成次数: total(raw.totals.generations),
    缓存输入token: total(raw.totals.cachedInputTokens),
    输入token: total(raw.totals.inputTokens),
    输出token: total(raw.totals.outputTokens),
  };
  for (const [key, value] of Object.entries(expected)) {
    const label = key.replace(/token$/u, " token");
    assert.equal(view.rows[label], value, `${label} matches the API`);
  }
  const context = [...raw.generations]
    .reverse()
    .find(
      ({ contextUsedTokens, contextWindow }) =>
        contextUsedTokens !== null || contextWindow !== null,
    );
  assert.equal(
    view.rows["上下文占用"],
    context === undefined
      ? "未知"
      : `${count(context.contextUsedTokens)} / ${count(context.contextWindow)}`,
  );
  // Contract §5: the run's observed compactions, as the API reports them.
  assert.equal(
    view.rows["压缩次数（本轮）"],
    raw.compactionCount === undefined
      ? "未知"
      : raw.compactionCount === null
        ? "未知（本轮无运行轨迹）"
        : String(raw.compactionCount),
  );
  if (raw.execution === undefined) assert.equal(view.rows["执行方式"], "未知");
  else if (raw.execution === null) {
    assert.equal(view.rows["执行方式"], "未知（按轮进程或无记录）");
  } else {
    assert.ok(
      view.rows["执行方式"].startsWith(
        raw.execution.mode === "warm" ? "热" : "冷",
      ),
    );
  }
  const resume = [raw.sessionResumeMs, raw.execution?.sessionResumeMs].find(
    (value) => typeof value === "number",
  );
  if (resume !== undefined) {
    assert.equal(view.rows["session 恢复耗时"], `${String(resume)} ms`);
  } else {
    assert.ok(view.rows["session 恢复耗时"].startsWith("未知"));
  }
  if (raw.finalInterrupt === undefined) {
    assert.equal(view.rows["final 收尾"], "未知");
  } else if (raw.finalInterrupt === null) {
    assert.equal(view.rows["final 收尾"], "本轮没有 final 回复");
  } else {
    assert.ok(
      view.rows["final 收尾"].includes(
        `#${String(raw.finalInterrupt.committedRoomSeq)}`,
      ),
    );
  }
  if (raw.cliCosts === undefined || raw.cliCosts.length === 0) {
    assert.ok(view.rows["已记录费用小计（CLI 自报）"].startsWith("未知"));
  }
  assert.equal(view.generations, raw.generations.length);
  // Every null the API reports was asserted above to read "未知", never 0.
  return { raw, rows: view.rows };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function startWorkbench() {
  let output = "";
  const processHandle = spawn(
    process.execPath,
    [join(scriptDirectory, "run-local-workbench.mjs")],
    {
      cwd: repositoryDirectory,
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: `${binDirectory}${delimiter}${dirname(process.execPath)}`,
        RAH_CONSOLE_STATIC_DIRECTORY: consoleCopy,
        RAH_DATA_HOME: dataHome,
        RAH_WEB_PORT: String(await availablePort()),
        RAH_WORKSPACE_CWD: workspaceCwd,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  processHandle.stdout.setEncoding("utf8");
  processHandle.stderr.setEncoding("utf8");
  processHandle.stdout.on("data", (chunk) => {
    output += chunk;
  });
  processHandle.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 60_000;
  while (true) {
    const line = output
      .split(/\r?\n/u)
      .find((candidate) => candidate.startsWith("RAH_LOCAL_WORKBENCH "));
    if (line !== undefined) {
      return {
        descriptor: JSON.parse(line.slice("RAH_LOCAL_WORKBENCH ".length)),
        processHandle,
      };
    }
    if (processHandle.exitCode !== null) {
      throw new Error(`fixture workbench exited before ready:\n${output}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`fixture workbench startup timed out:\n${output}`);
    }
    await delay(25);
  }
}

async function gatewayClient(origin) {
  const root = await fetch(`${origin}/_rah/console/`);
  assert.equal(root.status, 200);
  const cookie = root.headers.get("set-cookie")?.split(";", 1)[0];
  assert.notEqual(cookie, undefined);
  return {
    client: new HttpRahClient({
      accessToken: () => "trusted-proxy-auth",
      baseUrl: origin,
      fetch: async (url, init) =>
        await fetch(url, {
          ...init,
          headers: { ...init.headers, cookie, origin },
        }),
    }),
    cookie,
  };
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) =>
    server.close((error) =>
      error === undefined ? resolvePromise() : reject(error),
    ),
  );
  return address.port;
}

async function waitForPageTarget(port) {
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      const targets = await fetch(
        `http://127.0.0.1:${String(port)}/json/list`,
      ).then((response) => response.json());
      const target = targets.find(
        (candidate) =>
          candidate.type === "page" &&
          typeof candidate.webSocketDebuggerUrl === "string",
      );
      if (target !== undefined) return target;
    } catch {
      // Chrome may publish its port before the first page target exists.
    }
    if (Date.now() >= deadline) {
      throw new Error("Chrome page target startup timed out");
    }
    await delay(25);
  }
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await delay(100);
  }
}

async function terminate(processHandle) {
  if (processHandle === undefined || processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolvePromise) =>
      processHandle.once("exit", () => resolvePromise(true)),
    ),
    delay(8_000).then(() => false),
  ]);
  if (exited) return;
  processHandle.kill("SIGKILL");
  await new Promise((resolvePromise) =>
    processHandle.once("exit", resolvePromise),
  );
}
