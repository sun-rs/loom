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
import { fileURLToPath, pathToFileURL } from "node:url";

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
const temporaryDirectory = mkdtempSync(join(tmpdir(), "rah-lan-gate-"));
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
const webOrigin = `https://127.0.0.1:${String(webPort)}`;
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
const args = process.argv.slice(2);
if (args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-test",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"high"}],service_tiers:[]}]}));
} else {
  await import(${JSON.stringify(pathToFileURL(fakeCli).href)});
}
`,
    { mode: 0o700 },
  );
  chmodSync(codexPath, 0o700);
  const first = await startLanWorkbench();
  workbench = first.processHandle;
  assert.equal(first.descriptor.webOrigin, webOrigin);
  assert.equal(first.descriptor.tls, true);
  assert.equal(first.descriptor.persistent, true);
  assert.equal(first.descriptor.tlsIdentity.managed, true);
  assert.equal(first.descriptor.tlsIdentity.reused, false);
  assert.equal(JSON.stringify(first.descriptor).includes("human.token"), false);

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
      "--ignore-certificate-errors",
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
  await Promise.all([
    browser.command("Network.enable"),
    browser.command("Page.enable"),
    browser.command("Runtime.enable"),
  ]);
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 1_000,
    mobile: false,
    width: 1_440,
  });
  await browser.command("Page.navigate", { url: webOrigin });
  await waitForBrowserValue(
    browser,
    `location.pathname === "/_rah/pair" && document.querySelector("h1")?.textContent?.trim() === "设备配对"`,
    { description: "formal LAN pairing page" },
  );
  await evaluate(
    browser,
    `(() => {
      document.querySelector('input[name="deviceName"]').value = "Chrome Gate";
      document.querySelector('input[name="code"]').value = ${JSON.stringify(first.descriptor.pairingCode)};
      document.querySelector("form").requestSubmit();
      return true;
    })()`,
  );
  try {
    await waitForBrowserValue(
      browser,
      `document.querySelector(".channel-title h1")?.textContent?.trim() === "Agent Council"`,
      { description: "paired production Workspace", timeoutMs: 20_000 },
    );
  } catch (error) {
    const pageState = await evaluate(
      browser,
      `({href: location.href, text: document.body.innerText.slice(0, 2000)})`,
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(pageState)}`,
    );
  }
  const cookies = await browser.command("Network.getAllCookies");
  const sessionCookie = cookies.cookies.find(
    ({ name }) => name === "rah_lan_session",
  );
  assert.notEqual(sessionCookie, undefined);
  assert.equal(sessionCookie.httpOnly, true);
  assert.equal(sessionCookie.secure, true);
  assert.equal(sessionCookie.sameSite, "Strict");
  assert.equal(
    await evaluate(
      browser,
      "document.body.innerText.includes('Human access token')",
    ),
    false,
  );
  await waitForBrowserValue(
    browser,
    `navigator.serviceWorker.ready.then(() => true).catch(() => false)`,
    { description: "installed LAN PWA service worker", timeoutMs: 20_000 },
  );
  assert.equal(
    await evaluate(
      browser,
      `document.querySelector('link[rel="manifest"]')?.getAttribute("href")`,
    ),
    "/manifest.webmanifest",
  );
  await evaluate(
    browser,
    `document.querySelector('button[title="设置"]')?.click()`,
  );
  await waitForBrowserValue(
    browser,
    `document.querySelector(".rah-settings-navigation") !== null`,
    { description: "product Settings surface" },
  );
  await evaluate(
    browser,
    `[...document.querySelectorAll(".rah-settings-navigation button")].find((button) => button.textContent?.trim() === "局域网设备")?.click()`,
  );
  try {
    await waitForBrowserValue(
      browser,
      `document.querySelector(".rah-settings-page-head h1")?.textContent?.trim() === "局域网设备" && document.body.innerText.includes("Chrome Gate") && document.body.innerText.includes("当前设备")`,
      { description: "paired-device administration" },
    );
  } catch (error) {
    const pageState = await evaluate(
      browser,
      `({href: location.href, text: document.body.innerText.slice(0, 2500)})`,
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(pageState)}`,
    );
  }
  await evaluate(
    browser,
    `[...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "生成配对码")?.click()`,
  );
  await waitForBrowserValue(
    browser,
    `/[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}/u.test(document.body.innerText)`,
    { description: "one-time pairing code from Settings" },
  );
  await evaluate(
    browser,
    `[...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "撤销")?.click()`,
  );
  await waitForBrowserValue(
    browser,
    `document.querySelector("#rah-revoke-device-title")?.textContent?.trim() === "撤销设备"`,
    { description: "Raft-shaped device revoke dialog" },
  );
  await browser.command("Input.dispatchKeyEvent", {
    code: "Escape",
    key: "Escape",
    type: "keyDown",
  });
  await browser.command("Input.dispatchKeyEvent", {
    code: "Escape",
    key: "Escape",
    type: "keyUp",
  });
  await waitForBrowserValue(
    browser,
    `document.querySelector("#rah-revoke-device-title") === null`,
    { description: "device dialog Escape close" },
  );

  await terminate(workbench);
  workbench = undefined;
  const second = await startLanWorkbench();
  workbench = second.processHandle;
  assert.equal(second.descriptor.workspaceId, first.descriptor.workspaceId);
  assert.equal(second.descriptor.pairedDevices, 1);
  await browser.command("Page.reload", { ignoreCache: true });
  await waitForBrowserValue(
    browser,
    `location.pathname !== "/_rah/pair" && document.querySelector(".rah-settings-page-head h1")?.textContent?.trim() === "局域网设备" && document.body.innerText.includes("Chrome Gate") && document.body.innerText.includes("当前设备")`,
    { description: "persistent paired LAN session", timeoutMs: 20_000 },
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
    { description: "LAN mobile navigation" },
  );
  assert.equal(
    await evaluate(browser, "document.documentElement.scrollWidth"),
    390,
  );
  const accessState = readFileSync(
    join(workbenchHome, "state", "lan-access.json"),
    "utf8",
  );
  assert.doesNotMatch(
    accessState,
    new RegExp(first.descriptor.pairingCode, "u"),
  );
  assert.doesNotMatch(accessState, new RegExp(sessionCookie.value, "u"));

  process.stdout.write(
    `RAH_LAN_WORKBENCH_GATE ${JSON.stringify({
      browser: chromeExecutable,
      deviceManagement: true,
      pairing: true,
      persistentDeviceSession: true,
      pwa: true,
      productionBuild: true,
      secureHttpOnlyCookie: true,
      tls: true,
      viewport: "390x844",
    })}\n`,
  );
} finally {
  browser?.close();
  await terminate(chrome);
  await terminate(workbench);
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

async function startLanWorkbench() {
  let output = "";
  const processHandle = spawn(
    process.execPath,
    [join(scriptDirectory, "run-lan-workbench.mjs")],
    {
      cwd: repositoryDirectory,
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${dirname(process.execPath)}`,
        RAH_LAN_BIND_HOST: "127.0.0.1",
        RAH_LAN_ORIGIN: webOrigin,
        RAH_OS_HOME: workbenchHome,
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
      .find((candidate) => candidate.startsWith("RAH_LAN_WORKBENCH "));
    if (line !== undefined) {
      return {
        descriptor: JSON.parse(line.slice("RAH_LAN_WORKBENCH ".length)),
        processHandle,
      };
    }
    if (processHandle.exitCode !== null) {
      throw new Error(`LAN workbench exited before ready:\n${output}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`LAN workbench startup timed out:\n${output}`);
    }
    await delay(25);
  }
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
