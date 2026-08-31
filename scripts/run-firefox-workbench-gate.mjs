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

import { firefox } from "playwright";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "rah-firefox-workbench-gate-"),
);
const workbenchHome = join(temporaryDirectory, "home");
const workspaceCwd = join(temporaryDirectory, "workspace");
const binDirectory = join(temporaryDirectory, "bin");
const firefoxProfileDirectory = join(temporaryDirectory, "firefox-profile");
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
let workbench;

try {
  mkdirSync(workspaceCwd, { mode: 0o700 });
  mkdirSync(binDirectory, { mode: 0o700 });
  const codexPath = join(binDirectory, "codex");
  writeFileSync(
    codexPath,
    `#!${process.execPath}
const args = process.argv.slice(2);
if (args.join(" ") === "--version") {
  process.stdout.write("codex-firefox-gate\\n");
} else if (args.join(" ") === "debug models --bundled") {
  process.stdout.write(JSON.stringify({models:[{slug:"gpt-firefox-gate",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"}],service_tiers:[]}]}));
} else {
  await import(${JSON.stringify(new URL(`file://${fakeCli}`).href)});
}
`,
    { mode: 0o700 },
  );
  chmodSync(codexPath, 0o700);
  const started = await startWorkbench({
    binDirectory,
    webPort,
    workbenchHome,
    workspaceCwd,
  });
  workbench = started.processHandle;

  browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({
    serviceWorkers: "allow",
    viewport: { height: 1_000, width: 1_440 },
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto(started.descriptor.webOrigin, {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator(".channel-title h1", { hasText: "Agent Council" })
    .waitFor({ timeout: 20_000 });
  await page.locator(".messages").waitFor({ timeout: 20_000 });
  assert.deepEqual(
    await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      declaredScrollbarWidth: Array.from(document.styleSheets).some((sheet) =>
        Array.from(sheet.cssRules).some(
          (rule) =>
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes(".messages") &&
            rule.style.scrollbarWidth === "thin",
        ),
      ),
      railWidth: document.querySelector(".rail")?.getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
      scrollbarWidth: getComputedStyle(
        document.querySelector(".messages") ?? document.documentElement,
      ).scrollbarWidth,
    })),
    {
      clientWidth: 1_440,
      declaredScrollbarWidth: true,
      railWidth: 64,
      scrollWidth: 1_440,
      // Playwright's headless Firefox forces overlay scrollbars to none; the
      // authored standard declaration above remains the product contract.
      scrollbarWidth: "none",
    },
  );

  await page.getByTitle("Agent 与成员").click();
  await page
    .locator(".rah-agent-sidebar-head h1", { hasText: "成员" })
    .waitFor();
  assert.equal(await page.locator(".rah-agent-profile-pane").count(), 1);
  assert.deepEqual(
    await page.locator('.rah-agent-detail-tabs [role="tab"]').allTextContents(),
    ["动态", "资料", "聊天", "提醒", "工作区", "应用", "MCP"],
  );
  await page.getByRole("tab", { name: "聊天", exact: true }).click();
  await page.locator(".rah-agent-chat-pane").waitFor();
  assert.equal(
    await page.locator(".rah-agent-chat-room-list button").count(),
    0,
  );
  assert.match(
    await page.locator(".rah-agent-chat-pane").innerText(),
    /暂无频道/u,
  );
  await page.getByTitle("设置").click();
  await page.locator(".rah-settings-surface").waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    1_440,
  );

  await page.setViewportSize({ height: 844, width: 390 });
  await page.locator(".rah-mobile-nav").waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      navVisible:
        (document.querySelector(".rah-mobile-nav")?.getClientRects().length ??
          0) > 0,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    { clientWidth: 390, navVisible: true, scrollWidth: 390 },
  );
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page
    .locator(".channel-title h1", { hasText: "Agent Council" })
    .waitFor();
  await page.getByRole("button", { name: "Rooms", exact: true }).click();
  await page.locator(".rah-room-sidebar.is-open").waitFor();
  await page.getByLabel("关闭 Room 列表", { exact: true }).click();
  await page
    .locator(".rah-room-sidebar.is-open")
    .waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.locator(".rah-agent-sidebar-head").waitFor();
  assert.equal(
    await page.locator(".rah-agent-detail-panel").isVisible(),
    false,
  );
  await page.locator(".rah-agent-member-row").first().click();
  await page.locator(".rah-agent-mobile-back").waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      navVisible:
        (document.querySelector(".rah-mobile-nav")?.getClientRects().length ??
          0) > 0,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    { clientWidth: 390, navVisible: false, scrollWidth: 390 },
  );
  await page.getByLabel("返回成员列表", { exact: true }).click();
  await page.locator(".rah-agent-sidebar-head").waitFor();
  assert.equal(await page.locator(".rah-mobile-nav").isVisible(), true);
  assert.deepEqual(browserErrors, []);

  process.stdout.write(
    `RAH_FIREFOX_WORKBENCH_GATE ${JSON.stringify({
      browser: `Firefox ${browser.version()}`,
      desktopViewport: "1440x1000",
      mobileViewport: "390x844",
      persistent: started.descriptor.persistent,
    })}\n`,
  );
} finally {
  await browser?.close().catch(() => undefined);
  await terminate(workbench);
  rmSync(firefoxProfileDirectory, { force: true, recursive: true });
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

async function startWorkbench(input) {
  const processHandle = spawn(
    process.execPath,
    [join(repositoryDirectory, "scripts", "run-local-workbench.mjs")],
    {
      cwd: repositoryDirectory,
      env: {
        ...process.env,
        PATH: `${input.binDirectory}${delimiter}${process.env.PATH ?? ""}`,
        RAH_OS_HOME: input.workbenchHome,
        RAH_WEB_PORT: String(input.webPort),
        RAH_WORKSPACE_CWD: input.workspaceCwd,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const descriptor = await readAnnouncement(processHandle);
  return { descriptor, processHandle };
}

async function readAnnouncement(processHandle) {
  return await new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Firefox workbench startup timed out: ${stderr.slice(-2_000)}`,
        ),
      );
    }, 30_000);
    const cleanup = () => {
      clearTimeout(timer);
      processHandle.stdout.off("data", onStdout);
      processHandle.stderr.off("data", onStderr);
      processHandle.off("exit", onExit);
    };
    const onStdout = (chunk) => {
      stdout += String(chunk);
      for (const line of stdout.split(/\r?\n/u)) {
        if (!line.startsWith("RAH_LOCAL_WORKBENCH ")) continue;
        cleanup();
        resolvePromise(JSON.parse(line.slice("RAH_LOCAL_WORKBENCH ".length)));
        return;
      }
      if (stdout.length > 64 * 1024) stdout = stdout.slice(-32 * 1024);
    };
    const onStderr = (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8 * 1024);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Firefox workbench exited before readiness (${String(code)}/${String(signal)}): ${stderr}`,
        ),
      );
    };
    processHandle.stdout.on("data", onStdout);
    processHandle.stderr.on("data", onStderr);
    processHandle.once("exit", onExit);
  });
}

async function terminate(processHandle) {
  if (processHandle === undefined || processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => processHandle.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000)),
  ]);
  if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Firefox gate could not reserve a port");
  }
  const { port } = address;
  await new Promise((resolvePromise, reject) =>
    server.close((error) =>
      error === undefined ? resolvePromise() : reject(error),
    ),
  );
  return port;
}
