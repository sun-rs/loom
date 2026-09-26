// Read-only real-browser gate for the throwaway evo console (batch 1,
// docs/evo/status.zh-CN.md §44). Deleted in phase 4 with apps/console.
//
// FIXTURE ONLY: the Loom service started here uses a temporary HOME,
// RAH_DATA_HOME, random port and a fake `codex` executable. Its URL, Role and
// messages are test fixtures and must never be handed to a user as the product.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
const chromeProfileDirectory = join(temporaryDirectory, "chrome-profile");
const xssBody =
  'FIXTURE xss probe <img src=x onerror="window.__consoleXss=1"> (not a real request)';
let browser;
let chrome;
let workbench;

try {
  for (const directory of [
    fakeHome,
    workspaceCwd,
    binDirectory,
    attachedDirectory,
    screenshotDirectory,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  // The startup repository guard needs git; nothing else leaks from PATH.
  symlinkSync(
    execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    join(binDirectory, "git"),
  );
  const codexPath = join(binDirectory, "codex");
  // FAKE CLI: answers discovery and completes every turn without a reply.
  writeFileSync(
    codexPath,
    `#!${process.execPath}
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-console-fixture",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"high"}],service_tiers:[]}]}));
} else if (args[0] === "app-server") {
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
  createInterface({input:process.stdin}).on("line", (line) => {
    const frame = JSON.parse(line);
    if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{userAgent:"console-gate-fake-codex/1"}});
    else if (frame.method === "thread/start") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:"console-gate-thread"}}});
    else if (frame.method === "thread/resume") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:frame.params.threadId}}});
    else if (frame.method === "turn/start") {
      send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:"console-gate-turn",status:"inProgress"}}});
      send({jsonrpc:"2.0",method:"turn/completed",params:{threadId:"console-gate-thread",turn:{id:"console-gate-turn",status:"completed"}}});
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
  const client = await gatewayClient(origin);

  // Seed through the same public API the console reads.
  const me = await client.request("principal.me", {});
  const humanName = me.principal.displayName ?? me.principal.handle;
  const workspace = (await client.request("workspace.list", {})).workspaces[0];
  assert.ok(workspace?.controlRoomId);
  const controlRoomId = workspace.controlRoomId;
  const head = async (roomId) =>
    (
      await client.request("room.sync", {
        consumerId: "console-gate-seed",
        roomId,
      })
    ).latestRoomSeq;
  const created = await client.request("room.create", {
    additionalDirectories: [attachedDirectory],
    basedOnControlRoomSeq: await head(controlRoomId),
    idempotencyKey: "console-gate-channel",
    kind: "channel",
    name: "console-gate-fixture",
    slug: "console-gate-fixture",
    workspaceId: workspace.workspaceId,
  });
  const channelId = created.room.roomId;
  const primaryDirectory = created.room.channelWorkspace?.primaryDirectory;
  assert.ok(primaryDirectory, "the channel records its primary directory");
  assert.ok(
    primaryDirectory.startsWith(join(fakeHome, ".loom", "channel-workspaces")),
    "the primary directory lives under the temporary HOME",
  );
  await waitUntil(async () => {
    const rooms = await client.request("room.list", {
      workspaceId: workspace.workspaceId,
    });
    return (
      rooms.rooms.find(({ roomId }) => roomId === channelId)?.channelWorkspace
        ?.primary?.state === "ready"
    );
  }, 20_000);
  await client.request("message.post", {
    basedOnRoomSeq: await head(channelId),
    body: xssBody,
    idempotencyKey: "console-gate-xss",
    recipients: [],
    roomId: channelId,
  });
  const inventory = await client.request("host.runtime.list", {});
  const runtime = inventory.runtimes.find(
    ({ runtimeOfferId }) => runtimeOfferId !== undefined,
  );
  const binding = runtime?.modelBindingDescriptors.find(
    ({ modelId }) => modelId === "gpt-console-fixture",
  );
  assert.ok(runtime?.runtimeOfferId && binding);
  const role = await client.request("role.create", {
    basedOnRoomSeq: await head(controlRoomId),
    configuration: {
      displayName: "FIXTURE 门禁 Reviewer",
      handle: "console-gate-reviewer",
      instructions: "FIXTURE ONLY: console browser gate role.",
      modelIntent: {
        exactBindingIds: [binding.modelBindingId],
        fallback: "disabled",
        reasoning: "high",
      },
      role: "fixture reviewer",
      runtimeOfferId: runtime.runtimeOfferId,
    },
    controlRoomId,
    idempotencyKey: "console-gate-role",
  });
  const instance = await client.request("role.instantiate", {
    basedOnRoomSeq: await head(channelId),
    channelId,
    idempotencyKey: "console-gate-instance",
    roleId: role.role.roleId,
  });
  const instanceId = instance.instance.instanceId;
  const settings = await client.request("runtime.settings.read", {});
  const allRooms = await client.request("room.list", {
    workspaceId: workspace.workspaceId,
  });
  const legacyChannels = allRooms.rooms.filter(
    (room) =>
      room.kind === "channel" &&
      room.archivedAt === undefined &&
      room.channelWorkspace === undefined,
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
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 1_000,
    mobile: false,
    width: 1_440,
  });

  await browser.command("Page.navigate", { url: `${origin}/_rah/console/` });
  await waitForBrowserValue(
    browser,
    `document.querySelector("#connection")?.textContent?.includes("已连接")`,
    { description: "console connection and identity", timeoutMs: 20_000 },
  );
  const connectionText = await evaluate(
    browser,
    `document.querySelector("#connection").textContent`,
  );
  assert.match(connectionText, new RegExp(escapeRegExp(humanName), "u"));
  assert.match(connectionText, new RegExp(escapeRegExp(workspace.name), "u"));

  const card = `document.querySelector('.channel-card[data-room-id=${JSON.stringify(channelId)}]')`;
  await waitForBrowserValue(browser, `${card} !== null`, {
    description: "seeded fixture channel in the channel list",
  });
  const cardState = await evaluate(
    browser,
    `(() => {
      const card = ${card};
      const value = (name) => card.querySelector("." + name + " .field-value")?.textContent;
      return {
        attached: value("attached-directories"),
        primary: value("primary-directory"),
        state: value("primary-state"),
      };
    })()`,
  );
  assert.deepEqual(cardState, {
    attached: attachedDirectory,
    primary: primaryDirectory,
    state: "ready",
  });
  for (const legacy of legacyChannels) {
    assert.equal(
      await evaluate(
        browser,
        `document.querySelector('.channel-card[data-room-id=${JSON.stringify(legacy.roomId)}] .legacy-note .field-value')?.textContent`,
      ),
      "实例使用私有 cwd",
      `legacy channel ${legacy.name} is labelled`,
    );
  }

  await evaluate(
    browser,
    `location.hash = ${JSON.stringify(`#/channel/${encodeURIComponent(channelId)}`)}`,
  );
  const instanceCard = `document.querySelector('.instance-card[data-instance-id=${JSON.stringify(instanceId)}]')`;
  await waitForBrowserValue(browser, `${instanceCard} !== null`, {
    description: "fixture instance status card",
    timeoutMs: 15_000,
  });
  const instanceState = await evaluate(
    browser,
    `(() => {
      const card = ${instanceCard};
      const value = (name) => card.querySelector("." + name + " .field-value")?.textContent;
      return {
        name: card.querySelector(".instance-name")?.textContent,
        privateBox: value("private-box"),
        revision: card.querySelector(".revision")?.textContent,
        state: value("instance-state"),
      };
    })()`,
  );
  assert.equal(instanceState.name, "FIXTURE 门禁 Reviewer");
  assert.equal(instanceState.revision, "Role 为最新修订");
  assert.equal(instanceState.privateBox, "私聊未打开");
  assert.ok(
    ["空闲", "排队或启动中", "运行中", "错误", "无运行记录"].includes(
      instanceState.state,
    ),
    `instance state label ${String(instanceState.state)}`,
  );
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
  assert.equal(
    await evaluate(browser, "document.documentElement.scrollWidth"),
    1_440,
  );
  await screenshot("channel-1440x1000.png");

  await evaluate(browser, `location.hash = "#/settings"`);
  await waitForBrowserValue(
    browser,
    `document.querySelector("#runtime-settings")?.textContent?.includes("修订号")`,
    { description: "read-only runtime settings" },
  );
  const settingsText = await evaluate(
    browser,
    `document.querySelector("#runtime-settings").textContent`,
  );
  assert.match(
    settingsText,
    new RegExp(
      `实例互相唤醒上限${String(settings.wakeGuard.instanceChainLimit)}`,
      "u",
    ),
  );
  assert.match(
    settingsText,
    new RegExp(`本机同时运行上限${String(settings.maxConcurrentRuns)}`, "u"),
  );
  assert.equal(
    await evaluate(
      browser,
      `document.querySelectorAll("#runtime-settings input, #runtime-settings button").length`,
    ),
    0,
    "settings stay read-only in batch 1",
  );

  await evaluate(browser, `location.hash = "#/usage"`);
  await waitForBrowserValue(
    browser,
    `document.querySelector("#usage-table .usage-total")?.textContent?.startsWith("合计")`,
    { description: "usage summary totals" },
  );

  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    width: 390,
  });
  await evaluate(
    browser,
    `location.hash = ${JSON.stringify(`#/channel/${encodeURIComponent(channelId)}`)}`,
  );
  await waitForBrowserValue(browser, `${instanceCard} !== null`, {
    description: "instance card at 390x844",
  });
  await waitForBrowserValue(
    browser,
    `document.querySelector("#message-list .message") !== null`,
    { description: "messages at 390x844" },
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
        regions: {
          connection: box("#connection"),
          nav: box(".console-nav"),
          title: box("#channel-title"),
          instances: box("#instance-list"),
          messages: box("#message-list"),
        },
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
  await screenshot("channel-390x844.png");

  const pageCsp = await evaluate(browser, "window.__cspViolations");
  assert.deepEqual([...cspViolations, ...pageCsp], [], "no CSP violations");
  assert.deepEqual(browserErrors, [], "no console errors");
  process.stdout.write(
    `LOOM_CONSOLE_BROWSER_GATE ${JSON.stringify({
      browser: chromeExecutable,
      fixture: "temporary HOME/RAH_DATA_HOME, fake codex, random port",
      legacyChannelsChecked: legacyChannels.length,
      readOnly: true,
      screenshots: [
        join(screenshotDirectory, "channel-1440x1000.png"),
        join(screenshotDirectory, "channel-390x844.png"),
      ],
      viewports: ["1440x1000", "390x844"],
    })}\n`,
  );
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

async function screenshot(name) {
  const { data } = await browser.command("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(join(screenshotDirectory, name), Buffer.from(data, "base64"));
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
  return new HttpRahClient({
    accessToken: () => "trusted-proxy-auth",
    baseUrl: origin,
    fetch: async (url, init) =>
      await fetch(url, {
        ...init,
        headers: { ...init.headers, cookie, origin },
      }),
  });
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
