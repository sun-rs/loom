import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CdpConnection,
  delay,
  evaluate,
  findChromeExecutable,
  parseFixtureAnnouncement,
  waitForBrowserValue,
  waitForDevToolsPort,
} from "./real-browser-gate-support.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "rah-os-real-browser-gate-"),
);
const chromeProfileDirectory = join(temporaryDirectory, "chrome-profile");
const fixturePort = await availablePort();
let browser;
let chrome;
let fixture;
let fixtureOutput = "";

try {
  fixture = spawn(
    process.execPath,
    [join(scriptDirectory, "run-multi-agent-web-fixture.mjs")],
    {
      cwd: repositoryDirectory,
      env: { ...process.env, RAH_WEB_PORT: String(fixturePort) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  fixture.stdout.setEncoding("utf8");
  fixture.stderr.setEncoding("utf8");
  fixture.stdout.on("data", (chunk) => {
    fixtureOutput += chunk;
  });
  fixture.stderr.on("data", (chunk) => {
    fixtureOutput += chunk;
  });
  const descriptor = await waitForFixture(fixture, () => fixtureOutput);

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
  let chromeError = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    chromeError += chunk;
  });
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
  await browser.command("Page.navigate", { url: descriptor.webOrigin });

  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Agent Council",
    "initial Agent Council projection",
  );
  assert.equal(
    await call(browser, () => document.documentElement.scrollWidth),
    1_440,
    "desktop shell must not overflow the viewport",
  );

  await clickButton(browser, { title: "Agent 与成员" });
  await waitFor(
    browser,
    () => document.querySelector("main h1")?.textContent === "Agent 与成员",
    "Workspace Agent directory",
  );
  const directoryText = await call(
    browser,
    () => document.querySelector("main")?.textContent ?? "",
  );
  assert.match(directoryText, /Alice/u);
  assert.match(directoryText, /Kimi/u);

  await clickButton(browser, { text: "创建 Agent" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-create-dialog") !== null,
    "create Agent dialog",
  );
  await call(browser, () => {
    const dialog = document.querySelector(".rah-agent-create-dialog");
    const inputs = dialog.querySelectorAll("input");
    const textareas = dialog.querySelectorAll("textarea");
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setValue(inputs[0], "Bob");
    setValue(inputs[2], "Release reviewer");
    setValue(textareas[0], "Reviews production releases.");
    setValue(
      textareas[1],
      "Read canonical Room state and return a concise release review.",
    );
  });
  await waitFor(
    browser,
    () =>
      document.querySelectorAll(".rah-agent-create-dialog input")[1]?.value ===
      "bob",
    "derived Agent handle",
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-create-dialog .btn-pink")?.disabled ===
      false,
    "valid Agent configuration",
  );
  await call(browser, () =>
    document.querySelector(".rah-agent-create-dialog .btn-pink")?.click(),
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-create-dialog") === null &&
      document.querySelector("main")?.textContent?.includes("Bob") === true,
    "persisted Workspace Agent",
  );

  await clickButton(browser, { title: "计算机" });
  await waitFor(
    browser,
    () => document.querySelector("main h1")?.textContent === "计算机与 Runtime",
    "Computer/Runtime inventory",
  );
  assert.match(
    await call(
      browser,
      () => document.querySelector("main")?.textContent ?? "",
    ),
    /Web multi-Agent fixture/u,
  );

  await clickButton(browser, { title: "聊天" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Agent Council",
    "return to Chat",
  );

  await clickButton(browser, { ariaLabel: "新建频道" });
  await waitFor(
    browser,
    () => document.querySelector('[role="dialog"]') !== null,
    "create Room dialog",
  );
  await setDialogInput(browser, 0, "Design Lab");
  await waitFor(
    browser,
    () =>
      document.querySelectorAll(".rah-dialog input")[1]?.value === "design-lab",
    "derived Room slug",
  );

  await call(browser, () => {
    const dialog = document.querySelector('[role="dialog"]');
    const focusable = [...dialog.querySelectorAll("button, input")].filter(
      (element) => !element.disabled,
    );
    focusable.at(-1)?.focus();
  });
  await dispatchKey(browser, "Tab", 9);
  assert.equal(
    await call(
      browser,
      () =>
        document.activeElement === document.querySelector(".rah-dialog button"),
    ),
    true,
    "Tab must wrap to the first dialog control",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector('[role="dialog"]') === null,
    "Escape to close create Room dialog",
  );
  assert.equal(
    await call(
      browser,
      () => document.activeElement?.getAttribute("aria-label") === "新建频道",
    ),
    true,
    "closing a dialog must restore trigger focus",
  );

  await clickButton(browser, { ariaLabel: "新建频道" });
  await setDialogInput(browser, 0, "Design Lab");
  await waitFor(
    browser,
    () =>
      document.querySelectorAll(".rah-dialog input")[1]?.value === "design-lab",
    "Room slug before creation",
  );
  await clickButton(browser, { text: "创建频道" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Design Lab",
    "new Room selection",
  );
  const selectedRoomId = await call(browser, () =>
    new URL(location.href).searchParams.get("room"),
  );
  assert.ok(selectedRoomId, "new Room must become a reload-safe deep link");

  await clickButton(browser, {
    title: "查看和设置当前 Room 成员",
  });
  await waitFor(
    browser,
    () => document.querySelector(".rah-members-dialog") !== null,
    "Room member dialog",
  );
  await mutateRoomAgent(browser, "Alice", "加入 Room", "移出 Room");
  await mutateRoomAgent(browser, "Kimi", "加入 Room", "移出 Room");
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-members-dialog") === null,
    "member dialog close",
  );

  await postMessage(browser, "browser gate: both agents");
  await waitForMessage(browser, "browser gate: both agents");
  await waitForMessage(browser, "我已读取同一个 Room 上下文。— Alice", 20_000);
  await waitForMessage(browser, "我已读取同一个 Room 上下文。— Kimi", 20_000);
  const aliceReplyCount = await messageCount(
    browser,
    "我已读取同一个 Room 上下文。— Alice",
  );
  const kimiReplyCount = await messageCount(
    browser,
    "我已读取同一个 Room 上下文。— Kimi",
  );

  await clickButton(browser, {
    title: "查看和设置当前 Room 成员",
  });
  await mutateRoomAgent(browser, "Alice", "移出 Room", "加入 Room");
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-members-dialog") === null,
    "member dialog close after removal",
  );
  await postMessage(browser, "browser gate: Kimi only");
  await waitForMessage(browser, "browser gate: Kimi only");
  await waitFor(
    browser,
    (body, count) =>
      [...document.querySelectorAll(".msg .msg-body > p")].filter(
        (element) => element.textContent === body,
      ).length > count,
    "Kimi reply after membership convergence",
    ["我已读取同一个 Room 上下文。— Kimi", kimiReplyCount],
    20_000,
  );
  await delay(1_000);
  assert.equal(
    await messageCount(browser, "我已读取同一个 Room 上下文。— Alice"),
    aliceReplyCount,
    "removed Alice must not receive the next Room Message",
  );

  await openMessageThread(browser, "browser gate: both agents");
  await postThreadReply(browser, "browser gate: canonical Thread reply");
  await waitFor(
    browser,
    (body) =>
      [...document.querySelectorAll(".thread .msg .msg-body > p")].some(
        (element) => element.textContent === body,
      ),
    "canonical Thread reply",
    ["browser gate: canonical Thread reply"],
  );
  await clickButton(browser, { title: "关闭 Thread" });
  await waitFor(
    browser,
    () => document.querySelector(".thread") === null,
    "Thread close",
  );
  await waitFor(
    browser,
    (body) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".msg-body > p")?.textContent === body,
      );
      return (
        message?.querySelector(".thread-preview")?.textContent !== "开始 Thread"
      );
    },
    "Thread reply count projection",
    ["browser gate: both agents"],
  );

  const taskCheckboxChanged = await call(browser, () => {
    const checkbox = document.querySelector(".task-check input");
    if (!(checkbox instanceof HTMLInputElement)) return false;
    checkbox.focus();
    checkbox.click();
    return checkbox.checked;
  });
  assert.equal(taskCheckboxChanged, true, "composer must enter Task mode");
  await postMessage(browser, "browser gate: durable Task");
  await clickButton(browser, { text: "任务" });
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("submitted"),
      ),
    "Fake CLI Task submission",
    ["browser gate: durable Task"],
    20_000,
  );
  assert.match(
    await call(
      browser,
      (title) =>
        [...document.querySelectorAll(".kcard")].find(
          (card) => card.querySelector(".kcard-title")?.textContent === title,
        )?.textContent ?? "",
      "browser gate: durable Task",
    ),
    /Fake Worker completed the durable Task protocol/u,
  );
  await clickButton(browser, { text: "确认完成" });
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("completed"),
      ),
    "Human Task completion",
    ["browser gate: durable Task"],
  );

  await browser.command("Page.reload", { ignoreCache: true });
  await waitFor(
    browser,
    (roomId) =>
      new URL(location.href).searchParams.get("room") === roomId &&
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
        "Design Lab",
    "selected Room recovery after reload",
    [selectedRoomId],
    15_000,
  );
  await waitForMessage(browser, "browser gate: Kimi only", 15_000);

  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    screenHeight: 844,
    screenWidth: 390,
    width: 390,
  });
  await delay(100);
  assert.deepEqual(
    await call(browser, () => ({
      clientWidth: document.documentElement.clientWidth,
      navVisible:
        document.querySelector(".rah-mobile-nav")?.getClientRects().length > 0,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    { clientWidth: 390, navVisible: true, scrollWidth: 390 },
    "390x844 shell must expose mobile navigation without horizontal overflow",
  );
  await clickButton(browser, { text: "Rooms" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-room-sidebar.is-open") !== null,
    "mobile Rooms drawer",
  );
  await clickButton(browser, { ariaLabel: "关闭 Room 列表" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-room-sidebar.is-open") === null,
    "mobile Rooms drawer close",
  );

  assert.deepEqual(browserErrors, [], "browser console must remain error-free");
  process.stdout.write(
    `RAH_REAL_BROWSER_GATE ${JSON.stringify({
      browser: chromeExecutable,
      roomId: selectedRoomId,
      viewport: "390x844",
    })}\n`,
  );
} catch (error) {
  let browserState;
  if (browser !== undefined) {
    try {
      browserState = await call(browser, () => ({
        active: document.activeElement?.outerHTML?.slice(0, 500),
        body: document.body?.innerText?.slice(0, 4_000),
        href: location.href,
      }));
    } catch {
      // Preserve the original gate failure.
    }
  }
  if (browserState !== undefined) {
    process.stderr.write(`BROWSER_STATE ${JSON.stringify(browserState)}\n`);
  }
  if (fixtureOutput !== "") {
    process.stderr.write(`FIXTURE_LOG ${fixtureOutput.slice(-4_000)}\n`);
  }
  throw error;
} finally {
  browser?.close();
  await terminate(chrome);
  await terminate(fixture);
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
}

async function waitForFixture(processHandle, output) {
  const deadline = Date.now() + 30_000;
  while (true) {
    const current = output();
    if (/RAH_MULTI_AGENT_FIXTURE [^\r\n]+(?:\r?\n|$)/u.test(current)) {
      return parseFixtureAnnouncement(current);
    }
    if (processHandle.exitCode !== null) {
      throw new Error("multi-Agent fixture exited before its announcement");
    }
    if (Date.now() >= deadline) {
      throw new Error("multi-Agent fixture startup timed out");
    }
    await delay(25);
  }
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
      // Chrome may expose its port just before the target list is ready.
    }
    if (Date.now() >= deadline) throw new Error("Chrome page target timed out");
    await delay(25);
  }
}

function expression(callback, args = []) {
  return `(${callback.toString()})(...${JSON.stringify(args)})`;
}

async function call(connection, callback, ...args) {
  return evaluate(connection, expression(callback, args));
}

async function waitFor(
  connection,
  callback,
  description,
  args = [],
  timeoutMs = 10_000,
) {
  return waitForBrowserValue(connection, expression(callback, args), {
    description,
    timeoutMs,
  });
}

async function clickButton(connection, criteria) {
  await waitFor(
    connection,
    (expected) =>
      [...document.querySelectorAll("button")].some((button) => {
        const visible = button.getClientRects().length > 0;
        return (
          visible &&
          !button.disabled &&
          (expected.ariaLabel === undefined ||
            button.getAttribute("aria-label") === expected.ariaLabel) &&
          (expected.title === undefined || button.title === expected.title) &&
          (expected.text === undefined ||
            button.textContent?.trim() === expected.text)
        );
      }),
    `button ${JSON.stringify(criteria)}`,
    [criteria],
  );
  const clicked = await call(
    connection,
    (expected) => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) =>
          candidate.getClientRects().length > 0 &&
          !candidate.disabled &&
          (expected.ariaLabel === undefined ||
            candidate.getAttribute("aria-label") === expected.ariaLabel) &&
          (expected.title === undefined ||
            candidate.title === expected.title) &&
          (expected.text === undefined ||
            candidate.textContent?.trim() === expected.text),
      );
      button?.focus();
      button?.click();
      return button !== undefined;
    },
    criteria,
  );
  assert.equal(clicked, true);
}

async function setDialogInput(connection, index, value) {
  const changed = await call(
    connection,
    (inputIndex, nextValue) => {
      const input = document.querySelectorAll(".rah-dialog input")[inputIndex];
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    index,
    value,
  );
  assert.equal(changed, true);
}

async function mutateRoomAgent(connection, handle, action, nextAction) {
  await waitFor(
    connection,
    (agentHandle, buttonText) =>
      [...document.querySelectorAll(".rah-member-row")].some(
        (row) =>
          row.querySelector("b")?.textContent === agentHandle &&
          [...row.querySelectorAll("button")].some(
            (button) =>
              button.textContent?.trim() === buttonText && !button.disabled,
          ),
      ),
    `${action} ${handle}`,
    [handle, action],
  );
  const clicked = await call(
    connection,
    (agentHandle, buttonText) => {
      const row = [...document.querySelectorAll(".rah-member-row")].find(
        (candidate) =>
          candidate.querySelector("b")?.textContent === agentHandle,
      );
      const button = [...(row?.querySelectorAll("button") ?? [])].find(
        (candidate) => candidate.textContent?.trim() === buttonText,
      );
      button?.click();
      return button !== undefined;
    },
    handle,
    action,
  );
  assert.equal(clicked, true);
  await waitFor(
    connection,
    (agentHandle, buttonText) =>
      [...document.querySelectorAll(".rah-member-row")].some(
        (row) =>
          row.querySelector("b")?.textContent === agentHandle &&
          [...row.querySelectorAll("button")].some(
            (button) => button.textContent?.trim() === buttonText,
          ),
      ),
    `${handle} membership mutation`,
    [handle, nextAction],
  );
}

async function postMessage(connection, body) {
  const changed = await call(
    connection,
    (nextBody) => {
      const textarea = document.querySelector(
        'textarea[aria-label="消息输入框"]',
      );
      if (!(textarea instanceof HTMLTextAreaElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, nextBody);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    body,
  );
  assert.equal(changed, true);
  await clickButton(connection, { title: "发送" });
}

async function openMessageThread(connection, body) {
  await waitFor(
    connection,
    (expectedBody) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".msg-body > p")?.textContent ===
          expectedBody,
      );
      return message?.querySelector(".thread-preview") !== null;
    },
    `Thread action for ${body}`,
    [body],
  );
  const opened = await call(
    connection,
    (expectedBody) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".msg-body > p")?.textContent ===
          expectedBody,
      );
      const button = message?.querySelector(".thread-preview");
      if (!(button instanceof HTMLButtonElement)) return false;
      button.focus();
      button.click();
      return true;
    },
    body,
  );
  assert.equal(opened, true);
  await waitFor(
    connection,
    () => document.querySelector(".thread") !== null,
    "Thread pane",
  );
}

async function postThreadReply(connection, body) {
  const changed = await call(
    connection,
    (nextBody) => {
      const textarea = document.querySelector(
        'textarea[aria-label="Thread 回复输入框"]',
      );
      if (!(textarea instanceof HTMLTextAreaElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, nextBody);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    body,
  );
  assert.equal(changed, true);
  await clickButton(connection, { title: "回复" });
}

async function waitForMessage(connection, body, timeoutMs = 10_000) {
  return waitFor(
    connection,
    (expectedBody) =>
      [...document.querySelectorAll(".msg .msg-body > p")].some(
        (element) => element.textContent === expectedBody,
      ),
    `Message ${body}`,
    [body],
    timeoutMs,
  );
}

async function messageCount(connection, body) {
  return call(
    connection,
    (expectedBody) =>
      [...document.querySelectorAll(".msg .msg-body > p")].filter(
        (element) => element.textContent === expectedBody,
      ).length,
    body,
  );
}

async function dispatchKey(connection, key, virtualKeyCode) {
  await connection.command("Input.dispatchKeyEvent", {
    code: key,
    key,
    type: "keyDown",
    windowsVirtualKeyCode: virtualKeyCode,
  });
  await connection.command("Input.dispatchKeyEvent", {
    code: key,
    key,
    type: "keyUp",
    windowsVirtualKeyCode: virtualKeyCode,
  });
}

async function terminate(processHandle) {
  if (processHandle === undefined || processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => processHandle.once("exit", () => resolve(true))),
    delay(5_000).then(() => false),
  ]);
  if (exited) return;
  processHandle.kill("SIGKILL");
  await new Promise((resolve) => processHandle.once("exit", resolve));
}
