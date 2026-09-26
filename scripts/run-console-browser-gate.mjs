// Real-browser gate for the throwaway evo console (batch 1 read-only views,
// batch 2 intervention writes; docs/evo/status.zh-CN.md §44, §45). Deleted in
// phase 4 with apps/console.
//
// FIXTURE ONLY: the Loom service started here uses a temporary HOME,
// RAH_DATA_HOME, random port and a fake `codex` executable. Its URL, Role,
// messages and every "FAKE final answer" reply are test fixtures and must
// never be handed to a user as the product. No paid provider runs.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
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
  await click("#create-channel-submit");
  await waitForText("#create-channel-status", "已创建 #console-gate-fixture");
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

  // --- 8. Runtime settings: edit, read back, stale revision conflict. ---
  await navigateHash("#/settings");
  await waitForBrowserValue(
    browser,
    `document.querySelector("#settings-wakeChainLimit") !== null`,
    { description: "settings form" },
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
  const expectedFailures = [
    "/v3/client/rooms/create",
    "/v3/client/rooms/members/remove",
    "/v3/client/runtime-settings/update",
  ];
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
        conflictText,
        expectedRefusedRequests: networkErrors.length,
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
        RAH_CONSOLE_STATIC_DIRECTORY: consoleDirectory,
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
