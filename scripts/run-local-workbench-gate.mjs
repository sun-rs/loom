import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
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
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fakeCli)} "$@"\n`,
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
      productionBuild: true,
      viewport: "390x844",
    })}\n`,
  );
} finally {
  browser?.close();
  await terminate(chrome);
  await terminate(workbench);
  rmSync(temporaryDirectory, { force: true, recursive: true });
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
        RAH_FAKE_ROOM_REPLY: "formal-workbench-agent-reply",
        RAH_OS_HOME: workbenchHome,
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

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
