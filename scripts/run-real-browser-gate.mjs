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
const demoRoomReply = (handle, body) =>
  `我是 ${handle}，当前 Room 的演示 Agent（Fake CLI）。我已收到：“${body}”。`;
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
      env: {
        ...process.env,
        RAH_FIXTURE_HISTORY_MESSAGES: "130",
        RAH_FIXTURE_HOST_ID: `web-browser-gate-${String(process.pid)}-${String(fixturePort)}`,
        RAH_WEB_PORT: String(fixturePort),
      },
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
  await waitFor(
    browser,
    () =>
      document.querySelector(
        '.rah-mermaid-diagram[data-mermaid-status="valid"] iframe',
      ) !== null &&
      document.querySelector(".rah-markdown-code .shiki") !== null,
    "lazy Raft-compatible Markdown renderers",
  );
  assert.deepEqual(
    await call(browser, () => {
      const markdown = [
        ...document.querySelectorAll(".rah-message-markdown"),
      ].find((candidate) => candidate.textContent?.includes("Markdown gate"));
      const image = markdown?.querySelector("img");
      const file = markdown?.querySelector(".rah-markdown-file");
      const frame = markdown?.querySelector(".rah-mermaid-diagram iframe");
      return {
        filePath: file?.getAttribute("data-file-path"),
        formula: markdown?.querySelector(".katex") !== null,
        imagePath: image?.getAttribute("src"),
        markdownAttack:
          document.querySelector('[data-markdown-attack="true"]') !== null ||
          globalThis.__rahMarkdownAttack === true,
        mermaidCsp: frame
          ?.getAttribute("srcdoc")
          ?.includes("default-src 'none'"),
        table: markdown?.querySelector("table") !== null,
      };
    }),
    {
      filePath: "/tmp/rah-markdown-gate.ts",
      formula: true,
      imagePath: "/rah-app-icon.svg",
      markdownAttack: false,
      mermaidCsp: true,
      table: true,
    },
    "Message projection must support rich content without executing raw HTML",
  );

  const historyBefore = await call(browser, async () => {
    const list = document.querySelector(".messages");
    if (!(list instanceof HTMLElement)) return null;
    list.scrollTop = 0;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const articles = [...list.querySelectorAll(".msg")];
    const anchor = articles.find((article) =>
      article
        .querySelector(".rah-message-markdown")
        ?.textContent?.includes("History fixture"),
    );
    if (!(anchor instanceof HTMLElement)) return null;
    return {
      anchorBody:
        anchor.querySelector(".rah-message-markdown")?.textContent ?? "",
      anchorOffset:
        anchor.getBoundingClientRect().top - list.getBoundingClientRect().top,
      domRows: articles.length,
      hasEarlier: list.querySelector(".rah-message-history-trigger") !== null,
      totalCount: Number(
        list
          .querySelector("[data-message-timeline-total-count]")
          ?.getAttribute("data-message-timeline-total-count") ?? 0,
      ),
    };
  });
  assert.notEqual(historyBefore, null, "latest history anchor must exist");
  assert.equal(historyBefore.hasEarlier, true);
  assert.ok(
    historyBefore.totalCount >= 50 && historyBefore.totalCount <= 51,
    `latest Raft window must contain 50 Messages plus at most one concurrent reply, got ${String(historyBefore.totalCount)}`,
  );
  assert.ok(
    historyBefore.domRows <= 80,
    `the latest Message window must keep a bounded DOM, got ${String(historyBefore.domRows)} rows`,
  );
  await call(browser, () =>
    document.querySelector(".rah-message-history-trigger")?.click(),
  );
  await waitFor(
    browser,
    (minimum) =>
      Number(
        document
          .querySelector(".messages [data-message-timeline-total-count]")
          ?.getAttribute("data-message-timeline-total-count") ?? 0,
      ) >= minimum,
    "one earlier 50-Message page",
    [historyBefore.totalCount + 50],
  );
  await call(
    browser,
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await waitFor(
    browser,
    (anchorBody, expectedOffset) => {
      const list = document.querySelector(".messages");
      if (!(list instanceof HTMLElement)) return false;
      const anchor = [...list.querySelectorAll(".msg")].find(
        (article) =>
          article.querySelector(".rah-message-markdown")?.textContent ===
          anchorBody,
      );
      return (
        anchor instanceof HTMLElement &&
        Math.abs(
          anchor.getBoundingClientRect().top -
            list.getBoundingClientRect().top -
            expectedOffset,
        ) <= 2
      );
    },
    "settled prepended history anchor",
    [historyBefore.anchorBody, historyBefore.anchorOffset],
  );
  const historyAfter = await call(
    browser,
    (anchorBody) => {
      const list = document.querySelector(".messages");
      if (!(list instanceof HTMLElement)) return null;
      const anchor = [...list.querySelectorAll(".msg")].find(
        (article) =>
          article.querySelector(".rah-message-markdown")?.textContent ===
          anchorBody,
      );
      if (!(anchor instanceof HTMLElement)) return null;
      return {
        anchorOffset:
          anchor.getBoundingClientRect().top - list.getBoundingClientRect().top,
        domRows: list.querySelectorAll(".msg").length,
        totalCount: Number(
          list
            .querySelector("[data-message-timeline-total-count]")
            ?.getAttribute("data-message-timeline-total-count") ?? 0,
        ),
      };
    },
    historyBefore.anchorBody,
  );
  assert.notEqual(historyAfter, null, "prepended history anchor must remain");
  assert.ok(
    Math.abs(historyAfter.anchorOffset - historyBefore.anchorOffset) <= 2,
    `history prepend moved the visible anchor by ${String(historyAfter.anchorOffset - historyBefore.anchorOffset)}px`,
  );
  assert.equal(historyAfter.totalCount, historyBefore.totalCount + 50);
  assert.ok(
    historyAfter.domRows <= 80,
    `prepended history must keep a bounded DOM, got ${String(historyAfter.domRows)} rows`,
  );

  await clickButton(browser, { title: "Agent 与成员" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-sidebar-head h1")?.textContent ===
      "成员",
    "Workspace Agent directory",
  );
  const directoryText = await call(
    browser,
    () => document.querySelector("main")?.textContent ?? "",
  );
  assert.match(directoryText, /Alice/u);
  assert.match(directoryText, /Kimi/u);
  assert.equal(
    await call(
      browser,
      () => document.querySelector(".rah-agent-profile-pane") !== null,
    ),
    true,
    "Agent directory must open on the Raft-style profile surface",
  );
  assert.deepEqual(
    await call(browser, () =>
      [...document.querySelectorAll('.rah-agent-detail-tabs [role="tab"]')].map(
        (tab) => tab.textContent?.trim(),
      ),
    ),
    ["动态", "资料", "聊天", "提醒", "工作区", "应用", "MCP"],
    "Agent detail must preserve the complete Raft tab protocol",
  );
  assert.equal(
    await call(browser, () => {
      const separator = document.querySelector(".rah-agent-sidebar-resizer");
      separator?.focus();
      separator?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
      );
      return separator?.getAttribute("aria-valuenow");
    }),
    "240",
    "Agent directory starts with the official 240px sidebar width",
  );
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-agent-sidebar-resizer")
        ?.getAttribute("aria-valuenow") === "400",
    "keyboard-resizable Agent sidebar",
  );
  await clickButton(browser, { text: "聊天" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-agent-chat-pane")
        ?.textContent?.includes("Agent Council") === true,
    "Agent canonical Room chat directory",
  );
  await clickButton(browser, { text: "给 Alice 发消息" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
        "Alice" &&
      [
        ...document.querySelectorAll(
          ".rah-room-sidebar .rah-direct-room-row b",
        ),
      ].some((label) => label.textContent?.trim() === "Alice"),
    "Raft-style open-or-create Agent Direct Room",
  );
  assert.equal(
    await call(
      browser,
      () =>
        document
          .querySelector(".rah-room-sidebar .side-section:last-child")
          ?.textContent?.includes("私信") === true,
    ),
    true,
    "Direct Rooms must project into the dedicated sidebar section",
  );
  const directTrajectoryMessage = "browser gate: Alice runtime trajectory";
  await postMessage(browser, directTrajectoryMessage);
  await waitForMessage(browser, directTrajectoryMessage);
  await waitForMessage(
    browser,
    demoRoomReply("Alice", directTrajectoryMessage),
    15_000,
  );
  assert.equal(
    await call(browser, () => {
      const room = [
        ...document.querySelectorAll(".rah-room-sidebar button"),
      ].find((button) => button.textContent?.trim() === "#Agent Council");
      room?.click();
      return room !== undefined;
    }),
    true,
    "the canonical channel remains navigable after opening a Direct Room",
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Agent Council",
    "return from Direct Room",
  );
  await clickButton(browser, { title: "Agent 与成员" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-detail-panel") !== null,
    "return to Agent detail after Direct Room",
  );
  await clickButton(browser, { text: "动态" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-activity-pane") !== null,
    "Agent runtime trajectory surface",
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(
        ".rah-agent-activity-pane .rah-agent-activity-list article",
      ) !== null,
    "Agent runtime trajectory records",
  );
  assert.match(
    await call(
      browser,
      () =>
        document.querySelector(".rah-agent-activity-pane")?.textContent ?? "",
    ),
    /活动诊断[\s\S]*(正在检查 Room 消息|正在整理对 Room 消息的回复|回复)/u,
  );
  assert.equal(
    await call(
      browser,
      () =>
        document.querySelector(".rah-agent-activity-pane > header > button")
          ?.disabled ?? true,
    ),
    false,
    "Agent runtime trajectory diagnostics copy action must be interactive",
  );
  await call(browser, () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__rahCopiedDiagnostic = value;
        },
      },
    });
  });
  await clickButton(browser, { text: "复制诊断信息" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-agent-activity-pane > header")
        ?.textContent?.includes("已复制") === true,
    "Agent runtime trajectory diagnostics copy feedback",
  );
  assert.match(
    await call(browser, () => window.__rahCopiedDiagnostic ?? ""),
    /RAH_OS Agent runtime trajectory diagnostics[\s\S]*kind=/u,
  );
  await clickButton(browser, { text: "MCP" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-agent-mcp-pane")
        ?.textContent?.includes("暂无 MCP 使用记录") === true,
    "Agent MCP usage surface",
  );
  assert.match(
    await call(
      browser,
      () => document.querySelector(".rah-agent-mcp-pane")?.textContent ?? "",
    ),
    /暂无 MCP 使用记录/u,
  );
  assert.match(
    await call(
      browser,
      () => document.querySelector(".rah-agent-mcp-pane")?.textContent ?? "",
    ),
    /调用参数、凭据与结果正文不会进入此浏览器投影/u,
  );

  await clickButton(browser, { ariaLabel: "添加 Agent" });
  await clickButton(browser, { text: "创建 Agent" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-create-dialog") !== null,
    "create Agent dialog",
  );
  await openAgentAdvancedFields(browser);
  await call(browser, () => {
    const dialog = document.querySelector(".rah-agent-create-dialog");
    const inputs = dialog.querySelectorAll("input");
    const textareas = dialog.querySelectorAll("textarea");
    const runtime = dialog.querySelectorAll("select")[1];
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
    runtime.value = runtime.options[1].value;
    runtime.dispatchEvent(new Event("change", { bubbles: true }));
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
  await clickAgentAction(browser, "Bob", "编辑");
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-manage-dialog") !== null,
    "Agent management dialog",
  );
  await call(browser, () => {
    const dialog = document.querySelector(".rah-agent-manage-dialog");
    const inputs = dialog.querySelectorAll("input");
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setValue(inputs[0], "Bob Reviewer");
    setValue(inputs[1], "bob-reviewer");
  });
  await clickButton(browser, { text: "保存更改" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-manage-dialog") === null &&
      document.querySelector("main")?.textContent?.includes("Bob Reviewer") ===
        true,
    "persisted Agent revision",
  );
  await clickAgentAction(browser, "Bob Reviewer", "编辑");
  await clickButton(browser, { text: "暂停 Agent" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-manage-dialog") === null &&
      document.querySelector("main")?.textContent?.includes("已暂停") === true,
    "paused Agent projection",
  );
  await clickAgentAction(browser, "Bob Reviewer", "编辑");
  await clickButton(browser, { text: "删除 Agent" });
  await clickButton(browser, { text: "确认删除" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-manage-dialog") === null &&
      document.querySelector("main")?.textContent?.includes("Bob Reviewer") ===
        false,
    "deleted Agent projection",
  );

  await clickButton(browser, { ariaLabel: "添加 Agent" });
  await clickButton(browser, { text: "创建 Agent" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-create-dialog") !== null,
    "create owner-routing Agent dialog",
  );
  await openAgentAdvancedFields(browser);
  assert.equal(
    await call(
      browser,
      () =>
        document
          .querySelector(".rah-agent-create-dialog")
          ?.textContent?.includes("工具与文件权限") === true,
    ),
    false,
    "Raft-compatible Agents must not expose a CLI permission selector",
  );
  await call(browser, () => {
    const dialog = document.querySelector(".rah-agent-create-dialog");
    const inputs = dialog.querySelectorAll("input");
    const textareas = dialog.querySelectorAll("textarea");
    const runtime = dialog.querySelectorAll("select")[1];
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
    setValue(inputs[0], "Owner Router");
    setValue(inputs[2], "Task routing fixture");
    setValue(textareas[0], "Receives Human task reservations.");
    setValue(textareas[1], "Hold assigned Tasks without claiming them.");
    runtime.value = runtime.options[1].value;
    runtime.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitFor(
    browser,
    () =>
      document.querySelectorAll(".rah-agent-create-dialog input")[1]?.value ===
      "owner-router",
    "derived owner-routing Agent handle",
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-create-dialog .btn-pink")?.disabled ===
      false,
    "valid owner-routing Agent configuration",
  );
  await call(browser, () =>
    document.querySelector(".rah-agent-create-dialog .btn-pink")?.click(),
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-create-dialog") === null &&
      document.querySelector("main")?.textContent?.includes("Owner Router") ===
        true,
    "persisted owner-routing Agent",
  );
  await clickButton(browser, { title: "计算机" });
  await waitFor(
    browser,
    () => document.querySelector("main.rah-computer-directory") !== null,
    "Computer/Runtime inventory",
  );
  await call(browser, () =>
    document.querySelector(".rah-computer-row")?.click(),
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-detail h1") !== null &&
      document
        .querySelector(".rah-computer-detail")
        ?.textContent?.includes("Web multi-Agent fixture") === true,
    "selected Computer detail and Runtime inventory",
  );
  assert.match(
    await call(
      browser,
      () => document.querySelector(".rah-computer-detail")?.textContent ?? "",
    ),
    /Web multi-Agent fixture/u,
  );

  await clickButton(browser, { title: "设置" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-settings-page-head h1")?.textContent ===
      "MCP 服务器",
    "managed MCP settings",
  );
  assert.equal(
    await call(
      browser,
      () => document.querySelector(".rah-room-sidebar") === null,
    ),
    true,
    "non-Room surfaces must not retain the Chat sidebar",
  );
  await clickButton(browser, { text: "添加服务器" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-mcp-server-dialog") !== null,
    "managed MCP server dialog",
  );
  await clickButton(browser, { text: "测试连接" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-mcp-server-dialog")
        ?.textContent?.includes("已发现 1 个工具") === true,
    "managed MCP tool discovery",
  );
  await clickButton(browser, { text: "保存" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-mcp-server-card")
        ?.textContent?.includes("fixture.echo") === true,
    "canonical managed MCP server",
  );
  await clickButton(browser, { text: "分配 Agent" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-mcp-assignment-dialog") !== null,
    "managed MCP Agent assignment dialog",
  );
  await clickButton(browser, { text: "保存权限" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-mcp-assignment-list > div")
        ?.textContent?.includes("Alice") === true,
    "canonical managed MCP Agent assignment",
  );
  assert.equal(
    await call(browser, () => {
      const assignment = document.querySelector(
        ".rah-mcp-assignment-list > div",
      );
      const button = [...(assignment?.querySelectorAll("button") ?? [])].find(
        (candidate) => candidate.textContent?.trim() === "停用",
      );
      button?.click();
      return button !== undefined;
    }),
    true,
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-mcp-assignment-list > div > i")
        ?.textContent === "已停用",
    "disabled managed MCP assignment",
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
      document.querySelector(".rah-room-create-dialog .btn-pink")?.disabled ===
      false,
    "valid derived Room identity",
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
      document.querySelector(".rah-room-create-dialog .btn-pink")?.disabled ===
      false,
    "valid Room before creation",
  );
  await clickButton(browser, { text: "创建频道" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Design Lab",
    "new Room selection",
  );
  assert.equal(
    await call(
      browser,
      () => document.querySelectorAll(".rah-agent-targets").length,
    ),
    0,
    "ordinary Chat must not expose the engineering-only Room Agent delivery summary",
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
    () => document.querySelector(".rah-channel-settings-drawer") !== null,
    "Room settings drawer",
  );
  await mutateRoomAgent(browser, "Alice", "加入 Room", "移出 Room");
  await mutateRoomAgent(browser, "Kimi", "加入 Room", "移出 Room");
  await mutateRoomAgent(browser, "owner-router", "加入 Room", "移出 Room");
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-channel-settings-drawer") === null,
    "Room settings drawer close",
  );

  await postMessage(browser, "browser gate: both agents");
  await waitForMessage(browser, "browser gate: both agents");
  const aliceBothAgentsReply = demoRoomReply(
    "Alice",
    "browser gate: both agents",
  );
  const kimiBothAgentsReply = demoRoomReply(
    "Kimi",
    "browser gate: both agents",
  );
  await waitForMessage(browser, aliceBothAgentsReply, 20_000);
  await waitForMessage(browser, kimiBothAgentsReply, 20_000);
  const aliceReplyCount = await messageCountByAuthor(
    browser,
    "Alice",
    aliceBothAgentsReply,
  );
  const kimiReplyCount = await messageCountByAuthor(
    browser,
    "Kimi",
    kimiBothAgentsReply,
  );
  assert.deepEqual(
    await call(browser, () => ({
      activityPanel:
        document.querySelector(".rah-agent-activity-pane") !== null,
      messageOwnedStatus: [...document.querySelectorAll(".msg")].some(
        (message) => /正在准备响应|正在处理/u.test(message.textContent ?? ""),
      ),
    })),
    { activityPanel: false, messageOwnedStatus: false },
    "Room Chat must contain only conversation Messages, not Agent execution diagnostics",
  );
  await clickButton(browser, { title: "Agent 与成员" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-activity-pane") === null,
    "Agent profile surface after leaving Chat",
  );
  await clickButton(browser, { text: "动态" });
  await waitFor(
    browser,
    () =>
      document.querySelector(
        ".rah-agent-activity-pane .rah-agent-activity-list article",
      ) !== null,
    "current Room activity projection on the selected Agent",
  );
  await clickButton(browser, { title: "聊天" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Design Lab",
    "return to Room Chat after Agent activity inspection",
  );

  await clickButton(browser, {
    title: "查看和设置当前 Room 成员",
  });
  await mutateRoomAgent(browser, "Alice", "移出 Room", "加入 Room");
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-channel-settings-drawer") === null,
    "Room settings drawer close after removal",
  );
  await postMessage(browser, "browser gate: Kimi only");
  await waitForMessage(browser, "browser gate: Kimi only");
  const kimiOnlyReply = demoRoomReply("Kimi", "browser gate: Kimi only");
  await waitForMessage(browser, kimiOnlyReply, 20_000);
  assert.equal(
    await messageCountByAuthor(browser, "Kimi", kimiBothAgentsReply),
    kimiReplyCount,
    "Kimi must produce one contextual reply per received Room Message",
  );
  await delay(1_000);
  assert.equal(
    await messageCountByAuthor(browser, "Alice", aliceBothAgentsReply),
    aliceReplyCount,
    "removed Alice must not receive the next Room Message",
  );
  assert.equal(
    await messageCountByAuthor(
      browser,
      "Alice",
      demoRoomReply("Alice", "browser gate: Kimi only"),
    ),
    0,
    "removed Alice must not produce a contextual reply for the next Room Message",
  );

  await openMessageThread(browser, "browser gate: both agents");
  await postThreadReply(browser, "browser gate: canonical Thread reply");
  await waitFor(
    browser,
    (body) =>
      [...document.querySelectorAll(".thread .msg .rah-message-markdown")].some(
        (element) => element.textContent === body,
      ),
    "canonical Thread reply",
    ["browser gate: canonical Thread reply"],
  );
  await openMessageContextMenu(
    browser,
    "browser gate: canonical Thread reply",
    {
      scope: ".thread",
    },
  );
  await delay(100);
  assert.equal(
    await call(
      browser,
      () => document.querySelector(".rah-message-context-menu") !== null,
    ),
    false,
    "Thread replies must not expose Convert to Task",
  );
  await clickButton(browser, { title: "关闭 Thread" });
  await waitFor(
    browser,
    () => document.querySelector(".thread") === null,
    "Thread close",
  );
  await waitFor(
    browser,
    (body, replyBody) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          body,
      );
      const preview = message?.querySelector(".thread-preview");
      const reply = preview?.querySelector(".tp-line");
      return (
        preview?.textContent?.includes("1 条回复") === true &&
        preview.querySelectorAll(".tp-line").length === 1 &&
        (reply?.querySelector("b")?.textContent?.trim().length ?? 0) > 0 &&
        reply?.querySelector(".tp-text")?.textContent === replyBody &&
        (reply?.querySelector("time")?.textContent?.trim().length ?? 0) > 0
      );
    },
    "Thread reply count and latest reply projection",
    ["browser gate: both agents", "browser gate: canonical Thread reply"],
  );
  assert.equal(
    await call(
      browser,
      (body) => {
        const message = [...document.querySelectorAll(".msg")].find(
          (candidate) =>
            candidate.querySelector(".rah-message-markdown")?.textContent ===
            body,
        );
        const preview = message?.querySelector(".thread-preview");
        if (!(preview instanceof HTMLButtonElement)) return false;
        preview.click();
        return true;
      },
      "browser gate: both agents",
    ),
    true,
  );
  await waitFor(
    browser,
    (roomId) =>
      document.querySelector(".thread") !== null &&
      new URL(location.href).searchParams
        .get("thread")
        ?.startsWith(`${roomId}:`) === true,
    "Thread deep link",
    [selectedRoomId],
  );
  await browser.command("Page.reload", { ignoreCache: true });
  await waitFor(
    browser,
    (roomId, replyBody) =>
      new URL(location.href).searchParams
        .get("thread")
        ?.startsWith(`${roomId}:`) === true &&
      [...document.querySelectorAll(".thread .rah-message-markdown")].some(
        (element) => element.textContent === replyBody,
      ),
    "Thread recovery after reload",
    [selectedRoomId, "browser gate: canonical Thread reply"],
    15_000,
  );
  await clickButton(browser, { title: "关闭 Thread" });

  await openMessageContextMenu(browser, "browser gate: both agents");
  await clickButton(browser, { text: "Convert to Task" });
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".msg")].some(
        (message) =>
          message.querySelector(".rah-message-markdown")?.textContent ===
            title &&
          message
            .querySelector(".rah-message-task-meta")
            ?.textContent?.includes("Task #1"),
      ),
    "converted Message keeps its channel position and gains Task metadata",
    ["browser gate: both agents"],
  );
  await clickButton(browser, { text: "任务" });
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("submitted"),
      ),
    "converted Message enters the canonical Task workflow",
    ["browser gate: both agents"],
    20_000,
  );
  await clickTaskButton(browser, "browser gate: both agents", "打开讨论");
  await waitFor(
    browser,
    (body) =>
      [...document.querySelectorAll(".thread .msg .rah-message-markdown")].some(
        (element) => element.textContent === body,
      ),
    "converted Task reuses its existing Thread history",
    ["browser gate: canonical Thread reply"],
  );
  await clickButton(browser, { title: "关闭 Thread" });
  await clickTaskButton(browser, "browser gate: both agents", "确认完成");

  await clickButton(browser, { text: "新建任务" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-task-create-dialog") !== null,
    "Task board create dialog",
  );
  await setTaskDialogContent(
    browser,
    "browser gate: board Task",
    "Created directly from the canonical Task board",
  );
  await clickButton(browser, { text: "创建任务" });
  await waitFor(
    browser,
    (title) =>
      document.querySelector(".rah-task-create-dialog") === null &&
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.querySelector(".kcard-no")?.textContent === "#2",
      ),
    "Task board create projects one numbered card",
    ["browser gate: board Task"],
  );
  await clickButton(browser, { text: "聊天" });
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".msg")].some(
        (message) =>
          message.querySelector(".rah-message-markdown")?.textContent ===
            title &&
          message
            .querySelector(".rah-message-task-meta")
            ?.textContent?.includes("Task #2"),
      ),
    "Task board create shares the canonical top-level Message anchor",
    ["browser gate: board Task"],
  );
  await clickButton(browser, { text: "任务" });
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("submitted"),
      ),
    "Task board Task submission",
    ["browser gate: board Task"],
    20_000,
  );
  await clickTaskButton(browser, "browser gate: board Task", "打开讨论");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".thread .msg .rah-message-markdown")].some(
        (message) => message.textContent === title,
      ),
    "Task board create opens its canonical Thread anchor",
    ["browser gate: board Task"],
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 720,
    mobile: false,
    width: 1_280,
  });
  await clickTaskButtonWithPointer(
    browser,
    "browser gate: board Task",
    "确认完成",
  );
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("completed"),
      ),
    "Task board Task Human completion",
    ["browser gate: board Task"],
  );
  await clickButton(browser, { title: "关闭 Thread" });
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 1_000,
    mobile: false,
    width: 1_440,
  });

  await clickButton(browser, {
    title: "查看和设置当前 Room 成员",
  });
  await mutateRoomAgent(browser, "Alice", "加入 Room", "移出 Room");
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-channel-settings-drawer") === null,
    "Room settings drawer close before Review gate",
  );
  await clickButton(browser, { text: "新建任务" });
  await setTaskDialogContent(
    browser,
    "browser gate: frozen Review",
    "Kimi owns the change and Alice independently reviews the frozen submission.",
  );
  await setTaskDialogAssignee(browser, "Kimi");
  await setTaskDialogRole(browser, "审阅者", "Alice");
  await clickButton(browser, { text: "创建任务" });
  await waitFor(
    browser,
    (title) => {
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === title,
      );
      const evidence = card?.querySelector(".rah-task-review-evidence");
      return (
        card?.textContent?.includes("submitted") === true &&
        evidence?.getAttribute("data-task-review-status") === "approved" &&
        /提交 #1 · 审阅 1\/1 · sha256:[a-f0-9]{8}/u.test(
          evidence?.textContent ?? "",
        ) &&
        [...(card?.querySelectorAll("button") ?? [])].some(
          (button) => button.textContent?.trim() === "确认完成",
        )
      );
    },
    "frozen submission and canonical approved Review",
    ["browser gate: frozen Review"],
    20_000,
  );
  await clickTaskButton(browser, "browser gate: frozen Review", "打开讨论");
  await waitFor(
    browser,
    () => {
      const bodies = [
        ...document.querySelectorAll(".thread .msg .rah-message-markdown"),
      ].map((message) => message.textContent ?? "");
      return (
        bodies.some((body) =>
          body.includes("Fake Worker completed the durable Task protocol"),
        ) &&
        bodies.some((body) =>
          body.includes("审阅通过：提交证据与 Task 范围一致。"),
        )
      );
    },
    "owner submission and reviewer evidence in canonical Task Thread",
  );
  await clickButton(browser, { title: "关闭 Thread" });
  await clickTaskButton(browser, "browser gate: frozen Review", "确认完成");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("completed"),
      ),
    "Human completion after canonical Review",
    ["browser gate: frozen Review"],
  );
  await clickButton(browser, { text: "聊天" });

  const taskCheckboxChanged = await call(browser, () => {
    const checkbox = document.querySelector(".task-check input");
    if (!(checkbox instanceof HTMLInputElement)) return false;
    checkbox.focus();
    checkbox.click();
    return checkbox.checked;
  });
  assert.equal(taskCheckboxChanged, true, "composer must enter Task mode");
  await postMessage(browser, "browser gate: durable Task");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".msg")].some(
        (message) =>
          message.querySelector(".rah-message-markdown")?.textContent ===
            title &&
          message
            .querySelector(".rah-message-task-meta")
            ?.textContent?.includes("Task #"),
      ),
    "Task remains a top-level Message",
    ["browser gate: durable Task"],
  );
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
  assert.match(
    await call(
      browser,
      (title) =>
        [...document.querySelectorAll(".kcard")]
          .find(
            (card) => card.querySelector(".kcard-title")?.textContent === title,
          )
          ?.querySelector(".kcard-no")?.textContent ?? "",
      "browser gate: durable Task",
    ),
    /^#\d+$/u,
  );
  await clickTaskButton(browser, "browser gate: durable Task", "打开讨论");
  await waitFor(
    browser,
    (summary) =>
      [...document.querySelectorAll(".thread .msg .rah-message-markdown")].some(
        (element) => element.textContent === summary,
      ),
    "Task submission in canonical Thread",
    ["Fake Worker completed the durable Task protocol"],
  );
  await clickButton(browser, { title: "关闭 Thread" });
  await clickTaskButton(browser, "browser gate: durable Task", "确认完成");
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

  await clickButton(browser, {
    title: "查看和设置当前 Room 成员",
  });
  await mutateRoomAgent(browser, "Kimi", "移出 Room", "加入 Room");
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-channel-settings-drawer") === null,
    "Room settings drawer close before owner routing",
  );

  await clickButton(browser, { text: "新建任务" });
  await setTaskDialogContent(
    browser,
    "browser gate: owner routing",
    "Human reservation must remain distinct from Agent claim ownership",
  );
  await setTaskDialogAssignee(browser, "owner-router");
  await clickButton(browser, { text: "创建任务" });
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("todo") === true &&
          card
            .querySelector(".rah-task-owner-trigger")
            ?.getAttribute("aria-label")
            ?.includes("owner-router") === true,
      ),
    "preassigned Human Task reservation",
    ["browser gate: owner routing"],
  );
  await clickTaskOwnerTrigger(browser, "browser gate: owner routing");
  assert.deepEqual(
    await call(browser, () => {
      const menu = document.querySelector(".rah-task-owner-menu");
      const header = menu?.querySelector("header");
      const option = menu?.querySelector(".rah-task-owner-options > button");
      if (menu === null || header === null || option === null) return undefined;
      return {
        headerHeight: header.getBoundingClientRect().height,
        menuWidth: menu.getBoundingClientRect().width,
        optionHeight: option.getBoundingClientRect().height,
      };
    }),
    { headerHeight: 32, menuWidth: 220, optionHeight: 36 },
    "Task owner menu must consume the pinned Raft Tasks geometry",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-task-owner-menu") === null,
    "Escape closes Task owner menu",
  );
  await clickTaskOwnerTrigger(browser, "browser gate: owner routing");
  await clickTaskOwnerOption(browser, "browser gate: owner routing", "未分配");
  await waitForTaskOwner(browser, "browser gate: owner routing", "未分配");
  await clickTaskOwnerTrigger(browser, "browser gate: owner routing");
  await clickTaskOwnerOption(
    browser,
    "browser gate: owner routing",
    "owner-router",
  );
  await waitForTaskOwner(
    browser,
    "browser gate: owner routing",
    "owner-router",
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
  await clickButton(browser, { text: "任务" });
  await waitForTaskOwner(
    browser,
    "browser gate: owner routing",
    "owner-router",
  );
  await clickTaskOwnerTrigger(browser, "browser gate: owner routing");
  await clickTaskOwnerOption(browser, "browser gate: owner routing", "未分配");
  await waitForTaskOwner(browser, "browser gate: owner routing", "未分配");
  await clickTaskButton(browser, "browser gate: owner routing", "关闭任务");
  assert.equal(
    await call(
      browser,
      () =>
        document.activeElement instanceof HTMLTextAreaElement &&
        document.activeElement
          .closest("label")
          ?.textContent?.includes("关闭原因"),
    ),
    true,
    "Task close dialog must focus the required reason field",
  );
  await setTaskCloseReason(
    browser,
    "Browser gate verifies reversible Closed state",
  );
  assert.equal(
    await call(browser, () => {
      const button = document.querySelector(
        ".rah-task-close-dialog button.btn-pink",
      );
      if (!(button instanceof HTMLButtonElement) || button.disabled)
        return false;
      button.click();
      return true;
    }),
    true,
    "Task close dialog confirmation",
  );
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("cancelled") &&
          [...card.querySelectorAll("button")].some(
            (button) => button.textContent?.trim() === "重开为待办",
          ),
      ),
    "Task Closed projection and reversible action",
    ["browser gate: owner routing"],
  );
  await clickTaskButton(browser, "browser gate: owner routing", "重开为待办");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.textContent?.includes("todo") &&
          !card.textContent?.includes("cancelled"),
      ),
    "Task Closed to Todo recovery",
    ["browser gate: owner routing"],
  );
  await clickButton(browser, { title: "聊天" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Design Lab",
    "return to Room after owner routing",
  );

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
  await clickButton(browser, { text: "Agents" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-sidebar-head h1")?.textContent ===
        "成员" &&
      document.querySelector(".rah-agent-detail-panel")?.getClientRects()
        .length === 0,
    "mobile Agent list-first surface",
  );
  await call(browser, () =>
    [...document.querySelectorAll(".rah-agent-member-row")]
      .find((row) => row.querySelector("b")?.textContent === "Alice")
      ?.click(),
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-mobile-back")?.getClientRects()
        .length > 0 &&
      document.querySelector(".rah-mobile-nav")?.getClientRects().length === 0,
    "mobile focused Agent detail",
  );
  assert.deepEqual(
    await call(browser, () => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      tabs: [
        ...document.querySelectorAll('.rah-agent-detail-tabs [role="tab"]'),
      ].map((tab) => tab.textContent?.trim()),
    })),
    {
      clientWidth: 390,
      scrollWidth: 390,
      tabs: ["动态", "资料", "聊天", "提醒", "工作区", "应用", "MCP"],
    },
    "mobile Agent detail must remain overflow-free and share desktop tabs",
  );
  await clickButton(browser, { ariaLabel: "返回成员列表" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-sidebar-head")?.getClientRects()
        .length > 0 &&
      document.querySelector(".rah-mobile-nav")?.getClientRects().length > 0,
    "mobile return to Agent list",
  );
  await clickButton(browser, { text: "设置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-settings-surface") !== null,
    "mobile managed MCP settings",
  );
  assert.equal(
    await call(browser, () => document.documentElement.scrollWidth),
    390,
    "mobile managed MCP settings must not overflow",
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

async function clickTaskButton(connection, title, text) {
  await waitFor(
    connection,
    (taskTitle, buttonText) => {
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === taskTitle,
      );
      return [...(card?.querySelectorAll("button") ?? [])].some(
        (button) =>
          !button.disabled && button.textContent?.trim() === buttonText,
      );
    },
    `Task ${title} button ${text}`,
    [title, text],
  );
  assert.equal(
    await call(
      connection,
      (taskTitle, buttonText) => {
        const card = [...document.querySelectorAll(".kcard")].find(
          (candidate) =>
            candidate.querySelector(".kcard-title")?.textContent === taskTitle,
        );
        const button = [...(card?.querySelectorAll("button") ?? [])].find(
          (candidate) => candidate.textContent?.trim() === buttonText,
        );
        button?.click();
        return button !== undefined;
      },
      title,
      text,
    ),
    true,
  );
}

async function clickTaskButtonWithPointer(connection, title, text) {
  const target = await call(
    connection,
    (taskTitle, buttonText) => {
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === taskTitle,
      );
      const button = [...(card?.querySelectorAll("button") ?? [])].find(
        (candidate) =>
          !candidate.disabled && candidate.textContent?.trim() === buttonText,
      );
      if (!(button instanceof HTMLButtonElement)) return null;
      const bounds = button.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        hitTarget: hit === button || button.contains(hit),
        x,
        y,
      };
    },
    title,
    text,
  );
  assert.notEqual(target, null, `Task ${title} button ${text} must be visible`);
  assert.equal(
    target.hitTarget,
    true,
    `Task ${title} button ${text} must be the pointer hit target`,
  );
  await connection.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.x,
    y: target.y,
  });
  await connection.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mousePressed",
    x: target.x,
    y: target.y,
  });
  await connection.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseReleased",
    x: target.x,
    y: target.y,
  });
}

async function openMessageContextMenu(
  connection,
  body,
  { scope = ".chan-pane" } = {},
) {
  const opened = await call(
    connection,
    (messageBody, selector) => {
      const message = [...document.querySelectorAll(`${selector} .msg`)].find(
        (candidate) =>
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          messageBody,
      );
      if (message === undefined) return false;
      const bounds = message.getBoundingClientRect();
      message.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + 80,
          clientY: bounds.top + 20,
        }),
      );
      return true;
    },
    body,
    scope,
  );
  assert.equal(opened, true, `Message ${body} must be visible`);
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

async function setTaskDialogContent(connection, title, description) {
  assert.equal(
    await call(
      connection,
      (nextTitle, nextDescription) => {
        const dialog = document.querySelector(".rah-task-create-dialog");
        const input = dialog?.querySelector("input");
        const textarea = dialog?.querySelector("textarea");
        if (
          !(input instanceof HTMLInputElement) ||
          !(textarea instanceof HTMLTextAreaElement)
        )
          return false;
        const inputSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        const textareaSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        inputSetter?.call(input, nextTitle);
        textareaSetter?.call(textarea, nextDescription);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      title,
      description,
    ),
    true,
  );
}

async function setTaskCloseReason(connection, reason) {
  assert.equal(
    await call(
      connection,
      (nextReason) => {
        const textarea = document.querySelector(
          ".rah-task-close-dialog textarea",
        );
        if (!(textarea instanceof HTMLTextAreaElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, nextReason);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      reason,
    ),
    true,
  );
}

async function setTaskDialogAssignee(connection, label) {
  assert.equal(
    await call(
      connection,
      (optionLabel) => {
        const select = document.querySelector(".rah-task-create-dialog select");
        if (!(select instanceof HTMLSelectElement)) return false;
        const option = [...select.options].find(
          (candidate) => candidate.textContent?.trim() === optionLabel,
        );
        if (option === undefined) return false;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set;
        setter?.call(select, option.value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      label,
    ),
    true,
  );
}

async function setTaskDialogRole(connection, legendText, agentLabel) {
  assert.equal(
    await call(
      connection,
      (nextLegendText, nextAgentLabel) => {
        const fieldset = [
          ...document.querySelectorAll(
            ".rah-task-create-dialog .rah-task-dialog-roles",
          ),
        ].find((candidate) =>
          candidate
            .querySelector("legend")
            ?.textContent?.includes(nextLegendText),
        );
        const label = [...(fieldset?.querySelectorAll("label") ?? [])].find(
          (candidate) => candidate.textContent?.trim() === nextAgentLabel,
        );
        const input = label?.querySelector("input");
        if (!(input instanceof HTMLInputElement) || input.disabled)
          return false;
        input.click();
        return input.checked;
      },
      legendText,
      agentLabel,
    ),
    true,
  );
}

async function clickTaskOwnerTrigger(connection, title) {
  const clicked = await call(
    connection,
    (taskTitle) => {
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === taskTitle,
      );
      const trigger = card?.querySelector(".rah-task-owner-trigger");
      if (!(trigger instanceof HTMLButtonElement) || trigger.disabled)
        return false;
      trigger.focus();
      trigger.click();
      return true;
    },
    title,
  );
  assert.equal(clicked, true, `Task ${title} owner trigger`);
  await waitFor(
    connection,
    () => document.querySelector(".rah-task-owner-menu") !== null,
    `Task ${title} owner menu`,
  );
}

async function clickTaskOwnerOption(connection, title, label) {
  const clicked = await call(
    connection,
    (taskTitle, optionLabel) => {
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === taskTitle,
      );
      const option = [
        ...(card?.querySelectorAll("[role=menuitemradio]") ?? []),
      ].find(
        (candidate) =>
          candidate.querySelector("span:last-child")?.textContent?.trim() ===
          optionLabel,
      );
      if (!(option instanceof HTMLButtonElement) || option.disabled)
        return false;
      option.click();
      return true;
    },
    title,
    label,
  );
  assert.equal(clicked, true, `Task ${title} owner option ${label}`);
}

async function waitForTaskOwner(connection, title, label) {
  await waitFor(
    connection,
    (taskTitle, ownerLabel) => {
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === taskTitle,
      );
      return (
        card
          ?.querySelector(".rah-task-owner-trigger")
          ?.getAttribute("aria-label") ===
          `Task #${card.querySelector(".kcard-no")?.textContent?.slice(1)} 负责人：${ownerLabel}` &&
        card.textContent?.includes("todo") === true
      );
    },
    `Task ${title} owner ${label}`,
    [title, label],
    15_000,
  );
}

async function mutateRoomAgent(connection, handle, action, nextAction) {
  if (
    !(await call(
      connection,
      () => document.querySelector(".rah-channel-member-manager") !== null,
    ))
  ) {
    await clickButton(connection, { ariaLabel: "添加成员" });
    await waitFor(
      connection,
      () => document.querySelector(".rah-channel-member-manager") !== null,
      "expanded Room member manager",
    );
  }
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

async function clickAgentAction(connection, displayName, action) {
  await waitFor(
    connection,
    (name) =>
      [...document.querySelectorAll(".rah-agent-member-row")].some(
        (button) => button.querySelector("b")?.textContent === name,
      ),
    `${action} ${displayName}`,
    [displayName],
  );
  const selected = await call(
    connection,
    (name) => {
      const button = [
        ...document.querySelectorAll(".rah-agent-member-row"),
      ].find((candidate) => candidate.querySelector("b")?.textContent === name);
      button?.click();
      return button !== undefined;
    },
    displayName,
  );
  assert.equal(selected, true);
  await waitFor(
    connection,
    (name) =>
      document.querySelector(".rah-agent-detail-head h2")?.textContent ===
        name &&
      document.querySelector(`[aria-label="管理 ${name}"]`)?.disabled === false,
    `${action} selected Agent ${displayName}`,
    [displayName],
  );
  const opened = await call(
    connection,
    (name) => {
      const button = document.querySelector(`[aria-label="管理 ${name}"]`);
      button?.click();
      return button !== null;
    },
    displayName,
  );
  assert.equal(opened, true, `${action} ${displayName}`);
}

async function openAgentAdvancedFields(connection) {
  assert.equal(
    await call(connection, () => {
      const button = document.querySelector(
        ".rah-agent-create-dialog .rah-agent-disclosure:not(.is-nested)",
      );
      button?.click();
      return button !== null;
    }),
    true,
  );
  await waitFor(
    connection,
    () =>
      document.querySelector(
        ".rah-agent-create-dialog .rah-agent-disclosure.is-nested",
      ) !== null,
    "Agent advanced disclosure",
  );
  assert.equal(
    await call(connection, () => {
      const button = document.querySelector(
        ".rah-agent-create-dialog .rah-agent-disclosure.is-nested",
      );
      button?.click();
      return button !== null;
    }),
    true,
  );
  await waitFor(
    connection,
    () =>
      document.querySelector(
        ".rah-agent-create-dialog .rah-agent-advanced-fields",
      ) !== null,
    "Agent advanced fields",
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
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          expectedBody,
      );
      return (
        message?.querySelector(".thread-preview") === null &&
        message?.querySelector(
          '.msg-actions button[title="在消息列中回复"]',
        ) !== null
      );
    },
    `reply-less Message hover Thread action for ${body}`,
    [body],
  );
  const opened = await call(
    connection,
    (expectedBody) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          expectedBody,
      );
      const button = message?.querySelector(
        '.msg-actions button[title="在消息列中回复"]',
      );
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
      [...document.querySelectorAll(".msg .rah-message-markdown")].some(
        (element) => element.textContent === expectedBody,
      ),
    `Message ${body}`,
    [body],
    timeoutMs,
  );
}

async function messageCountByAuthor(connection, author, body) {
  return call(
    connection,
    (expectedAuthor, expectedBody) =>
      [...document.querySelectorAll(".msg")].filter(
        (message) =>
          message.querySelector(".msg-head > b")?.textContent ===
            expectedAuthor &&
          message.querySelector(".rah-message-markdown")?.textContent ===
            expectedBody,
      ).length,
    author,
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
