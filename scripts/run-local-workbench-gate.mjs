import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "rah-local-workbench-gate-"),
);
const workbenchHome = join(temporaryDirectory, "home");
const workspaceCwd = join(temporaryDirectory, "workspace");
const binDirectory = join(temporaryDirectory, "bin");
const chromeProfileDirectory = join(temporaryDirectory, "chrome-profile");
const fakeCli = join(
  repositoryDirectory,
  "packages",
  "agent-host",
  "test",
  "fixtures",
  "fake-cli.mjs",
);
const fakeCodexProtocolPath = join(
  temporaryDirectory,
  "fake-codex-protocol.jsonl",
);
const webPort = await availablePort();
let browser;
let chrome;
let workbench;

try {
  mkdirSync(workspaceCwd);
  mkdirSync(binDirectory);
  const codexPath = join(binDirectory, "codex");
  writeFileSync(
    codexPath,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-test",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"high"}],service_tiers:[]}]}));
} else {
  if (args.join(" ") !== "app-server --listen stdio://") process.exit(64);
  const record = (value) => appendFileSync(process.env.RAH_FAKE_CODEX_PROTOCOL_PATH, JSON.stringify(value) + "\\n");
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
  record({args});
  const lines = createInterface({input:process.stdin});
  lines.on("line", (line) => {
    const frame = JSON.parse(line);
    record(frame);
    if (frame.method === "initialize") {
      send({jsonrpc:"2.0",id:frame.id,result:{userAgent:"local-workbench-gate-codex/1"}});
    } else if (frame.method === "thread/start") {
      send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:"local-workbench-thread"}}});
    } else if (frame.method === "thread/resume") {
      send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:frame.params.threadId}}});
    } else if (frame.method === "turn/start") {
      send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:"local-workbench-turn",status:"inProgress"}}});
      const worker = spawn(process.execPath, [${JSON.stringify(fakeCli)}], {
        env: process.env,
        stdio: ["ignore", "ignore", "pipe"],
      });
      worker.stderr.on("data", (chunk) => record({workerStderr:String(chunk)}));
      worker.once("exit", (code) => {
        const status = code === 0 ? "completed" : "failed";
        send({jsonrpc:"2.0",method:"turn/completed",params:{threadId:"local-workbench-thread",turn:{id:"local-workbench-turn",status}}});
      });
    }
  });
}
`,
    { mode: 0o700 },
  );
  chmodSync(codexPath, 0o700);

  const first = await startWorkbench();
  workbench = first.processHandle;
  const firstSession = await gatewayClient(first.descriptor.webOrigin);
  assert.equal(
    (await firstSession.client.request("health", {})).state,
    "online",
  );
  const workspaces = await firstSession.client.request("workspace.list", {});
  assert.equal(workspaces.workspaces.length, 1);
  const rooms = await firstSession.client.request("room.list", {
    workspaceId: first.descriptor.workspaceId,
  });
  const defaultRoom = rooms.rooms.find(
    ({ roomId }) => roomId === first.descriptor.defaultRoomId,
  );
  assert.notEqual(defaultRoom, undefined);
  const controlRoom = rooms.rooms.find(({ kind }) => kind === "control");
  assert.notEqual(controlRoom, undefined);
  const agents = await firstSession.client.request("agent.list", {
    controlRoomId: controlRoom.roomId,
  });
  assert.equal(agents.agents.length, 1);
  assert.equal(agents.agents[0]?.handle, "Codex");
  const inventory = await firstSession.client.request("host.runtime.list", {});
  const runtime = inventory.runtimes.find(
    ({ runtimeOfferId }) => runtimeOfferId !== undefined,
  );
  const modelBinding = runtime?.modelBindingDescriptors.find(
    ({ modelId }) => modelId === "gpt-test",
  );
  assert.notEqual(runtime?.runtimeOfferId, undefined);
  assert.notEqual(modelBinding, undefined);
  const agentDetail = await firstSession.client.request("agent.get", {
    agentDefinitionId: agents.agents[0].definition.agentDefinitionId,
  });
  const controlSync = await firstSession.client.request("room.sync", {
    consumerId: "local-workbench-gate-control",
    roomId: controlRoom.roomId,
  });
  await firstSession.client.request("agent.manage", {
    action: "configure",
    agentDefinitionId: agentDetail.agent.definition.agentDefinitionId,
    avatarKey: agentDetail.agent.currentRevision.avatarKey,
    basedOnRoomSeq: controlSync.latestRoomSeq,
    description: agentDetail.agent.currentRevision.description,
    displayName:
      agentDetail.agent.currentRevision.displayName ?? agentDetail.agent.handle,
    handle: agentDetail.agent.handle,
    idempotencyKey: "local-workbench-gate-model-config",
    instructions: agentDetail.agent.currentRevision.instructions,
    modelIntent: {
      exactBindingIds: [modelBinding.modelBindingId],
      fallback: "disabled",
      reasoning: "high",
    },
    role: agentDetail.agent.currentRevision.role,
    runtimeOfferId: runtime.runtimeOfferId,
  });

  const initialSync = await firstSession.client.request("room.sync", {
    consumerId: "local-workbench-gate-first",
    roomId: defaultRoom.roomId,
  });
  const onboarded = await firstSession.client.request("agent.onboard", {
    agentDefinitionId: agents.agents[0].definition.agentDefinitionId,
    basedOnRoomSeq: initialSync.latestRoomSeq,
    idempotencyKey: "local-workbench-gate-onboard",
    roomId: defaultRoom.roomId,
  });
  const posted = await firstSession.client.request("message.post", {
    basedOnRoomSeq: onboarded.event.roomSeq,
    body: "Prove that the formal local workbench runs a real Agent lane.",
    idempotencyKey: "local-workbench-gate-message",
    recipients: [],
    roomId: defaultRoom.roomId,
  });
  assert.equal(posted.activationIds.length, 1);
  await waitUntil(async () => {
    const messages = await firstSession.client.request("message.list", {
      roomId: defaultRoom.roomId,
    });
    return messages.messages.some(
      ({ body }) => body === "formal-workbench-agent-reply",
    );
  }, 15_000);
  const codexProtocol = readFileSync(fakeCodexProtocolPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(codexProtocol[0]?.args, [
    "app-server",
    "--listen",
    "stdio://",
  ]);
  const threadStart = codexProtocol.find(
    ({ method }) => method === "thread/start",
  );
  assert.equal(threadStart?.params.approvalPolicy, "never");
  assert.equal(threadStart?.params.sandbox, "danger-full-access");
  assert.equal(threadStart?.params.model, "gpt-test");
  assert.equal(threadStart?.params.config.model_reasoning_effort, "high");
  const turnStart = codexProtocol.find(({ method }) => method === "turn/start");
  assert.equal(turnStart?.params.effort, "high");

  await terminate(workbench);
  workbench = undefined;

  const second = await startWorkbench();
  workbench = second.processHandle;
  assert.equal(second.descriptor.workspaceId, first.descriptor.workspaceId);
  assert.equal(second.descriptor.defaultRoomId, first.descriptor.defaultRoomId);
  const secondSession = await gatewayClient(second.descriptor.webOrigin);
  const restoredMessages = await secondSession.client.request("message.list", {
    roomId: second.descriptor.defaultRoomId,
  });
  assert.deepEqual(
    restoredMessages.messages.map(({ body }) => body),
    [
      "Prove that the formal local workbench runs a real Agent lane.",
      "formal-workbench-agent-reply",
    ],
  );
  const restoredAgent = await secondSession.client.request("agent.get", {
    agentDefinitionId: agentDetail.agent.definition.agentDefinitionId,
  });
  assert.deepEqual(restoredAgent.policy.modelIntent.exactBindingIds, [
    modelBinding.modelBindingId,
  ]);
  assert.equal(restoredAgent.policy.modelIntent.reasoning, "high");
  const resumedSync = await secondSession.client.request("room.sync", {
    consumerId: "local-workbench-gate-resumed",
    roomId: second.descriptor.defaultRoomId,
  });
  await secondSession.client.request("message.post", {
    basedOnRoomSeq: resumedSync.latestRoomSeq,
    body: "Prove that the Provider thread resumes after a daemon restart.",
    idempotencyKey: "local-workbench-gate-resumed-message",
    recipients: [],
    roomId: second.descriptor.defaultRoomId,
  });
  try {
    await waitUntil(async () => {
      const messages = await secondSession.client.request("message.list", {
        roomId: second.descriptor.defaultRoomId,
      });
      return (
        messages.messages.filter(
          ({ body }) => body === "formal-workbench-agent-reply",
        ).length === 2
      );
    }, 15_000);
  } catch (error) {
    const diagnosticResponse = await fetch(
      `${second.descriptor.webOrigin}/v3/client/messages/list`,
      {
        body: JSON.stringify({ roomId: second.descriptor.defaultRoomId }),
        headers: {
          authorization: "Bearer trusted-proxy-auth",
          "content-type": "application/json",
          cookie: secondSession.cookie,
          origin: second.descriptor.webOrigin,
        },
        method: "POST",
      },
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nHTTP ${String(diagnosticResponse.status)} ${await diagnosticResponse.text()}\n${second.output()}`,
    );
  }
  const resumedProtocol = readFileSync(fakeCodexProtocolPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(
    resumedProtocol.filter(({ method }) => method === "thread/start").length,
    1,
  );
  const threadResume = resumedProtocol.find(
    ({ method }) => method === "thread/resume",
  );
  assert.equal(threadResume?.params.threadId, "local-workbench-thread");

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
  await Promise.all([
    browser.command("Page.enable"),
    browser.command("Runtime.enable"),
  ]);
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 1_000,
    mobile: false,
    width: 1_440,
  });
  await browser.command("Page.navigate", {
    url: second.descriptor.webOrigin,
  });
  await waitForBrowserValue(
    browser,
    `document.querySelector(".channel-title h1")?.textContent?.trim() === "Agent Council"`,
    { description: "production local workbench Room" },
  );
  await waitForBrowserValue(
    browser,
    `document.body.innerText.includes("formal-workbench-agent-reply")`,
    { description: "restored canonical Agent reply" },
  );
  await evaluate(
    browser,
    `document.querySelector('button[title="Agent 与成员"]')?.click()`,
  );
  try {
    await waitForBrowserValue(
      browser,
      `document.querySelector(".rah-agent-detail-panel") !== null`,
      { description: "persistent Agent directory" },
    );
  } catch (error) {
    const pageState = await evaluate(
      browser,
      `({
        body: document.body.innerText.slice(0, 2000),
        buttons: [...document.querySelectorAll("button")].map((button) => ({disabled: button.disabled, title: button.title})).filter(({title}) => title),
        href: location.href
      })`,
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(pageState)}`,
    );
  }
  await evaluate(
    browser,
    `document.querySelector('.rah-agent-detail-head button[title="Agent 菜单"]')?.click()`,
  );
  await waitForBrowserValue(
    browser,
    `document.querySelector(".rah-agent-manage-dialog") !== null`,
    { description: "Agent model settings" },
  );
  assert.equal(
    await evaluate(
      browser,
      `[...document.querySelectorAll(".rah-agent-manage-dialog label")].find((label) => label.firstChild?.textContent?.trim() === "模型")?.querySelector("select")?.value`,
    ),
    modelBinding.modelBindingId,
  );
  assert.equal(
    await evaluate(
      browser,
      `[...document.querySelectorAll(".rah-agent-manage-dialog label")].some((label) => /权限|访问模式|沙箱/.test(label.firstChild?.textContent ?? ""))`,
    ),
    false,
  );
  await evaluate(
    browser,
    `document.querySelector('.rah-agent-manage-dialog button[aria-label="关闭"]')?.click()`,
  );
  await evaluate(
    browser,
    `[...document.querySelectorAll(".rah-agent-detail-tabs button")].find((button) => button.textContent?.trim() === "提醒")?.click()`,
  );
  await waitForBrowserValue(
    browser,
    `document.querySelector(".rah-agent-reminders-list")?.textContent?.includes("Verify durable Reminder projection") === true`,
    { description: "durable non-empty Agent Reminder projection" },
  );
  assert.match(
    await evaluate(
      browser,
      `document.querySelector(".rah-agent-reminder-reference")?.textContent?.trim() ?? ""`,
    ),
    /^消息 #/u,
  );
  await evaluate(
    browser,
    `document.querySelector(".rah-agent-reminder-reference")?.click()`,
  );
  await waitForBrowserValue(
    browser,
    `document.querySelector(".rah-agent-detail-panel") === null && document.body.innerText.includes("Prove that the Provider thread resumes after a daemon restart.")`,
    { description: "typed Reminder source Message navigation" },
  );
  assert.equal(
    await evaluate(
      browser,
      `document.body.innerText.includes("Human access token")`,
    ),
    false,
  );
  assert.equal(
    await evaluate(browser, "document.documentElement.scrollWidth"),
    1_440,
  );
  await evaluate(
    browser,
    `(() => {
      const url = new URL(location.href);
      url.search = new URLSearchParams({room:${JSON.stringify(second.descriptor.defaultRoomId)}}).toString();
      history.pushState(null, "", url);
      dispatchEvent(new PopStateEvent("popstate"));
    })()`,
  );
  await waitForBrowserValue(
    browser,
    `document.body.innerText.includes("formal-workbench-agent-reply")`,
    { description: "production Room restored before Core restart" },
  );
  await evaluate(
    browser,
    `(() => {
      document.documentElement.dataset.rahRestartProbe = "same-document";
      window.__rahRepeatedMessageErrors = [];
      window.__rahRestartObserver = new MutationObserver(() => {
        for (const element of document.querySelectorAll(".rah-message-action-error")) {
          const text = element.textContent?.trim();
          if (text && !window.__rahRepeatedMessageErrors.includes(text)) {
            window.__rahRepeatedMessageErrors.push(text);
          }
        }
      });
      window.__rahRestartObserver.observe(document.body, {childList:true, subtree:true});
    })()`,
  );
  await terminate(workbench);
  workbench = undefined;
  const third = await startWorkbench();
  workbench = third.processHandle;
  assert.equal(third.descriptor.webOrigin, second.descriptor.webOrigin);
  try {
    await waitForBrowserValue(
      browser,
      `document.documentElement.dataset.rahRestartProbe === "same-document" &&
        document.querySelector(".rah-error") === null &&
        document.querySelector(".rah-message-action-error") === null &&
        document.body.innerText.includes("formal-workbench-agent-reply")`,
      {
        description:
          "already-open production page recovers after Core restart without reload or repeated per-Message errors",
        timeoutMs: 30_000,
      },
    );
  } catch (error) {
    const restartState = await evaluate(
      browser,
      `({
        href: location.href,
        marker: document.documentElement.dataset.rahRestartProbe,
        globalError: document.querySelector(".rah-error")?.textContent?.trim(),
        messageErrors: [...document.querySelectorAll(".rah-message-action-error")].map((element) => element.textContent?.trim()),
        repeatedErrors: window.__rahRepeatedMessageErrors,
        hasReply: document.body.innerText.includes("formal-workbench-agent-reply"),
        body: document.body.innerText.slice(0, 2000)
      })`,
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(restartState)}`,
    );
  }
  assert.deepEqual(
    await evaluate(browser, "window.__rahRepeatedMessageErrors"),
    [],
  );
  await evaluate(
    browser,
    `window.__rahRestartObserver?.disconnect(); delete window.__rahRestartObserver`,
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    width: 390,
  });
  await waitForBrowserValue(
    browser,
    `document.querySelector(".rah-mobile-nav") !== null`,
    { description: "production mobile navigation" },
  );
  assert.equal(
    await evaluate(browser, "document.documentElement.scrollWidth"),
    390,
  );
  assert.deepEqual(browserErrors, []);
  process.stdout.write(
    `RAH_LOCAL_WORKBENCH_GATE ${JSON.stringify({
      agentReply: true,
      browser: chromeExecutable,
      persistentRestart: true,
      providerSessionResume: true,
      productionBuild: true,
      seamlessBrowserRestart: true,
      viewport: "390x844",
    })}\n`,
  );
} finally {
  browser?.close();
  await terminate(chrome);
  await terminate(workbench);
  if (process.env.RAH_KEEP_GATE_TEMP === "1") {
    process.stderr.write(
      `RAH_LOCAL_WORKBENCH_GATE_TEMP ${temporaryDirectory}\n`,
    );
  } else {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
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
        PATH: `${binDirectory}${delimiter}${dirname(process.execPath)}`,
        RAH_FAKE_MODE: "worker-task",
        RAH_FAKE_CODEX_PROTOCOL_PATH: fakeCodexProtocolPath,
        RAH_FAKE_REMINDER_TITLE: "Verify durable Reminder projection",
        RAH_FAKE_ROOM_REPLY: "formal-workbench-agent-reply",
        RAH_DATA_HOME: workbenchHome,
        RAH_WEB_PORT: String(webPort),
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
  const deadline = Date.now() + 30_000;
  while (true) {
    const line = output
      .split(/\r?\n/u)
      .find((candidate) => candidate.startsWith("RAH_LOCAL_WORKBENCH "));
    if (line !== undefined) {
      return {
        descriptor: JSON.parse(line.slice("RAH_LOCAL_WORKBENCH ".length)),
        output: () => output,
        processHandle,
      };
    }
    if (processHandle.exitCode !== null) {
      throw new Error(`local workbench exited before ready:\n${output}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`local workbench startup timed out:\n${output}`);
    }
    await delay(25);
  }
}

async function gatewayClient(origin) {
  const root = await fetch(origin);
  assert.equal(root.status, 200);
  const cookie = root.headers.get("set-cookie")?.split(";", 1)[0];
  assert.notEqual(cookie, undefined);
  const client = new HttpRahClient({
    accessToken: () => "trusted-proxy-auth",
    baseUrl: origin,
    fetch: async (url, init) =>
      await fetch(url, {
        ...init,
        headers: { ...init.headers, cookie, origin },
      }),
  });
  return { client, cookie };
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
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
    await delay(50);
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
