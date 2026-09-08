import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const downloadDirectory = join(temporaryDirectory, "downloads");
mkdirSync(downloadDirectory, { recursive: true });
const agentAvatarPngPath = join(temporaryDirectory, "agent-avatar.png");
writeFileSync(
  agentAvatarPngPath,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V7viPwAHwwMjerDEwwAAAABJRU5ErkJggg==",
    "base64",
  ),
);
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
  await browser.command("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDirectory,
  });
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
  await waitFor(
    browser,
    () => {
      const channel = document.querySelector(
        '.rah-room-sidebar [data-sidebar-key^="room:"] .channel-row',
      );
      const sort = document.querySelector(
        '.rah-room-sidebar button[aria-label="频道排序"]',
      );
      const pin = document.querySelector(
        ".rah-room-sidebar .rah-sidebar-pin-keyboard",
      );
      return (
        channel instanceof HTMLButtonElement &&
        !channel.disabled &&
        sort instanceof HTMLButtonElement &&
        !sort.disabled &&
        pin instanceof HTMLButtonElement &&
        !pin.disabled
      );
    },
    "interactive Room sidebar after preference hydration",
  );
  assert.equal(
    await call(browser, () => {
      const textarea = document.querySelector(
        'textarea[aria-label="消息输入框"]',
      );
      if (!(textarea instanceof HTMLTextAreaElement)) return false;
      textarea.focus();
      return true;
    }),
    true,
    "Room composer must accept an Agent mention query",
  );
  await browser.command("Input.insertText", { text: "@" });
  await waitFor(
    browser,
    () => {
      const menu = document.querySelector(
        '.rah-composer-mention-menu[role="listbox"]',
      );
      const row = menu?.querySelector('.mention-row[aria-selected="true"]');
      return (
        menu !== null &&
        row?.classList.contains("is-active") === true &&
        row.querySelector(".rah-agent-avatar") !== null
      );
    },
    "Raft Agent mention autocomplete",
  );
  assert.deepEqual(
    await call(browser, () => {
      const menu = document.querySelector(".rah-composer-mention-menu");
      const row = menu?.querySelector('.mention-row[aria-selected="true"]');
      if (!(menu instanceof HTMLElement) || !(row instanceof HTMLElement))
        return null;
      const menuStyle = getComputedStyle(menu);
      const rowStyle = getComputedStyle(row);
      const probe = document.createElement("i");
      probe.style.background = "var(--yellow)";
      document.body.append(probe);
      const yellow = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        activeMatchesYellow: rowStyle.backgroundColor === yellow,
        agentBadge: row.textContent?.includes("AGENT") === true,
        borderWidth: menuStyle.borderWidth,
        hardShadow: menuStyle.boxShadow.includes("4px 4px 0px 0px"),
      };
    }),
    {
      activeMatchesYellow: true,
      agentBadge: true,
      borderWidth: "2px",
      hardShadow: true,
    },
    "mention menu must reuse Raft border, hard shadow and yellow active row",
  );
  await dispatchKey(browser, "Enter", 13);
  await waitFor(
    browser,
    () => {
      const textarea = document.querySelector(
        'textarea[aria-label="消息输入框"]',
      );
      return (
        textarea instanceof HTMLTextAreaElement &&
        /^@[\w.-]+ $/u.test(textarea.value) &&
        document.querySelector(".rah-composer-mention-menu") === null
      );
    },
    "keyboard mention completion without Message submission",
  );
  await call(browser, () => {
    const textarea = document.querySelector(
      'textarea[aria-label="消息输入框"]',
    );
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await assertInteractionStateProtocol(browser);
  await waitFor(
    browser,
    () =>
      [...document.querySelectorAll(".msg-actions")].some((actions) => {
        const reply = actions.querySelector('button[title="在消息列中回复"]');
        const reaction = actions.querySelector('button[aria-label="添加回应"]');
        const saved = actions.querySelector('button[title="收藏消息"]');
        return [reply, reaction, saved].every(
          (button) => button instanceof HTMLButtonElement && !button.disabled,
        );
      }),
    "Raft three-action Message toolbar after social hydration",
  );
  await waitFor(
    browser,
    () => {
      const markdown = [
        ...document.querySelectorAll(".rah-message-markdown"),
      ].find((candidate) => candidate.textContent?.includes("Markdown gate"));
      const collapsible = markdown?.closest(".rah-collapsible-message");
      return (
        collapsible?.getAttribute("data-collapsed") === "true" &&
        collapsible?.getAttribute("data-long-message") === "true" &&
        collapsible.querySelector(".rah-long-message-toggle")?.textContent ===
          "展开全文"
      );
    },
    "Raft default long Message collapse",
  );
  const expandedLongMessage = await call(browser, () => {
    const markdown = [
      ...document.querySelectorAll(".rah-message-markdown"),
    ].find((candidate) => candidate.textContent?.includes("Markdown gate"));
    const collapsible = markdown?.closest(".rah-collapsible-message");
    const content = collapsible?.querySelector(
      ".rah-collapsible-message-content",
    );
    const before = content?.clientHeight ?? 0;
    collapsible?.querySelector(".rah-long-message-toggle")?.click();
    return { before, found: collapsible !== null };
  });
  assert.equal(expandedLongMessage.found, true);
  assert.ok(expandedLongMessage.before <= 320);
  await waitFor(
    browser,
    () => {
      const markdown = [
        ...document.querySelectorAll(".rah-message-markdown"),
      ].find((candidate) => candidate.textContent?.includes("Markdown gate"));
      const collapsible = markdown?.closest(".rah-collapsible-message");
      const content = collapsible?.querySelector(
        ".rah-collapsible-message-content",
      );
      return (
        collapsible?.getAttribute("data-collapsed") === "false" &&
        (content?.clientHeight ?? 0) > 320 &&
        collapsible.querySelector(".rah-long-message-toggle")?.textContent ===
          "收起"
      );
    },
    "expanded long Message geometry",
  );
  await call(browser, () => {
    const markdown = [
      ...document.querySelectorAll(".rah-message-markdown"),
    ].find((candidate) => candidate.textContent?.includes("Markdown gate"));
    markdown
      ?.closest(".rah-collapsible-message")
      ?.querySelector(".rah-long-message-toggle")
      ?.click();
  });
  await waitFor(
    browser,
    () => {
      const markdown = [
        ...document.querySelectorAll(".rah-message-markdown"),
      ].find((candidate) => candidate.textContent?.includes("Markdown gate"));
      return (
        markdown
          ?.closest(".rah-collapsible-message")
          ?.getAttribute("data-collapsed") === "true"
      );
    },
    "collapsed long Message after expansion",
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
    for (let attempt = 0; attempt < 12; attempt += 1) {
      list.scrollTop = 0;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    }
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
    ["动态", "资料", "聊天", "提醒", "工作区", "应用"],
    "Agent detail must preserve the complete Raft tab protocol",
  );
  await clickButton(browser, { text: "关系图" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-member-graph-canvas") !== null &&
      new URL(location.href).searchParams.get("memberView") === "relationship",
    "Raft relationship graph deep link",
  );
  const relationshipNode = await call(browser, () => {
    const node = document.querySelector(".rah-member-graph-node-trigger");
    const canvas = document.querySelector(".rah-member-graph-canvas");
    if (!(node instanceof HTMLElement) || !(canvas instanceof HTMLElement))
      return null;
    const nodeBounds = node.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    return {
      canvas: {
        x: canvasBounds.left + canvasBounds.width / 2,
        y: canvasBounds.top + canvasBounds.height / 2,
      },
      node: {
        x: nodeBounds.left + nodeBounds.width / 2,
        y: nodeBounds.top + nodeBounds.height / 2,
      },
      viewBox: document
        .querySelector(".rah-member-graph-canvas svg")
        ?.getAttribute("viewBox"),
    };
  });
  assert.notEqual(
    relationshipNode,
    null,
    "relationship graph must render canonical visible members",
  );
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...relationshipNode.node,
  });
  await waitFor(
    browser,
    () =>
      document.querySelector('.rah-member-graph-preview[role="tooltip"]') !==
      null,
    "relationship node 200ms hover preview",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector('.rah-member-graph-preview[role="tooltip"]') ===
      null,
    "relationship node hover Escape close",
  );
  await browser.command("Input.dispatchMouseEvent", {
    deltaX: 0,
    deltaY: -320,
    type: "mouseWheel",
    ...relationshipNode.canvas,
  });
  await waitFor(
    browser,
    (before) =>
      document
        .querySelector(".rah-member-graph-canvas svg")
        ?.getAttribute("viewBox") !== before,
    "relationship graph wheel zoom",
    [relationshipNode.viewBox],
  );
  await call(browser, () =>
    [...document.querySelectorAll(".rah-agent-member-row")]
      .find((row) => row.querySelector("b")?.textContent === "Alice")
      ?.click(),
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-profile-pane") !== null &&
      new URL(location.href).searchParams.get("memberView") === null,
    "relationship graph returns to Agent profile",
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
          ".rah-room-sidebar .rah-direct-room-row .rah-direct-row-name",
        ),
      ].some((label) => label.textContent?.trim() === "Alice") &&
      document.querySelector(
        ".rah-direct-header-avatar .rah-agent-avatar-grid",
      ) !== null,
    "Raft-style open-or-create Agent Direct Room",
  );
  const directHeaderAvatarBefore = await call(
    browser,
    () =>
      document.querySelector(".rah-direct-header-avatar .rah-agent-avatar-grid")
        ?.innerHTML ?? "",
  );
  assert.notEqual(
    directHeaderAvatarBefore,
    "",
    "Direct Room header must expose the canonical Agent avatar",
  );
  await clickButton(browser, { ariaLabel: "打开 Alice Agent 资料" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-peek .rah-agent-activity-pane") !==
      null,
    "Direct Room header avatar opens the shared Agent inspector",
  );
  await clickButton(browser, { text: "资料" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-peek .rah-agent-profile-pane") !==
      null,
    "Agent inspector profile tab from Direct Room header",
  );
  await clickButton(browser, { text: "重启 / 重置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-reset-dialog") !== null,
    "Raft three-mode Agent reset dialog",
  );
  assert.equal(
    await call(browser, () => {
      const full = document.querySelector(
        '.rah-agent-reset-dialog input[value="full"]',
      );
      if (!(full instanceof HTMLInputElement)) return null;
      full.click();
      return full.disabled;
    }),
    false,
    "full reset is enabled only when the daemon advertises its dedicated capability",
  );
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-agent-reset-warning")
        ?.textContent?.includes("本机项目目录不会被删除") === true &&
      document
        .querySelector(".rah-agent-reset-confirm")
        ?.classList.contains("is-full") === true,
    "full reset destructive scope warning",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-reset-dialog") === null &&
      document.activeElement?.textContent?.trim() === "重启 / 重置",
    "Agent reset Escape and focus return",
  );
  await clickButton(browser, { text: "报告问题" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-issue-report-dialog") !== null,
    "Raft-shaped local Agent issue report dialog",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-issue-report-dialog") === null &&
      document.activeElement?.textContent?.trim() === "报告问题",
    "Agent issue report Escape and focus return",
  );
  await clickButton(browser, { text: "报告问题" });
  assert.equal(
    await call(browser, () => {
      const dialog = document.querySelector(".rah-agent-issue-report-dialog");
      const submit = [...(dialog?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent?.trim() === "导出到本机",
      );
      return submit?.disabled;
    }),
    true,
    "local issue export requires explicit sensitive-data consent",
  );
  await call(browser, () => {
    const dialog = document.querySelector(".rah-agent-issue-report-dialog");
    const textarea = dialog?.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "browser gate local diagnostic export");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const consent = [
      ...(dialog?.querySelectorAll('input[type="checkbox"]') ?? []),
    ].at(-1);
    if (consent instanceof HTMLInputElement) consent.click();
  });
  await clickButton(browser, { text: "导出到本机" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-agent-issue-report-success")
        ?.textContent?.includes("已导出到本机") === true,
    "local Agent issue report success state",
  );
  const issueReportPath = await waitForDownloadedIssueReport(downloadDirectory);
  const issueReport = JSON.parse(readFileSync(issueReportPath, "utf8"));
  assert.equal(issueReport.schemaVersion, "rah-agent-issue-report-v1");
  assert.equal(issueReport.disclosure.transport, "local_download");
  assert.equal(
    issueReport.issue.description,
    "browser gate local diagnostic export",
  );
  assert.equal(issueReport.logs.activityDiagnostics.included, true);
  assert.doesNotMatch(
    JSON.stringify(issueReport),
    /toolInput|recentMessages|runtimeTranscript|RAH_FAKE/u,
  );
  await clickButton(browser, { text: "完成" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-issue-report-dialog") === null &&
      document.activeElement?.textContent?.trim() === "报告问题",
    "close local Agent issue report and restore focus",
  );
  await clickButton(browser, { ariaLabel: "更换 Alice 头像" });
  await waitFor(
    browser,
    () =>
      document.querySelector('.rah-agent-avatar-picker [role="group"]') !==
      null,
    "Raft Agent avatar picker",
  );
  const originalAvatarKey = await call(browser, () =>
    document
      .querySelector('.rah-agent-avatar-picker button[aria-pressed="true"]')
      ?.getAttribute("title"),
  );
  assert.ok(originalAvatarKey, "current Agent avatar key must be discoverable");
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-peek .rah-agent-profile-pane") !==
        null &&
      document.querySelector(".rah-agent-avatar-picker") === null &&
      document.activeElement?.getAttribute("aria-label") === "更换 Alice 头像",
    "avatar picker Escape closes only the picker and restores its trigger",
  );
  await clickButton(browser, { ariaLabel: "更换 Alice 头像" });
  await waitFor(
    browser,
    () =>
      document.querySelector('.rah-agent-avatar-picker [role="group"]') !==
      null,
    "Raft Agent avatar picker after keyboard dismissal",
  );
  await browser.command("DOM.enable");
  const { root } = await browser.command("DOM.getDocument", { depth: -1 });
  const { nodeId: avatarInputNodeId } = await browser.command(
    "DOM.querySelector",
    {
      nodeId: root.nodeId,
      selector: '.rah-agent-avatar-picker input[type="file"]',
    },
  );
  assert.notEqual(avatarInputNodeId, 0, "Agent avatar file input must exist");
  await browser.command("DOM.setFileInputFiles", {
    files: [agentAvatarPngPath],
    nodeId: avatarInputNodeId,
  });
  await waitFor(
    browser,
    () => {
      const source = document
        .querySelector(
          ".rah-agent-profile-avatar-trigger .rah-profile-image-avatar",
        )
        ?.getAttribute("src");
      return (
        document.querySelector(".rah-agent-avatar-picker") === null &&
        typeof source === "string" &&
        /^\/v3\/client\/profile-images\/content\/upload_png_[a-f0-9]{40}$/u.test(
          source,
        )
      );
    },
    "authenticated Agent image upload and canonical avatar reconciliation",
  );
  await clickButton(browser, { ariaLabel: "更换 Alice 头像" });
  await waitFor(
    browser,
    () =>
      document.querySelector(
        '.rah-agent-avatar-picker .rah-agent-avatar-upload[data-selected="true"] .rah-profile-image-avatar',
      ) !== null,
    "uploaded Agent image selected state after reopening picker",
  );
  const replacementAvatarKey = originalAvatarKey === "star" ? "heart" : "star";
  await clickButton(browser, {
    ariaLabel: `选择头像 ${replacementAvatarKey}`,
  });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-avatar-picker") === null,
    "canonical Agent avatar revision save",
  );
  await clickButton(browser, { ariaLabel: "关闭 Agent 侧栏" });
  await waitFor(
    browser,
    (before) => {
      const grid = document.querySelector(
        ".rah-direct-header-avatar .rah-agent-avatar-grid",
      );
      return (
        document.querySelector(".rah-agent-peek") === null &&
        grid?.innerHTML !== before &&
        document.activeElement?.getAttribute("aria-label") ===
          "打开 Alice Agent 资料"
      );
    },
    "avatar reconciliation and focus return to Direct Room header",
    [directHeaderAvatarBefore],
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
      const header = document.querySelector(
        ".rah-direct-header-avatar .rah-agent-avatar-grid",
      )?.innerHTML;
      const message = [...document.querySelectorAll(".msg")]
        .find(
          (row) =>
            row.querySelector(".msg-head")?.textContent?.includes("Alice") ===
            true,
        )
        ?.querySelector(
          ".rah-message-avatar-trigger .rah-agent-avatar-grid",
        )?.innerHTML;
      return header !== undefined && header === message;
    }),
    true,
    "Direct Room header and Agent Message must reconcile the same avatar",
  );
  await clickButton(browser, { ariaLabel: "查看 Alice 动态" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-peek .rah-agent-activity-pane") !==
      null,
    "Agent Message avatar opens the same shared inspector",
  );
  await clickButton(browser, { ariaLabel: "关闭 Agent 侧栏" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-peek") === null,
    "shared Agent inspector close after Message avatar",
  );
  assert.equal(
    await call(browser, () => {
      const label = [
        ...document.querySelectorAll(
          ".rah-room-sidebar .rah-sidebar-channel-name",
        ),
      ].find((candidate) => candidate.textContent?.trim() === "Agent Council");
      const room = label?.closest("button");
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
  await clickButton(browser, { text: "资料" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-profile-pane") !== null,
    "Agent profile before runtime picker audit",
  );
  await clickButton(browser, { ariaLabel: "编辑运行时配置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-runtime-edit-dialog") !== null,
    "Agent runtime configuration dialog",
  );
  const runtimePickerCount = await call(
    browser,
    () =>
      [
        ...document.querySelectorAll(
          ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
        ),
      ].length,
  );
  assert.ok(
    runtimePickerCount >= 3,
    "runtime, model and effort pickers must all be interactive",
  );
  for (let index = 0; index < runtimePickerCount; index += 1) {
    const triggerLabel = await call(
      browser,
      (pickerIndex) => {
        const trigger = document.querySelectorAll(
          ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
        )[pickerIndex];
        trigger?.click();
        return trigger?.getAttribute("aria-label") ?? "";
      },
      index,
    );
    assert.notEqual(triggerLabel, "", "runtime picker needs a typed label");
    await waitFor(
      browser,
      () =>
        document.querySelector('.rah-discovery-popover[role="menu"]') !== null,
      `open ${triggerLabel}`,
    );
    await dispatchKey(browser, "Escape", 27);
    await waitFor(
      browser,
      (expectedLabel) =>
        document.querySelector('.rah-discovery-popover[role="menu"]') ===
          null &&
        document.activeElement?.getAttribute("aria-label") === expectedLabel,
      `close ${triggerLabel} and restore focus`,
      [triggerLabel],
    );
  }
  const originalRuntimeLabel = await call(browser, () => {
    const triggers = document.querySelectorAll(
      ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
    );
    const trigger = triggers[0];
    trigger?.click();
    return trigger?.getAttribute("aria-label") ?? "";
  });
  await waitFor(
    browser,
    () =>
      document.querySelector('.rah-discovery-popover[role="menu"]') !== null,
    "open runtime picker for persistence",
  );
  const alternativeRuntime = await call(browser, () => {
    const option = document.querySelector(
      '.rah-discovery-popover[role="menu"] [role="menuitemradio"][aria-checked="false"]:not(:disabled)',
    );
    const label = option?.textContent?.trim() ?? "";
    option?.click();
    return label;
  });
  assert.notEqual(
    alternativeRuntime,
    "",
    "runtime picker must expose an alternate verified option",
  );
  await waitFor(
    browser,
    (original) => {
      const triggers = document.querySelectorAll(
        ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
      );
      const current = triggers[0]?.getAttribute("aria-label");
      return (
        document.querySelector('.rah-discovery-popover[role="menu"]') ===
          null &&
        current !== null &&
        current !== original
      );
    },
    "select alternate runtime",
    [originalRuntimeLabel],
  );
  const persistedRuntimeLabel = await call(browser, () => {
    const triggers = document.querySelectorAll(
      ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
    );
    return triggers[0]?.getAttribute("aria-label") ?? "";
  });
  await clickButton(browser, { text: "保存运行时配置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-runtime-edit-dialog") === null,
    "persist alternate runtime",
  );
  await clickButton(browser, { ariaLabel: "编辑运行时配置" });
  await waitFor(
    browser,
    (expected) => {
      const triggers = document.querySelectorAll(
        ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
      );
      return (
        triggers.length >= 3 &&
        triggers[0]?.getAttribute("aria-label") === expected
      );
    },
    "runtime survives dialog reload",
    [persistedRuntimeLabel],
  );
  const originalRuntimeOption = originalRuntimeLabel
    .split("：")
    .slice(1)
    .join("：");
  assert.notEqual(originalRuntimeOption, "");
  await call(browser, () => {
    const triggers = document.querySelectorAll(
      ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
    );
    triggers[0]?.click();
  });
  await waitFor(
    browser,
    (label) =>
      [
        ...document.querySelectorAll(
          '.rah-discovery-popover[role="menu"] [role="menuitemradio"]:not(:disabled)',
        ),
      ].some((option) => option.textContent?.trim() === label),
    "original runtime remains selectable",
    [originalRuntimeOption],
  );
  await call(
    browser,
    (label) => {
      const option = [
        ...document.querySelectorAll(
          '.rah-discovery-popover[role="menu"] [role="menuitemradio"]:not(:disabled)',
        ),
      ].find((candidate) => candidate.textContent?.trim() === label);
      option?.click();
    },
    originalRuntimeOption,
  );
  await clickButton(browser, { text: "保存运行时配置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-runtime-edit-dialog") === null,
    "restore original runtime",
  );
  await clickButton(browser, { ariaLabel: "编辑运行时配置" });
  await waitFor(
    browser,
    (expected) => {
      const triggers = document.querySelectorAll(
        ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
      );
      return triggers[0]?.getAttribute("aria-label") === expected;
    },
    "restored runtime survives dialog reload",
    [originalRuntimeLabel],
  );
  const originalModelLabel = await call(browser, () => {
    const triggers = document.querySelectorAll(
      ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
    );
    const trigger = triggers[1];
    trigger?.click();
    return trigger?.getAttribute("aria-label") ?? "";
  });
  await waitFor(
    browser,
    () =>
      document.querySelector('.rah-discovery-popover[role="menu"]') !== null,
    "open model picker for persistence",
  );
  const alternativeModel = await call(browser, () => {
    const option = document.querySelector(
      '.rah-discovery-popover[role="menu"] [role="menuitemradio"][aria-checked="false"]:not(:disabled)',
    );
    const label = option?.textContent?.trim() ?? "";
    option?.click();
    return label;
  });
  assert.notEqual(
    alternativeModel,
    "",
    "model picker must expose an alternate probed model",
  );
  await waitFor(
    browser,
    (original) => {
      const triggers = document.querySelectorAll(
        ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
      );
      return (
        document.querySelector('.rah-discovery-popover[role="menu"]') ===
          null && triggers[1]?.getAttribute("aria-label") !== original
      );
    },
    "select alternate probed model",
    [originalModelLabel],
  );
  const selectedModelLabel = await call(browser, () => {
    const triggers = document.querySelectorAll(
      ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
    );
    return triggers[1]?.getAttribute("aria-label") ?? "";
  });
  const originalEffortLabel = await call(browser, () => {
    const triggers = document.querySelectorAll(
      ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
    );
    const trigger = triggers[2];
    trigger?.click();
    return trigger?.getAttribute("aria-label") ?? "";
  });
  await waitFor(
    browser,
    () =>
      document.querySelector('.rah-discovery-popover[role="menu"]') !== null,
    "open effort picker for persistence",
  );
  const alternativeEffort = await call(browser, () => {
    const option = document.querySelector(
      '.rah-discovery-popover[role="menu"] [role="menuitemradio"][aria-checked="false"]:not(:disabled)',
    );
    const label = option?.textContent?.trim() ?? "";
    option?.click();
    return label;
  });
  assert.notEqual(
    alternativeEffort,
    "",
    "effort picker must expose an alternate probed level",
  );
  await waitFor(
    browser,
    (original) => {
      const triggers = document.querySelectorAll(
        ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
      );
      return (
        document.querySelector('.rah-discovery-popover[role="menu"]') ===
          null && triggers[2]?.getAttribute("aria-label") !== original
      );
    },
    "select alternate probed effort",
    [originalEffortLabel],
  );
  const selectedEffortLabel = await call(browser, () => {
    const triggers = document.querySelectorAll(
      ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
    );
    return triggers[2]?.getAttribute("aria-label") ?? "";
  });
  await clickButton(browser, { text: "保存运行时配置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-runtime-edit-dialog") === null,
    "persist model and effort",
  );
  await clickButton(browser, { ariaLabel: "编辑运行时配置" });
  await waitFor(
    browser,
    (expectedModel, expectedEffort) => {
      const triggers = document.querySelectorAll(
        ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
      );
      return (
        triggers[1]?.getAttribute("aria-label") === expectedModel &&
        triggers[2]?.getAttribute("aria-label") === expectedEffort
      );
    },
    "model and effort survive dialog reload",
    [selectedModelLabel, selectedEffortLabel],
  );
  const originalModelOption = originalModelLabel
    .split("：")
    .slice(1)
    .join("：");
  assert.notEqual(originalModelOption, "");
  await call(browser, () => {
    const triggers = document.querySelectorAll(
      ".rah-runtime-edit-dialog .rah-runtime-picker .task-filter-trigger:not(:disabled)",
    );
    triggers[1]?.click();
  });
  await waitFor(
    browser,
    (label) =>
      [
        ...document.querySelectorAll(
          '.rah-discovery-popover[role="menu"] [role="menuitemradio"]:not(:disabled)',
        ),
      ].some((option) => option.textContent?.trim() === label),
    "original model remains selectable",
    [originalModelOption],
  );
  await call(
    browser,
    (label) => {
      const option = [
        ...document.querySelectorAll(
          '.rah-discovery-popover[role="menu"] [role="menuitemradio"]:not(:disabled)',
        ),
      ].find((candidate) => candidate.textContent?.trim() === label);
      option?.click();
    },
    originalModelOption,
  );
  await clickButton(browser, { text: "保存运行时配置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-runtime-edit-dialog") === null,
    "restore original model and effort",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-runtime-edit-dialog") === null &&
      document.activeElement?.getAttribute("aria-label") === "编辑运行时配置",
    "runtime dialog Escape close and focus return",
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
  await clickButton(browser, { text: "资料" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-profile-pane") !== null,
    "Agent profile surface",
  );
  const agentProfileRoute = await call(browser, () => ({
    agent: new URLSearchParams(location.search).get("agent"),
    agentTab: new URLSearchParams(location.search).get("agentTab"),
    surface: new URLSearchParams(location.search).get("surface"),
  }));
  assert.equal(agentProfileRoute.surface, "agents");
  assert.equal(agentProfileRoute.agentTab, "profile");
  assert.ok(agentProfileRoute.agent, "Agent route retains its stable identity");
  await reloadPage(browser);
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-profile-pane") !== null,
    "Agent identity and profile recovery after reload",
  );
  await delay(250);
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-profile-pane") !== null,
    "Stable Agent profile after reload",
  );
  assert.deepEqual(
    await call(browser, () => ({
      agent: new URLSearchParams(location.search).get("agent"),
      agentTab: new URLSearchParams(location.search).get("agentTab"),
      surface: new URLSearchParams(location.search).get("surface"),
    })),
    agentProfileRoute,
    "Agent route remains canonical after reload",
  );
  assert.equal(
    await call(browser, () =>
      [
        ...document.querySelectorAll('.rah-agent-detail-tabs [role="tab"]'),
      ].some((tab) => tab.textContent?.trim() === "MCP"),
    ),
    false,
    "Retired MCP tab is absent",
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
  await clickButton(browser, { text: "恢复 Agent" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-manage-dialog") === null,
    "Agent resume acknowledged",
  );
  await clickAgentAction(browser, "Bob Reviewer", "编辑");
  await clickButton(browser, { text: "暂停 Agent" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-manage-dialog") === null,
    "Agent pause acknowledged after resume",
  );
  await clickAgentAction(browser, "Bob Reviewer", "编辑");
  await waitFor(
    browser,
    () => document.querySelector(".rah-agent-manage-dialog") !== null,
    "paused Agent delete dialog",
  );
  assert.equal(
    await call(browser, () => {
      const button = [
        ...document.querySelectorAll(".rah-agent-manage-dialog button"),
      ].find((candidate) => candidate.textContent?.trim() === "删除 Agent");
      button?.click();
      return button !== undefined;
    }),
    true,
  );
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
  assert.equal(
    await call(browser, () => {
      const buttons = [
        document.querySelector('button[aria-label="编辑计算机名称"]'),
        document.querySelector('button[aria-label="编辑计算机描述"]'),
      ];
      return (
        buttons.length === 2 &&
        buttons.every(
          (button) => button instanceof HTMLButtonElement && !button.disabled,
        )
      );
    }),
    true,
    "Computer name and description must both expose Raft edit controls",
  );
  await call(browser, () =>
    document.querySelector('button[aria-label="编辑计算机名称"]')?.click(),
  );
  assert.equal(
    await call(
      browser,
      (value) => {
        const input = document.querySelector('input[aria-label="计算机名称"]');
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        return true;
      },
      "RAH Gate Computer",
    ),
    true,
  );
  await dispatchKey(browser, "Enter", 13);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-detail h1")?.textContent ===
        "RAH Gate Computer" &&
      document.querySelector('input[aria-label="计算机名称"]') === null,
    "Computer name Enter save through durable daemon profile",
  );
  await call(browser, () =>
    document.querySelector('button[aria-label="编辑计算机描述"]')?.click(),
  );
  assert.equal(
    await call(
      browser,
      (value) => {
        const textarea = document.querySelector(
          'textarea[aria-label="计算机描述"]',
        );
        if (!(textarea instanceof HTMLTextAreaElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.focus();
        return true;
      },
      "Isolated browser fixture Computer",
    ),
    true,
  );
  await browser.command("Input.dispatchKeyEvent", {
    code: "Enter",
    key: "Enter",
    modifiers: 4,
    nativeVirtualKeyCode: 13,
    type: "keyDown",
    windowsVirtualKeyCode: 13,
  });
  await browser.command("Input.dispatchKeyEvent", {
    code: "Enter",
    key: "Enter",
    modifiers: 4,
    nativeVirtualKeyCode: 13,
    type: "keyUp",
    windowsVirtualKeyCode: 13,
  });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-computer-detail")
        ?.textContent?.includes("Isolated browser fixture Computer") === true &&
      document.querySelector('textarea[aria-label="计算机描述"]') === null,
    "Computer description Cmd+Enter save through durable daemon profile",
  );
  assert.deepEqual(
    await call(browser, () => {
      const sidebar = document.querySelector(".rah-computer-sidebar");
      const separator = document.querySelector(
        '.rah-computer-sidebar-resizer[role="separator"]',
      );
      return {
        maximum: separator?.getAttribute("aria-valuemax"),
        minimum: separator?.getAttribute("aria-valuemin"),
        sidebarWidth: sidebar?.getBoundingClientRect().width,
        storedWidth: localStorage.getItem("rah:computer-sidebar-width"),
      };
    }),
    {
      maximum: "520",
      minimum: "240",
      sidebarWidth: 320,
      storedWidth: null,
    },
    "Computer must own Raft's independent 320 / 240..520 sidebar contract",
  );
  const computerResizeStart = await call(browser, () => {
    const rectangle = document
      .querySelector(".rah-computer-sidebar-resizer")
      ?.getBoundingClientRect();
    return rectangle
      ? {
          x: rectangle.left + rectangle.width / 2,
          y: rectangle.top + Math.min(240, rectangle.height / 2),
        }
      : null;
  });
  assert.ok(computerResizeStart);
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...computerResizeStart,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mousePressed",
    ...computerResizeStart,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    type: "mouseMoved",
    x: computerResizeStart.x + 80,
    y: computerResizeStart.y,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseReleased",
    x: computerResizeStart.x + 80,
    y: computerResizeStart.y,
  });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 400 &&
      localStorage.getItem("rah:computer-sidebar-width") === "400",
    "Computer pointer resize and exact persistence",
  );
  await call(browser, () =>
    document.querySelector(".rah-computer-sidebar-resizer")?.focus(),
  );
  await dispatchKey(browser, "Home", 36);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 240,
    "Computer keyboard minimum width",
  );
  await dispatchKey(browser, "End", 35);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 520,
    "Computer keyboard maximum width",
  );
  await dispatchKey(browser, "Home", 36);
  for (let step = 0; step < 10; step += 1) {
    await dispatchKey(browser, "ArrowRight", 39);
  }
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 320 &&
      localStorage.getItem("rah:computer-sidebar-width") === "320",
    "Computer restored Raft default width",
  );
  await call(browser, () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__rahCopiedComputerDiagnostic = value;
        },
      },
    });
  });
  const runtimeTrigger = await call(browser, () => {
    const trigger = document.querySelector(
      ".rah-computer-runtime-chips > button",
    );
    if (!(trigger instanceof HTMLButtonElement)) return null;
    const rectangle = trigger.getBoundingClientRect();
    return {
      label: trigger.getAttribute("aria-label"),
      x: rectangle.left + rectangle.width / 2,
      y: rectangle.top + rectangle.height / 2,
    };
  });
  assert.ok(
    runtimeTrigger,
    "detected Runtime must expose an inspector trigger",
  );
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: runtimeTrigger.x,
    y: runtimeTrigger.y,
  });
  await waitFor(
    browser,
    () => document.querySelector(".rah-computer-runtime-inspector") !== null,
    "Runtime inspector 200ms hover open",
  );
  assert.deepEqual(
    await call(browser, () => {
      const panel = document.querySelector(".rah-computer-runtime-inspector");
      const rectangle = panel?.getBoundingClientRect();
      return {
        fits:
          rectangle !== undefined &&
          rectangle !== null &&
          rectangle.left >= 8 &&
          rectangle.right <= innerWidth - 8,
        width: rectangle?.width,
      };
    }),
    {
      fits: true,
      width: 390,
    },
    "desktop Runtime inspector must use Raft's 390px viewport-safe panel",
  );
  assert.match(
    await call(
      browser,
      () =>
        document.querySelector(".rah-computer-runtime-inspector")
          ?.textContent ?? "",
    ),
    /本机探测[\s\S]*Runtime Profile[\s\S]*不包含 Provider 账号配额或凭据/u,
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    (label) =>
      document.querySelector(".rah-computer-runtime-inspector") === null &&
      document.activeElement?.getAttribute("aria-label") === label,
    "Runtime inspector Escape close and focus return without reopening",
    [runtimeTrigger.label],
  );
  await call(browser, () => {
    const trigger = document.querySelector(
      ".rah-computer-runtime-chips > button",
    );
    if (!(trigger instanceof HTMLButtonElement)) return;
    trigger.click();
  });
  await waitFor(
    browser,
    () => document.querySelector(".rah-computer-runtime-inspector") !== null,
    "Runtime inspector click pin",
  );
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mousePressed",
    x: 1_420,
    y: 980,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseReleased",
    x: 1_420,
    y: 980,
  });
  await waitFor(
    browser,
    () => document.querySelector(".rah-computer-runtime-inspector") === null,
    "Runtime inspector pinned outside close",
  );
  await clickButton(browser, { text: "复制诊断信息" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-computer-diagnostics")
        ?.textContent?.includes("已复制") === true,
    "Computer diagnostic copy feedback",
  );
  const copiedComputerDiagnostic = await call(
    browser,
    () => window.__rahCopiedComputerDiagnostic ?? "",
  );
  assert.doesNotMatch(
    copiedComputerDiagnostic,
    /participantId|runtimeProfileRevisionId|environment|token|secret/iu,
  );
  assert.equal(JSON.parse(copiedComputerDiagnostic).hostId.length > 0, true);
  const openedComputerAgent = await call(browser, () => {
    const button = document.querySelector(
      ".rah-computer-agent-list button.rah-entity-card",
    );
    if (!(button instanceof HTMLButtonElement)) return null;
    const name = button
      .querySelector(".rah-entity-card-name")
      ?.textContent?.trim();
    button.click();
    return name ?? null;
  });
  assert.ok(openedComputerAgent, "Computer must list canonical Agent bindings");
  await waitFor(
    browser,
    (name) =>
      document.querySelector(".rah-agent-profile-pane") !== null &&
      document
        .querySelector(".rah-agent-detail-head")
        ?.textContent?.includes(name) === true &&
      new URL(location.href).searchParams.get("surface") === "agents",
    "Computer Agent row typed profile navigation",
    [openedComputerAgent],
  );
  await clickButton(browser, { title: "计算机" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-detail h1") !== null &&
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 320,
    "Computer selection and width survive Agent navigation",
  );

  await clickButton(browser, { title: "设置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-settings-surface") !== null,
    "Settings surface",
  );
  assert.equal(
    await call(
      browser,
      () => document.querySelector(".rah-room-sidebar") === null,
    ),
    true,
    "non-Room surfaces do not retain Chat sidebar",
  );
  assert.equal(
    await call(browser, () =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "MCP 服务器",
      ),
    ),
    false,
    "Retired MCP settings are absent",
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

  await clickButton(browser, { ariaLabel: "频道排序" });
  await clickButton(browser, { text: "手动" });
  const roomOrderBeforeDrag = await sidebarRoomOrder(browser);
  assert.deepEqual(
    roomOrderBeforeDrag.slice(0, 2),
    ["Agent Council", "Design Lab"],
    "manual drag audit needs the canonical two-Room baseline",
  );
  const roomDragState = await dragSidebarRoom(
    browser,
    "Design Lab",
    "Agent Council",
  );
  assert.equal(roomDragState.draggingOpacity, "0.35");
  assert.equal(roomDragState.dropBorderWidth, "2px");
  assert.match(
    roomDragState.dropBorderColor,
    /^(?:oklch\(0 0 0\)|rgb\((?:0|17), (?:0|17), (?:0|17)\))$/u,
    "Room drop indicator must resolve to the shared black token",
  );
  assert.equal(
    roomDragState.overlayBackground,
    "rgb(254, 125, 168)",
    "Room drag overlay must resolve to the shared pink token",
  );
  await waitFor(
    browser,
    () =>
      [
        ...document.querySelectorAll(
          '.rah-room-sidebar [data-sidebar-key^="room:"] .rah-sidebar-channel-name',
        ),
      ]
        .map((node) => node.textContent?.trim())
        .slice(0, 2)
        .join("|") === "Design Lab|Agent Council",
    "pointer drag reorders Room rows without a yellow drop border",
  );
  await dragSidebarRoom(browser, "Agent Council", "Design Lab");
  await waitFor(
    browser,
    () =>
      [
        ...document.querySelectorAll(
          '.rah-room-sidebar [data-sidebar-key^="room:"] .rah-sidebar-channel-name',
        ),
      ]
        .map((node) => node.textContent?.trim())
        .slice(0, 2)
        .join("|") === "Agent Council|Design Lab",
    "pointer drag restores the original Room order",
  );

  await clickButton(browser, { ariaLabel: "频道详情与设置" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-channel-settings-drawer") !== null,
    "Room settings drawer",
  );
  await waitFor(
    browser,
    () =>
      ["静音活动", "通知所有新消息", "折叠长消息"].every((label) => {
        const input = document.querySelector(`input[aria-label="${label}"]`);
        return input instanceof HTMLInputElement && !input.disabled;
      }),
    "Room personal preference controls",
  );
  await setRoomPreferenceCheckbox(browser, "静音活动", true);
  await setRoomPreferenceCheckbox(browser, "通知所有新消息", true);
  await setRoomPreferenceCheckbox(browser, "折叠长消息", false);
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-channel-settings-drawer") === null,
    "Room settings close after preference writes",
  );
  await clickButton(browser, { ariaLabel: "频道详情与设置" });
  await waitFor(
    browser,
    () => {
      const muted = document.querySelector('input[aria-label="静音活动"]');
      const notifyAll = document.querySelector(
        'input[aria-label="通知所有新消息"]',
      );
      const collapse = document.querySelector('input[aria-label="折叠长消息"]');
      return (
        muted instanceof HTMLInputElement &&
        muted.checked &&
        notifyAll instanceof HTMLInputElement &&
        notifyAll.checked &&
        collapse instanceof HTMLInputElement &&
        !collapse.checked
      );
    },
    "persisted Room personal preferences",
  );
  await setRoomPreferenceCheckbox(browser, "静音活动", false);
  await setRoomPreferenceCheckbox(browser, "通知所有新消息", false);
  await setRoomPreferenceCheckbox(browser, "折叠长消息", true);
  await mutateRoomAgent(browser, "Alice", "加入 Room", "移出 Room");
  await mutateRoomAgent(browser, "Kimi", "加入 Room", "移出 Room");
  await mutateRoomAgent(browser, "Owner Router", "加入 Room", "移出 Room");
  await closeRoomSettings(browser, "Room settings drawer close");

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
  const ownerRouterConcurrentReply = demoRoomReply(
    "owner-router",
    "browser gate: both agents",
  );
  await waitForAnyMessage(
    browser,
    [aliceBothAgentsReply, kimiBothAgentsReply, ownerRouterConcurrentReply],
    20_000,
  );
  await delay(1_000);
  const aliceReplyCount = await messageCountByBody(
    browser,
    aliceBothAgentsReply,
  );
  const kimiReplyCount = await messageCountByBody(browser, kimiBothAgentsReply);
  const ownerRouterReplyCount = await messageCountByBody(
    browser,
    ownerRouterConcurrentReply,
  );
  assert.equal(
    aliceReplyCount + kimiReplyCount + ownerRouterReplyCount,
    1,
    "Raft-style freshness must publish exactly one concurrent Room reply",
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

  await clickButton(browser, { ariaLabel: "频道详情与设置" });
  await mutateRoomAgent(browser, "Alice", "移出 Room", "加入 Room");
  await mutateRoomAgent(browser, "Owner Router", "移出 Room", "加入 Room");
  await closeRoomSettings(browser, "Room settings drawer close after removal");
  await postMessage(browser, "browser gate: Kimi only");
  await waitForMessage(browser, "browser gate: Kimi only");
  const kimiOnlyReply = demoRoomReply("Kimi", "browser gate: Kimi only");
  await waitForMessage(browser, kimiOnlyReply, 20_000);
  assert.equal(
    await messageCountByBody(browser, kimiBothAgentsReply),
    kimiReplyCount,
    "Kimi must produce one contextual reply per received Room Message",
  );
  await delay(1_000);
  assert.equal(
    await messageCountByBody(browser, aliceBothAgentsReply),
    aliceReplyCount,
    "removed Alice must not receive the next Room Message",
  );
  assert.equal(
    await messageCountByBody(
      browser,
      demoRoomReply("Alice", "browser gate: Kimi only"),
    ),
    0,
    "removed Alice must not produce a contextual reply for the next Room Message",
  );

  await openMessageContextMenu(browser, "browser gate: Kimi only");
  await waitFor(
    browser,
    () => document.querySelector(".rah-message-context-menu") !== null,
    "Room Message selection context menu",
  );
  await clickButton(browser, { text: "选择消息" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-message-selection-toolbar")
        ?.textContent?.includes("已选择 1 条") === true &&
      document.querySelector('textarea[aria-label="消息输入框"]') === null,
    "Room Raft selection mode replaces the composer",
  );
  await clickMessageRow(browser, kimiOnlyReply);
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".rah-message-selection-toolbar")
        ?.textContent?.includes("已选择 2 条") === true,
    "Room selection row click toggles a second canonical Message",
  );
  await call(browser, () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__rahCopiedSelection = value;
        },
      },
    });
  });
  await clickButton(browser, { text: "复制 Markdown" });
  await waitFor(
    browser,
    (firstBody, secondBody) => {
      const copied = window.__rahCopiedSelection ?? "";
      return copied.includes(firstBody) && copied.includes(secondBody);
    },
    "Room selection copies canonical Markdown in timeline order",
    ["browser gate: Kimi only", kimiOnlyReply],
  );
  await clickButton(browser, { text: "Agent Council" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
        "Agent Council" &&
      document.querySelector(".rah-message-selection-toolbar") === null,
    "Room switch clears transient message selection",
  );
  await clickButton(browser, { text: "Design Lab" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Design Lab",
    "return after Room selection cleanup",
  );
  await waitForMessage(browser, "browser gate: Kimi only");
  await openMessageContextMenu(browser, "browser gate: Kimi only");
  await clickButton(browser, { text: "选择消息" });
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-message-selection-toolbar") === null &&
      document.querySelector('textarea[aria-label="消息输入框"]') !== null,
    "Room selection Escape restores the composer",
  );

  await openMessageContextMenu(browser, "browser gate: Kimi only");
  await clickButton(browser, { text: "选择消息" });
  await clickMessageRow(browser, kimiOnlyReply);
  await clickButton(browser, { text: "转发" });
  await waitFor(
    browser,
    () =>
      document.querySelector(
        '.rah-message-forward-dialog[role="dialog"][aria-modal="true"]',
      ) !== null,
    "canonical Message forward dialog",
  );
  await waitFor(
    browser,
    () =>
      [...document.querySelectorAll(".rah-message-forward-targets label")].some(
        (label) => label.textContent?.includes("Agent Council") === true,
      ),
    "same-workspace joined forward targets",
  );
  assert.equal(
    await call(browser, () => {
      const label = [
        ...document.querySelectorAll(".rah-message-forward-targets label"),
      ].find(
        (candidate) =>
          candidate.textContent?.includes("Agent Council") === true,
      );
      const input = label?.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.click();
      const note = document.querySelector(
        ".rah-message-forward-dialog textarea",
      );
      if (!(note instanceof HTMLTextAreaElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(note, "browser gate: forwarded bundle");
      note.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }),
    true,
    "forward target and note must be editable",
  );
  await clickButton(browser, { text: "转发 (1)" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-message-forward-dialog") === null &&
      document.querySelector(".rah-message-selection-toolbar") === null,
    "successful forward exits selection and closes the dialog",
  );
  await clickButton(browser, { text: "Agent Council" });
  await waitForMessage(browser, "browser gate: forwarded bundle");
  await waitFor(
    browser,
    (firstBody, secondBody) => {
      const bundle = document.querySelector(
        '.msg [data-testid="forwarded-bundle"]',
      );
      return (
        bundle?.textContent?.includes(firstBody) === true &&
        bundle.textContent.includes(secondBody) &&
        bundle.querySelectorAll("a").length === 2
      );
    },
    "server-owned forwarded bundle and source permalinks",
    ["browser gate: Kimi only", kimiOnlyReply],
  );
  assert.equal(
    await call(browser, () => {
      const link = document.querySelector(
        '.rah-forwarded-bundle a[href*="message="]',
      );
      if (!(link instanceof HTMLAnchorElement)) return false;
      link.click();
      return true;
    }),
    true,
    "forwarded source permalink must be actionable",
  );
  await waitFor(
    browser,
    (body) =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
        "Design Lab" &&
      [...document.querySelectorAll(".msg")].some(
        (message) =>
          message.textContent?.includes(body) === true &&
          message.getAttribute("data-focused") === "true",
      ),
    "forwarded source deep link re-authorizes and focuses the source Message",
    ["browser gate: Kimi only"],
  );

  const forwardedAttachmentFilename = "forwarded-browser-gate.txt";
  const forwardedAttachmentBody = "browser gate: attached source";
  const forwardedAttachmentNote = "browser gate: forwarded attachment";
  await uploadRoomAttachment(browser, forwardedAttachmentFilename);
  await postMessage(browser, forwardedAttachmentBody);
  await waitFor(
    browser,
    (body, filename) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          body,
      );
      return [
        ...(message?.querySelectorAll(".rah-file-card strong") ?? []),
      ].some((element) => element.textContent === filename);
    },
    "canonical Room Message attachment before forwarding",
    [forwardedAttachmentBody, forwardedAttachmentFilename],
  );
  const sourceForwardAttachment = await call(
    browser,
    async (filename) => {
      const roomId = new URL(window.location.href).searchParams.get("room");
      if (!roomId) return null;
      const result = await fetch("/v3/client/files/list", {
        body: JSON.stringify({ roomId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }).then((response) => response.json());
      const file = result.files?.find(
        (candidate) => candidate.filename === filename,
      );
      return file
        ? { attachmentId: file.attachmentId, roomId: file.roomId }
        : null;
    },
    forwardedAttachmentFilename,
  );
  assert.ok(sourceForwardAttachment?.attachmentId);

  await openMessageContextMenu(browser, forwardedAttachmentBody);
  await clickButton(browser, { text: "选择消息" });
  await clickButton(browser, { text: "转发" });
  await waitFor(
    browser,
    () =>
      document.querySelector(
        '.rah-message-forward-dialog[role="dialog"][aria-modal="true"]',
      ) !== null,
    "attachment Message forward dialog",
  );
  await waitFor(
    browser,
    () =>
      [...document.querySelectorAll(".rah-message-forward-targets label")].some(
        (label) => label.textContent?.includes("Agent Council") === true,
      ),
    "attachment forward target list",
  );
  assert.equal(
    await call(
      browser,
      (noteBody) => {
        const label = [
          ...document.querySelectorAll(".rah-message-forward-targets label"),
        ].find(
          (candidate) =>
            candidate.textContent?.includes("Agent Council") === true,
        );
        const input = label?.querySelector('input[type="checkbox"]');
        const note = document.querySelector(
          ".rah-message-forward-dialog textarea",
        );
        if (
          !(input instanceof HTMLInputElement) ||
          !(note instanceof HTMLTextAreaElement)
        )
          return false;
        input.click();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(note, noteBody);
        note.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      forwardedAttachmentNote,
    ),
    true,
    "attachment forward target and note must be editable",
  );
  await clickButton(browser, { text: "转发 (1)" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-message-forward-dialog") === null &&
      document.querySelector(".rah-message-selection-toolbar") === null,
    "attachment forward closes selection surfaces",
  );
  await clickButton(browser, { text: "Agent Council" });
  await waitFor(
    browser,
    (noteBody, sourceBody, filename) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          noteBody,
      );
      const bundle = message?.querySelector('[data-testid="forwarded-bundle"]');
      return (
        bundle?.textContent?.includes(sourceBody) === true &&
        [...bundle.querySelectorAll(".rah-file-card strong")].some(
          (element) => element.textContent === filename,
        )
      );
    },
    "server-projected forwarded attachment card",
    [
      forwardedAttachmentNote,
      forwardedAttachmentBody,
      forwardedAttachmentFilename,
    ],
  );
  const targetForwardAttachment = await call(
    browser,
    async (filename) => {
      const roomId = new URL(window.location.href).searchParams.get("room");
      if (!roomId) return null;
      const result = await fetch("/v3/client/files/list", {
        body: JSON.stringify({ roomId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }).then((response) => response.json());
      const file = result.files?.find(
        (candidate) => candidate.filename === filename,
      );
      return file
        ? { attachmentId: file.attachmentId, roomId: file.roomId }
        : null;
    },
    forwardedAttachmentFilename,
  );
  assert.ok(targetForwardAttachment?.attachmentId);
  assert.notEqual(
    targetForwardAttachment.attachmentId,
    sourceForwardAttachment.attachmentId,
    "forwarded attachment must expose a destination-scoped identity",
  );
  assert.notEqual(
    targetForwardAttachment.roomId,
    sourceForwardAttachment.roomId,
  );
  await captureBrowserEvidence(browser, "forwarded-attachment-desktop.png");
  assert.equal(
    await call(
      browser,
      (noteBody, filename) => {
        const message = [...document.querySelectorAll(".msg")].find(
          (candidate) =>
            candidate.querySelector(".rah-message-markdown")?.textContent ===
            noteBody,
        );
        const card = [
          ...(message?.querySelectorAll(".rah-file-card") ?? []),
        ].find(
          (candidate) =>
            candidate.querySelector("strong")?.textContent === filename,
        );
        const button = card?.querySelector(".rah-file-open");
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      },
      forwardedAttachmentNote,
      forwardedAttachmentFilename,
    ),
    true,
    "forwarded attachment preview trigger",
  );
  await waitFor(
    browser,
    (filename) =>
      document
        .querySelector(".rah-file-preview")
        ?.getAttribute("aria-label") === `预览 ${filename}` &&
      document
        .querySelector(".rah-file-preview")
        ?.textContent?.includes("RAH OS forwarded attachment browser gate") ===
        true,
    "forwarded attachment bytes are readable through the projected identity",
    [forwardedAttachmentFilename],
  );
  assert.equal(
    await call(browser, () => {
      const layer = document.querySelector(".rah-file-preview")?.parentElement;
      const bounds = layer?.getBoundingClientRect();
      return (
        layer?.parentElement === document.body &&
        bounds?.left === 0 &&
        bounds.top === 0 &&
        bounds.width === innerWidth &&
        bounds.height === innerHeight
      );
    }),
    true,
    "attachment preview backdrop covers the viewport, not only its contained message row",
  );
  assert.equal(
    await call(browser, () => {
      const download = document.querySelector(
        ".rah-file-preview header > button",
      );
      return (
        download !== null && getComputedStyle(download).borderTopWidth === "0px"
      );
    }),
    true,
    "portaled preview retains the shared button reset instead of native browser chrome",
  );
  await captureBrowserEvidence(browser, "forwarded-attachment-preview.png");
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-file-preview") === null,
    "forwarded attachment preview Escape close",
  );
  await browser.command("Page.reload", { ignoreCache: true });
  await waitFor(
    browser,
    (noteBody, filename) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          noteBody,
      );
      return [
        ...(message?.querySelectorAll(".rah-file-card strong") ?? []),
      ].some((element) => element.textContent === filename);
    },
    "forwarded attachment survives a full browser reload",
    [forwardedAttachmentNote, forwardedAttachmentFilename],
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    screenHeight: 844,
    screenWidth: 390,
    width: 390,
  });
  await waitFor(
    browser,
    (noteBody, filename) => {
      const message = [...document.querySelectorAll(".msg")].find(
        (candidate) =>
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          noteBody,
      );
      const card = [
        ...(message?.querySelectorAll(".rah-file-card") ?? []),
      ].find(
        (candidate) =>
          candidate.querySelector("strong")?.textContent === filename,
      );
      const bounds = card?.getBoundingClientRect();
      return (
        bounds !== undefined &&
        bounds.left >= 0 &&
        bounds.right <= document.documentElement.clientWidth &&
        document.documentElement.scrollWidth === 390
      );
    },
    "390px forwarded attachment card remains viewport-safe",
    [forwardedAttachmentNote, forwardedAttachmentFilename],
  );
  await captureBrowserEvidence(browser, "forwarded-attachment-mobile.png");
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 1_000,
    mobile: false,
    screenHeight: 1_000,
    screenWidth: 1_440,
    width: 1_440,
  });
  assert.equal(
    await call(
      browser,
      (noteBody) => {
        const message = [...document.querySelectorAll(".msg")].find(
          (candidate) =>
            candidate.querySelector(".rah-message-markdown")?.textContent ===
            noteBody,
        );
        const link = message?.querySelector(
          '.rah-forwarded-bundle a[href*="message="]',
        );
        if (!(link instanceof HTMLAnchorElement)) return false;
        link.click();
        return true;
      },
      forwardedAttachmentNote,
    ),
    true,
    "projected attachment bundle keeps its source permalink",
  );
  await waitFor(
    browser,
    (body) =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
        "Design Lab" &&
      [...document.querySelectorAll(".msg")].some(
        (message) =>
          message.querySelector(".rah-message-markdown")?.textContent ===
            body && message.getAttribute("data-focused") === "true",
      ),
    "projected attachment source permalink focuses the source Message",
    [forwardedAttachmentBody],
  );

  await clickButton(browser, { ariaLabel: "频道详情与设置" });
  await mutateRoomAgent(browser, "Owner Router", "加入 Room", "移出 Room");
  await closeRoomSettings(
    browser,
    "Room settings drawer close after Owner Router rejoin",
  );

  await openMessageThread(browser, "browser gate: both agents");
  const threadGeometry = await call(browser, () => {
    const panel = document.querySelector('[data-testid="thread-side-column"]');
    const resizer = document.querySelector(".rah-thread-resizer");
    const header = document.querySelector(".rah-thread-head");
    const title = document.querySelector(".rah-thread-title");
    if (!panel || !resizer || !header || !title) return null;
    return {
      headerHeight: header.getBoundingClientRect().height,
      panelWidth: panel.getBoundingClientRect().width,
      resizerWidth: resizer.getBoundingClientRect().width,
      titleFontSize: getComputedStyle(title).fontSize,
    };
  });
  assert.deepEqual(threadGeometry, {
    headerHeight: 62,
    panelWidth: 400,
    resizerWidth: 8,
    titleFontSize: "16px",
  });
  assert.equal(
    await call(browser, () => {
      const textarea = document.querySelector(
        'textarea[aria-label="Thread 回复输入框"]',
      );
      if (!(textarea instanceof HTMLTextAreaElement)) return false;
      textarea.focus();
      return true;
    }),
    true,
    "Thread composer must accept an Agent mention query",
  );
  await browser.command("Input.insertText", { text: "@" });
  await waitFor(
    browser,
    () =>
      document.querySelector(
        '#thread-composer-mentions.rah-composer-mention-menu[role="listbox"]',
      ) !== null,
    "Thread Agent mention autocomplete",
  );
  assert.deepEqual(
    await call(browser, () => {
      const rows = [
        ...document.querySelectorAll("#thread-composer-mentions .mention-row"),
      ];
      return {
        activeAgentsOnly: rows.every(
          (row) => !row.textContent?.includes("Alice"),
        ),
        count: rows.length,
      };
    }),
    { activeAgentsOnly: true, count: 2 },
    "Thread mention candidates must exclude the Agent removed from this Room",
  );
  await dispatchKey(browser, "Escape", 27);
  await call(browser, () => {
    const textarea = document.querySelector(
      'textarea[aria-label="Thread 回复输入框"]',
    );
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await call(browser, () => {
    const separator = document.querySelector(".rah-thread-resizer");
    if (!(separator instanceof HTMLElement)) return false;
    separator.focus();
    separator.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
    );
    return true;
  });
  await waitFor(
    browser,
    () =>
      document
        .querySelector('[data-testid="thread-side-column"]')
        ?.getBoundingClientRect().width === 360,
    "Thread minimum keyboard width",
  );
  for (let step = 0; step < 5; step += 1) {
    await call(browser, () => {
      document
        .querySelector(".rah-thread-resizer")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }),
        );
    });
  }
  await waitFor(
    browser,
    () =>
      document
        .querySelector('[data-testid="thread-side-column"]')
        ?.getBoundingClientRect().width === 400,
    "Thread restored Raft default width",
  );
  const dragStart = await call(browser, () => {
    const rectangle = document
      .querySelector(".rah-thread-resizer")
      ?.getBoundingClientRect();
    return rectangle
      ? { x: rectangle.left + rectangle.width / 2, y: rectangle.top + 120 }
      : null;
  });
  assert.ok(dragStart);
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: dragStart.x,
    y: dragStart.y,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mousePressed",
    x: dragStart.x,
    y: dragStart.y,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    type: "mouseMoved",
    x: dragStart.x - 40,
    y: dragStart.y,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseReleased",
    x: dragStart.x - 40,
    y: dragStart.y,
  });
  await waitFor(
    browser,
    () =>
      document
        .querySelector('[data-testid="thread-side-column"]')
        ?.getBoundingClientRect().width === 440,
    "Thread pointer drag wider",
  );
  const widerDragStart = { x: dragStart.x - 40, y: dragStart.y };
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mousePressed",
    ...widerDragStart,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    type: "mouseMoved",
    x: dragStart.x,
    y: dragStart.y,
  });
  await browser.command("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseReleased",
    x: dragStart.x,
    y: dragStart.y,
  });
  await waitFor(
    browser,
    () =>
      document
        .querySelector('[data-testid="thread-side-column"]')
        ?.getBoundingClientRect().width === 400,
    "Thread pointer drag narrower",
  );
  await clickButton(browser, { ariaLabel: "消息列操作" });
  assert.deepEqual(
    await call(browser, () =>
      [
        ...document.querySelectorAll(
          '.rah-thread-overflow-menu [role="menuitem"]',
        ),
      ].map((item) => item.textContent?.trim()),
    ),
    ["在消息列中搜索", "在频道中查看", "取消关注消息列"],
    "a provisional Raft Thread must expose root-message follow state",
  );
  await clickButton(browser, { text: "取消关注消息列" });
  await clickButton(browser, { ariaLabel: "消息列操作" });
  await waitFor(
    browser,
    () =>
      [
        ...document.querySelectorAll(
          '.rah-thread-overflow-menu [role="menuitem"]',
        ),
      ].some((item) => item.textContent?.trim() === "关注消息列"),
    "provisional Thread explicit unfollow",
  );
  await clickButton(browser, { text: "关注消息列" });
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
  await clickButton(browser, { ariaLabel: "消息列操作" });
  assert.deepEqual(
    await call(browser, () =>
      [
        ...document.querySelectorAll(
          '.rah-thread-overflow-menu [role="menuitem"]',
        ),
      ].map((item) => item.textContent?.trim()),
    ),
    ["在消息列中搜索", "在频道中查看", "取消关注消息列"],
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-thread-overflow-menu") === null,
    "Thread operation menu Escape close",
  );
  await waitFor(
    browser,
    () =>
      document.querySelector(
        '[data-testid="thread-followers-header-trigger"]',
      ) !== null,
    "Agent follower header trigger",
  );
  await clickButton(browser, {
    ariaLabel: await call(browser, () =>
      document
        .querySelector('[data-testid="thread-followers-header-trigger"]')
        ?.getAttribute("aria-label"),
    ),
  });
  const followerRemoveLabel = await call(browser, () =>
    document
      .querySelector(".rah-thread-follower-row > button")
      ?.getAttribute("aria-label"),
  );
  assert.ok(followerRemoveLabel?.startsWith("移除 "));
  await clickButton(browser, { ariaLabel: followerRemoveLabel });
  await waitFor(
    browser,
    () => document.querySelector(".rah-thread-follower-undo") !== null,
    "Agent follower removal Undo",
  );
  await clickButton(browser, { text: "撤销" });
  await waitFor(
    browser,
    (ariaLabel) =>
      document.querySelector(".rah-thread-follower-undo") === null &&
      [...document.querySelectorAll(".rah-thread-follower-row > button")].some(
        (button) => button.getAttribute("aria-label") === ariaLabel,
      ),
    "Agent follower restore",
    [followerRemoveLabel],
  );
  await clickButton(browser, { ariaLabel: followerRemoveLabel });
  await waitFor(
    browser,
    () => document.querySelector(".rah-thread-follower-undo") !== null,
    "Agent follower second removal Undo",
  );
  await delay(5_250);
  assert.equal(
    await call(
      browser,
      () => document.querySelector(".rah-thread-follower-undo") === null,
    ),
    true,
    "Agent follower Undo must expire after Raft's five-second window",
  );
  await uploadThreadAttachment(browser, "thread-browser-gate.txt");
  await clickButton(browser, { title: "回复" });
  await waitFor(
    browser,
    (filename) =>
      [...document.querySelectorAll(".thread .rah-file-card strong")].some(
        (element) => element.textContent === filename,
      ),
    "attachment-only canonical Thread reply",
    ["thread-browser-gate.txt"],
  );
  await openMessageContextMenu(
    browser,
    "browser gate: canonical Thread reply",
    {
      scope: ".thread",
    },
  );
  await waitFor(
    browser,
    () => document.querySelector(".rah-message-context-menu") !== null,
    "Thread reply permalink context menu",
  );
  const threadReplyContextItems = await call(browser, () =>
    [
      ...document.querySelectorAll(
        '.rah-message-context-menu [role="menuitem"]',
      ),
    ]
      .map((item) => item.textContent?.trim())
      .filter(Boolean),
  );
  assert.equal(threadReplyContextItems.includes("复制链接"), true);
  assert.equal(threadReplyContextItems.includes("复制 Markdown"), true);
  assert.equal(
    threadReplyContextItems.includes("转为任务"),
    false,
    "Thread replies must preserve permalink actions without Convert to Task",
  );
  assert.equal(threadReplyContextItems.includes("选择消息"), true);
  await clickButton(browser, { text: "选择消息" });
  await waitFor(
    browser,
    () =>
      document
        .querySelector(".thread .rah-message-selection-toolbar")
        ?.textContent?.includes("已选择 1 条") === true &&
      document.querySelector('textarea[aria-label="Thread 回复输入框"]') ===
        null,
    "Thread Raft selection mode replaces the composer",
  );
  await clickMessageRow(browser, "browser gate: both agents", {
    scope: ".thread",
  });
  await waitFor(
    browser,
    () => {
      const inputs = [
        ...document.querySelectorAll(
          '.thread .rah-message-selection-check input[type="checkbox"]',
        ),
      ];
      const countText = document.querySelector(
        ".thread .rah-message-selection-toolbar > strong",
      )?.textContent;
      return (
        inputs.length >= 2 &&
        inputs.every((input) => input.checked) &&
        countText === `已选择 ${String(inputs.length)} 条`
      );
    },
    "Thread root selection atomically includes loaded replies",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-message-selection-toolbar") === null &&
      document.querySelector('textarea[aria-label="Thread 回复输入框"]') !==
        null,
    "Thread selection Escape restores its composer",
  );
  await clickButton(browser, { ariaLabel: "关闭消息列" });
  await waitFor(
    browser,
    () => document.querySelector(".thread") === null,
    "Thread close",
  );
  await clickButton(browser, { text: "文件" });
  await waitFor(
    browser,
    (filename) =>
      [
        ...document.querySelectorAll(".rah-room-files .rah-file-card strong"),
      ].some((element) => element.textContent === filename),
    "Thread attachment in canonical Room Files",
    ["thread-browser-gate.txt"],
  );
  const browserRange = await call(
    browser,
    async (filename) => {
      const roomId = new URL(window.location.href).searchParams.get("room");
      if (!roomId) return { error: "room-not-selected" };
      const listing = await fetch("/v3/client/files/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId }),
      }).then((response) => response.json());
      const file = listing.files?.find(
        (candidate) => candidate.filename === filename,
      );
      if (!file) return { error: "file-not-found" };
      const response = await fetch(
        `/v3/client/files/content/${encodeURIComponent(file.attachmentId)}`,
        { headers: { range: "bytes=1-7" } },
      );
      return {
        acceptRanges: response.headers.get("accept-ranges"),
        body: [...new Uint8Array(await response.arrayBuffer())],
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
        status: response.status,
      };
    },
    "thread-browser-gate.txt",
  );
  assert.deepEqual(browserRange, {
    acceptRanges: "bytes",
    body: [...Buffer.from("AH OS T")],
    contentLength: "7",
    contentRange: "bytes 1-7/38",
    status: 206,
  });
  const fileActionLayout = await call(
    browser,
    (filename) => {
      const card = [
        ...document.querySelectorAll(".rah-room-files .rah-file-card"),
      ].find(
        (candidate) =>
          candidate.querySelector("strong")?.textContent === filename,
      );
      const source = card?.querySelector(".rah-file-source");
      const download = card?.querySelector(".rah-file-download");
      const overflow = card?.querySelector(".rah-file-overflow");
      return {
        downloadVisible:
          download instanceof HTMLElement &&
          getComputedStyle(download).display !== "none",
        overflowVisible:
          overflow instanceof HTMLElement &&
          getComputedStyle(overflow).display !== "none",
        sourceVisible:
          source instanceof HTMLElement &&
          getComputedStyle(source).display !== "none",
      };
    },
    "thread-browser-gate.txt",
  );
  assert.deepEqual(
    fileActionLayout,
    {
      downloadVisible: true,
      overflowVisible: false,
      sourceVisible: true,
    },
    "desktop Room Files must use Raft's direct jump/download actions",
  );
  await call(
    browser,
    (filename) => {
      const card = [
        ...document.querySelectorAll(".rah-room-files .rah-file-card"),
      ].find(
        (candidate) =>
          candidate.querySelector("strong")?.textContent === filename,
      );
      card?.querySelector(".rah-file-open")?.click();
    },
    "thread-browser-gate.txt",
  );
  await waitFor(
    browser,
    (filename) =>
      document
        .querySelector(".rah-file-preview")
        ?.textContent?.includes("RAH OS Thread attachment browser gate") ===
        true &&
      document
        .querySelector(".rah-file-preview")
        ?.getAttribute("aria-label") ===
        "预览 " + filename,
    "bounded text attachment preview",
    ["thread-browser-gate.txt"],
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-file-preview") === null,
    "attachment preview Escape close",
  );
  await clickButton(browser, { text: "聊天" });
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
        preview?.textContent?.includes("2 条回复") === true &&
        preview.querySelectorAll(".tp-line").length === 2 &&
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
  await reloadPage(browser);
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
  await clickButton(browser, { ariaLabel: "关闭消息列" });

  await openMessageContextMenu(browser, "browser gate: both agents");
  await clickButton(browser, { text: "转为任务" });
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".msg")].some(
        (message) =>
          message.querySelector(".rah-message-markdown")?.textContent ===
            title &&
          message
            .querySelector(".rah-message-task-link")
            ?.textContent?.includes("#1") === true &&
          message
            .querySelector(".rah-message-task-link")
            ?.textContent?.toLowerCase()
            .includes("submitted") === false,
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
          card.getAttribute("data-task-workflow-status") === "review" &&
          card.querySelector(".rah-task-state")?.textContent === "待确认" &&
          card.textContent?.includes("submitted") === false,
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
  await clickButton(browser, { ariaLabel: "关闭消息列" });
  await clickTaskButton(browser, "browser gate: both agents", "确认完成");

  await clickButton(browser, { text: "新建任务" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-task-create-dialog") !== null,
    "Task board create dialog",
  );
  await setTaskDialogContent(browser, "browser gate: board Task");
  await clickButton(browser, { text: "创建任务" });
  await waitFor(
    browser,
    (title) =>
      document.querySelector(".rah-task-create-dialog") === null &&
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.querySelector(".kcard-no")?.textContent?.includes("#2") === true,
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
            .querySelector(".rah-message-task-link")
            ?.textContent?.includes("#2") === true &&
          message
            .querySelector(".rah-message-task-link")
            ?.textContent?.toLowerCase()
            .includes("submitted") === false,
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
          card.getAttribute("data-task-workflow-status") === "review",
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
          card.getAttribute("data-task-workflow-status") === "done",
      ),
    "Task board Task Human completion",
    ["browser gate: board Task"],
  );
  await clickButton(browser, { ariaLabel: "关闭消息列" });
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 1_000,
    mobile: false,
    width: 1_440,
  });

  await clickButton(browser, { ariaLabel: "频道详情与设置" });
  await mutateRoomAgent(browser, "Alice", "加入 Room", "移出 Room");
  await closeRoomSettings(
    browser,
    "Room settings drawer close before Review gate",
  );
  // Historical Review compatibility fixture. Fresh Task UI intentionally has
  // no preset reviewer controls; retain the canonical Review execution assertions.
  await call(
    browser,
    async (roomId) => {
      const post = async (path, body) => {
        const response = await fetch(`/v3/client/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result));
        return result;
      };
      const workspace = (await post("workspaces/list", {})).workspaces[0];
      const agents = (
        await post("agents/list", { controlRoomId: workspace.controlRoomId })
      ).agents;
      const owner = agents.find((agent) => agent.handle === "Kimi");
      const reviewer = agents.find((agent) => agent.handle === "Alice");
      const head = await post("rooms/sync", {
        roomId,
        consumerId: "historical-review-fixture",
        limit: 1,
      });
      await post("tasks/create", {
        roomId,
        basedOnRoomSeq: head.latestRoomSeq,
        idempotencyKey: "historical-review-browser-fixture",
        title: "browser gate: frozen Review",
        assigneeId: owner.definition.participantId,
        reviewerIds: [reviewer.definition.participantId],
        collaboratorIds: [],
        dependencyTaskIds: [],
      });
    },
    selectedRoomId,
  );
  await waitFor(
    browser,
    (title) => {
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === title,
      );
      const evidence = card?.querySelector(".rah-task-review-evidence");
      return (
        card?.getAttribute("data-task-workflow-status") === "review" &&
        evidence === null &&
        card.textContent?.includes("submitted") === false
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
        bodies.filter((body) =>
          body.includes("Fake Worker completed the durable Task protocol"),
        ).length >= 2 &&
        bodies.some((body) =>
          body.includes("要求修改：首个冻结版本缺少独立验收证据。"),
        ) &&
        bodies.some((body) =>
          body.includes("审阅通过：提交证据与 Task 范围一致。"),
        )
      );
    },
    "rejected first submission, revised delivery, and approval in canonical Task Thread",
  );
  await clickButton(browser, { ariaLabel: "关闭消息列" });
  await clickTaskButton(browser, "browser gate: frozen Review", "确认完成");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.getAttribute("data-task-workflow-status") === "done",
      ),
    "Human completion after canonical Review",
    ["browser gate: frozen Review"],
  );
  assert.deepEqual(
    await readCanonicalTaskCompletion(browser, "browser gate: frozen Review"),
    {
      completedAt: true,
      completionEvent: true,
      state: "completed",
      workflowStatus: "done",
    },
    "Human completion must persist the canonical Task and task.completed event",
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
            .querySelector(".rah-message-task-link")
            ?.textContent?.includes("#") === true &&
          message
            .querySelector(".rah-message-task-link")
            ?.textContent?.toLowerCase()
            .includes("submitted") === false,
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
          card.getAttribute("data-task-workflow-status") === "review",
      ),
    "Fake CLI Task submission",
    ["browser gate: durable Task"],
    20_000,
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
    "Room Tasks must hide the redundant Room name exactly as Raft channel mode does",
  );
  assert.deepEqual(
    await call(browser, () => {
      const buttons = [...document.querySelectorAll(".tasks-view button")];
      const inspect = (button) => {
        const icon = button?.querySelector("svg");
        const use = icon?.querySelector("use");
        const bounds = icon?.getBoundingClientRect();
        return {
          height: bounds?.height,
          href: use?.getAttribute("href")?.split("#").at(-1),
          width: bounds?.width,
        };
      };
      const empty = document.querySelector(
        ".rah-global-kanban .rah-empty-copy",
      );
      const emptyStyle = empty ? getComputedStyle(empty) : null;
      return {
        board: inspect(buttons.find((button) => button.textContent === "看板")),
        empty: emptyStyle
          ? {
              padding: emptyStyle.padding,
              textAlign: emptyStyle.textAlign,
            }
          : null,
        list: inspect(buttons.find((button) => button.textContent === "列表")),
      };
    }),
    {
      board: { height: 14, href: "raft-icon-columns-3", width: 14 },
      empty: { padding: "20px 12px", textAlign: "left" },
      list: { height: 14, href: "raft-icon-layout-list", width: 14 },
    },
    "Room Tasks must use Raft's exact view icons, shared final size, and left-aligned empty group",
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
  await waitFor(
    browser,
    (filename) =>
      [...document.querySelectorAll(".thread .rah-file-card strong")].some(
        (element) => element.textContent === filename,
      ),
    "Agent artifact attached to canonical Task submission",
    ["browser-gate-task-evidence.txt"],
  );
  await clickButton(browser, { ariaLabel: "关闭消息列" });
  await clickTaskButton(browser, "browser gate: durable Task", "确认完成");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.getAttribute("data-task-workflow-status") === "done",
      ),
    "Human Task completion",
    ["browser gate: durable Task"],
  );
  await clickButton(browser, { text: "文件" });
  await waitFor(
    browser,
    (filename) =>
      [
        ...document.querySelectorAll(".rah-room-files .rah-file-card strong"),
      ].some((element) => element.textContent === filename),
    "Agent Task artifact in canonical Room Files",
    ["browser-gate-task-evidence.txt"],
  );
  await clickButton(browser, {
    ariaLabel: "跳转到 browser-gate-task-evidence.txt 的原消息",
  });
  await waitFor(
    browser,
    (filename, summary) =>
      [...document.querySelectorAll(".thread .rah-file-card strong")].some(
        (element) => element.textContent === filename,
      ) &&
      [...document.querySelectorAll(".thread .msg .rah-message-markdown")].some(
        (element) => element.textContent === summary,
      ),
    "Agent Task artifact jumps to its exact submission Thread Message",
    [
      "browser-gate-task-evidence.txt",
      "Fake Worker completed the durable Task protocol",
    ],
  );
  await clickButton(browser, { ariaLabel: "关闭消息列" });

  await clickButton(browser, { ariaLabel: "频道详情与设置" });
  await mutateRoomAgent(browser, "Kimi", "移出 Room", "加入 Room");
  await closeRoomSettings(
    browser,
    "Room settings drawer close before owner routing",
  );

  // The exact-message Artifact deep link intentionally returns to Chat and
  // opens its Thread. Re-establish the Room Tasks surface before using its
  // toolbar; do not let a stale earlier tab make this later gate accidental.
  await clickButton(browser, { text: "任务" });
  await expandTaskGroup(browser, "done");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.getAttribute("data-task-workflow-status") === "done" &&
          card.textContent?.includes("claimed") === false,
      ),
    "completed execution remains a stable Raft status-editing fixture",
    ["browser gate: both agents"],
  );

  const taskCardPointerTarget = await call(
    browser,
    (title) => {
      const card = [...document.querySelectorAll(".rah-global-task-card")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === title,
      );
      if (!(card instanceof HTMLElement)) return null;
      card.scrollIntoView({ block: "nearest", inline: "nearest" });
      const bounds = card.getBoundingClientRect();
      return {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      };
    },
    "browser gate: both agents",
  );
  assert.notEqual(
    taskCardPointerTarget,
    null,
    "Raft Task card pointer target must be visible",
  );
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 1,
    y: 1,
  });
  await delay(140);
  const restingTaskCardStyle = await call(
    browser,
    (title) => {
      const card = [...document.querySelectorAll(".rah-global-task-card")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === title,
      );
      if (!(card instanceof HTMLElement)) return null;
      const style = getComputedStyle(card);
      const body = card.closest(".kcol-body");
      const open = card.querySelector(".rah-global-card-open");
      const header = card.querySelector(".kcard-no");
      const titleNode = card.querySelector(".kcard-title");
      const footer = card.querySelector(".rah-global-card-footer");
      const statusButton = footer?.querySelector(".task-filter-trigger");
      const statusRoot = statusButton?.closest(".rah-task-status-picker");
      const rect = (node) =>
        node instanceof HTMLElement
          ? {
              height: node.getBoundingClientRect().height,
              width: node.getBoundingClientRect().width,
              y: node.getBoundingClientRect().y,
            }
          : null;
      return {
        bodyOverflow: body ? getComputedStyle(body).overflow : null,
        borderBottomWidth: style.borderBottomWidth,
        borderRightWidth: style.borderRightWidth,
        boxShadow: style.boxShadow,
        display: style.display,
        gap: style.gap,
        height: card.getBoundingClientRect().height,
        cardRect: rect(card),
        footerRect: rect(footer),
        headerRect: rect(header),
        openDisplay: open ? getComputedStyle(open).display : null,
        openRect: rect(open),
        statusButtonBackground:
          statusButton instanceof HTMLElement
            ? getComputedStyle(statusButton).backgroundColor
            : null,
        statusButtonRect: rect(statusButton),
        statusButtonToneOwned:
          statusButton instanceof HTMLElement &&
          [...statusButton.classList].some((name) => name.startsWith("chip-")),
        statusRootBackground:
          statusRoot instanceof HTMLElement
            ? getComputedStyle(statusRoot).backgroundColor
            : null,
        statusRootRect: rect(statusRoot),
        statusRootToneOwned:
          statusRoot instanceof HTMLElement &&
          [...statusRoot.classList].some((name) => name.startsWith("chip-")),
        titleRect: rect(titleNode),
        transform: style.transform,
        transitionDuration: style.transitionDuration,
      };
    },
    "browser gate: both agents",
  );
  assert.equal(restingTaskCardStyle?.borderBottomWidth, "2px");
  assert.equal(restingTaskCardStyle?.borderRightWidth, "2px");
  assert.equal(restingTaskCardStyle?.bodyOverflow, "visible");
  assert.equal(restingTaskCardStyle?.display, "block");
  assert.equal(restingTaskCardStyle?.gap, "normal");
  assert.equal(restingTaskCardStyle?.openDisplay, "inline-block");
  assert.equal(
    restingTaskCardStyle?.statusRootBackground,
    "rgba(0, 0, 0, 0)",
    "the unbordered status wrapper must stay transparent across the trigger's top margin",
  );
  assert.equal(restingTaskCardStyle?.statusRootToneOwned, false);
  assert.equal(restingTaskCardStyle?.statusButtonToneOwned, true);
  assert.notEqual(
    restingTaskCardStyle?.statusButtonBackground,
    restingTaskCardStyle?.statusRootBackground,
  );
  assert.equal(
    (restingTaskCardStyle?.statusButtonRect?.y ?? 0) -
      (restingTaskCardStyle?.statusRootRect?.y ?? 0),
    2,
    "Raft's mt-0.5 must remain unpainted above the bordered status trigger",
  );
  assert.ok(
    Math.abs((restingTaskCardStyle?.height ?? 0) - 105.25) <= 0.25,
    `one-line Raft Task card must keep the source-derived 105.25px border box: ${JSON.stringify(restingTaskCardStyle)}`,
  );
  assert.match(restingTaskCardStyle?.boxShadow ?? "", /2px 2px/u);
  assert.match(
    restingTaskCardStyle?.transform ?? "",
    /^(?:none|matrix\(1, 0, 0, 1, 0, 0\))$/u,
  );
  assert.equal(restingTaskCardStyle?.transitionDuration, "0.1s");
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...taskCardPointerTarget,
  });
  await delay(140);
  const hoveredTaskCardStyle = await call(
    browser,
    (title) => {
      const card = [...document.querySelectorAll(".rah-global-task-card")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === title,
      );
      if (!(card instanceof HTMLElement)) return null;
      const style = getComputedStyle(card);
      return {
        borderBottomWidth: style.borderBottomWidth,
        borderRightWidth: style.borderRightWidth,
        boxShadow: style.boxShadow,
        transform: style.transform,
      };
    },
    "browser gate: both agents",
  );
  assert.deepEqual(
    {
      borderBottomWidth: hoveredTaskCardStyle?.borderBottomWidth,
      borderRightWidth: hoveredTaskCardStyle?.borderRightWidth,
      transform: hoveredTaskCardStyle?.transform,
    },
    {
      borderBottomWidth: "2px",
      borderRightWidth: "2px",
      transform: "matrix(1, 0, 0, 1, 0, -1)",
    },
    "real pointer hover must lift the Task card without thickening its border",
  );
  assert.match(
    hoveredTaskCardStyle?.boxShadow ?? "",
    /4px 4px/u,
    "real pointer hover must expand the Task card's hard shadow",
  );
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 1,
    y: 1,
  });

  await clickButton(browser, { text: "列表" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-global-kanban.list-mode") !== null,
    "Raft Task list view",
  );
  // The layout switch can move a card underneath the stationary pointer.
  // Re-establish a non-card pointer position before asserting resting styles.
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 1,
    y: 1,
  });
  await delay(140);
  const listedTaskCardStyle = await call(
    browser,
    (title) => {
      const card = [...document.querySelectorAll(".rah-global-task-card")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === title,
      );
      if (!(card instanceof HTMLElement)) return null;
      const style = getComputedStyle(card);
      const body = card.closest(".kcol-body");
      const group = card.closest(".kcol");
      const header = group?.querySelector(".kcol-head");
      const bounds = card.getBoundingClientRect();
      const firstCardBounds = body
        ?.querySelector(".rah-global-task-card")
        ?.getBoundingClientRect();
      const headerBounds = header?.getBoundingClientRect();
      const clippingAncestors = [];
      for (
        let ancestor = card.parentElement;
        ancestor && !ancestor.classList.contains("rah-global-kanban");
        ancestor = ancestor.parentElement
      ) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (
          ancestorStyle.overflowX !== "visible" ||
          ancestorStyle.overflowY !== "visible"
        ) {
          clippingAncestors.push({
            className: ancestor.className,
            overflowX: ancestorStyle.overflowX,
            overflowY: ancestorStyle.overflowY,
          });
        }
      }
      return {
        bodyOverflow: body ? getComputedStyle(body).overflow : null,
        bodyUsesShadowHost:
          body?.classList.contains("rah-interaction-shadow-host") ?? false,
        borderBottomWidth: style.borderBottomWidth,
        borderRightWidth: style.borderRightWidth,
        boxShadow: style.boxShadow,
        clippingAncestors,
        display: style.display,
        height: bounds.height,
        headerGap:
          headerBounds === undefined || firstCardBounds === undefined
            ? null
            : firstCardBounds.top - headerBounds.bottom,
        physicalHeight: Math.round(bounds.height * devicePixelRatio),
        physicalVisualHeight: Math.round(
          (bounds.height + 2) * devicePixelRatio,
        ),
        transitionDuration: style.transitionDuration,
      };
    },
    "browser gate: both agents",
  );
  assert.deepEqual(
    {
      bodyOverflow: listedTaskCardStyle?.bodyOverflow,
      bodyUsesShadowHost: listedTaskCardStyle?.bodyUsesShadowHost,
      display: listedTaskCardStyle?.display,
    },
    {
      bodyOverflow: "visible",
      bodyUsesShadowHost: true,
      display: "block",
    },
    "Task list must retain the same unclipped Raft card structure",
  );
  assert.equal(
    listedTaskCardStyle?.headerGap,
    10,
    "Raft list groups use space-y-2.5: exactly 10px from group header to first card",
  );
  assert.deepEqual(
    listedTaskCardStyle?.clippingAncestors,
    [],
    "no list-card ancestor below the Tasks scroller may clip the hard shadow",
  );
  assert.equal(listedTaskCardStyle?.borderBottomWidth, "2px");
  assert.equal(listedTaskCardStyle?.borderRightWidth, "2px");
  assert.match(listedTaskCardStyle?.boxShadow ?? "", /2px 2px/u);
  assert.equal(listedTaskCardStyle?.transitionDuration, "0.1s");
  assert.ok(
    Math.abs(
      (listedTaskCardStyle?.height ?? 0) -
        (restingTaskCardStyle?.height ?? Number.POSITIVE_INFINITY),
    ) <= 0.5,
    "the same one-line Task must keep its content-derived height in board and list views",
  );
  assert.equal(
    listedTaskCardStyle?.physicalHeight,
    Math.round(
      (restingTaskCardStyle?.height ?? Number.POSITIVE_INFINITY) *
        (await call(browser, () => devicePixelRatio)),
    ),
    "board/list border boxes must round to the same device-pixel height",
  );
  await clickButton(browser, { text: "看板" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-global-kanban.list-mode") === null,
    "restore Raft Task board view",
  );

  const taskStatusMenu = await call(
    browser,
    (title) => {
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === title,
      );
      const trigger = card?.querySelector(".rah-task-status-picker > button");
      if (!(trigger instanceof HTMLButtonElement) || trigger.disabled)
        return false;
      trigger.click();
      return true;
    },
    "browser gate: both agents",
  );
  assert.equal(taskStatusMenu, true, "Raft Task status editor must open");
  await waitFor(
    browser,
    () => document.querySelector(".rah-discovery-popover.is-status") !== null,
    "Raft Task status menu",
  );
  assert.deepEqual(
    await call(browser, () => {
      const menu = document.querySelector(".rah-discovery-popover.is-status");
      return [...(menu?.querySelectorAll("[role=menuitemradio]") ?? [])].map(
        (option) => ({
          checked: option.getAttribute("aria-checked") === "true",
          disabled: option.hasAttribute("disabled"),
          label: option.textContent?.trim().replace("✓", ""),
        }),
      );
    }),
    [
      { checked: false, disabled: true, label: "待办" },
      { checked: false, disabled: true, label: "进行中" },
      { checked: false, disabled: true, label: "待确认" },
      { checked: true, disabled: false, label: "完成" },
      { checked: false, disabled: true, label: "已关闭" },
    ],
    "Room owner must receive Raft's five status choices in source order without fabricating lifecycle transitions",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-discovery-popover.is-status") === null,
    "Escape closes Raft Task status menu",
  );

  await reloadPage(browser);
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
  // Typed navigation deliberately restores the selected Room tab. This point
  // in the gate reloads from Tasks, so return to Chat before asserting that
  // the historical Room message is still present.
  await clickButton(browser, { text: "聊天" });
  await waitForMessage(browser, "browser gate: Kimi only", 15_000);
  await clickButton(browser, { ariaLabel: "频道详情与设置" });
  await mutateRoomAgent(browser, "Alice", "移出 Room", "加入 Room");
  await mutateRoomAgent(browser, "Owner Router", "移出 Room", "加入 Room");
  await closeRoomSettings(
    browser,
    "Room settings drawer close before unassigned Task lifecycle",
  );
  await clickButton(browser, { text: "任务" });
  await clickButton(browser, { text: "新建任务" });
  await setTaskDialogContent(browser, "browser gate: close and reopen");
  await clickButton(browser, { text: "创建任务" });
  await waitFor(
    browser,
    (title) =>
      document.querySelector(".rah-task-create-dialog") === null &&
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.getAttribute("data-task-workflow-status") === "todo",
      ),
    "unstarted Task for canonical Closed recovery",
    ["browser gate: close and reopen"],
  );
  await clickTaskButton(browser, "browser gate: close and reopen", "关闭任务");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.getAttribute("data-task-workflow-status") === "closed" &&
          card.textContent?.includes("cancelled") === false,
      ),
    "Raft Closed projection without a RAH cancellation dialog",
    ["browser gate: close and reopen"],
  );
  await clickTaskButton(
    browser,
    "browser gate: close and reopen",
    "重开为待办",
  );
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.getAttribute("data-task-workflow-status") === "todo" &&
          !card.textContent?.includes("cancelled"),
      ),
    "Task Closed to Todo recovery",
    ["browser gate: close and reopen"],
  );
  await clickTaskButton(browser, "browser gate: close and reopen", "关闭任务");
  await waitFor(
    browser,
    (title) =>
      [...document.querySelectorAll(".kcard")].some(
        (card) =>
          card.querySelector(".kcard-title")?.textContent === title &&
          card.getAttribute("data-task-workflow-status") === "closed",
      ),
    "reopened Task returns to a terminal state before Agent restoration",
    ["browser gate: close and reopen"],
  );

  await clickButton(browser, { ariaLabel: "频道详情与设置" });
  await mutateRoomAgent(browser, "Kimi", "加入 Room", "移出 Room");
  await mutateRoomAgent(browser, "Alice", "加入 Room", "移出 Room");
  await mutateRoomAgent(browser, "Owner Router", "加入 Room", "移出 Room");
  await closeRoomSettings(
    browser,
    "Room settings drawer close after restoring Task Agents",
  );
  await clickButton(browser, { title: "聊天" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".channel-title h1")?.textContent?.trim() ===
      "Design Lab",
    "return to Room after owner routing",
  );
  await clickButton(browser, { title: "计算机" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-computer-detail h1") !== null,
    "Computer before mobile transition",
  );

  await clickButton(browser, { title: "任务" });
  await waitFor(
    browser,
    () => document.querySelector('main[aria-label="全局任务"]') !== null,
    "Tasks before responsive boundary scan",
  );
  await clickButton(browser, { ariaLabel: "展开完成" });
  await waitFor(
    browser,
    () =>
      [...document.querySelectorAll(".rah-global-task-card .kcard-title")].some(
        (title) => title.textContent === "browser gate: both agents",
      ),
    "global Task data finishes loading before metadata assertions",
  );
  assert.deepEqual(
    await call(
      browser,
      (title) => {
        const meta = [...document.querySelectorAll(".rah-global-task-card")]
          .find(
            (card) => card.querySelector(".kcard-title")?.textContent === title,
          )
          ?.querySelector(".kcard-no");
        return {
          room: meta?.querySelector("b")?.textContent?.trim() ?? null,
          taskNumber: meta?.querySelector("span")?.textContent?.trim() ?? null,
        };
      },
      "browser gate: both agents",
    ),
    { room: "#Design Lab", taskNumber: "#1" },
    "global Tasks must retain the Room name exactly as Raft server-wide mode does",
  );
  for (const width of [800, 768, 767, 760, 701, 700]) {
    await browser.command("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: 598,
      mobile: width <= 767,
      screenHeight: 598,
      screenWidth: width,
      width,
    });
    await delay(80);
    const expectedMobile = width <= 767;
    assert.deepEqual(
      await call(browser, () => {
        const rail = document.querySelector(".rail");
        const railButton = document.querySelector(".rail .rail-btn");
        const navigation = document.querySelector(".rah-mobile-nav");
        const taskViewButton = document.querySelector(
          '.tasks-view button[role="radio"]',
        );
        const bounds = taskViewButton?.getBoundingClientRect();
        const hit = bounds
          ? document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            )
          : null;
        return {
          mobileLabels: navigation
            ? [...navigation.querySelectorAll("button")].map((button) =>
                button.textContent?.trim(),
              )
            : [],
          navVisible: (navigation?.getClientRects().length ?? 0) > 0,
          railButtonHeight:
            railButton instanceof HTMLElement
              ? railButton.getBoundingClientRect().height
              : 0,
          railVisible: (rail?.getClientRects().length ?? 0) > 0,
          railWidth:
            rail instanceof HTMLElement
              ? rail.getBoundingClientRect().width
              : 0,
          scrollWidth: document.documentElement.scrollWidth,
          taskControlReceivesPointer:
            taskViewButton instanceof HTMLButtonElement &&
            (hit === taskViewButton ||
              hit?.closest("button") === taskViewButton),
        };
      }),
      {
        mobileLabels: ["主页", "任务", "成员", "设置"],
        navVisible: expectedMobile,
        railButtonHeight: expectedMobile ? 0 : 36,
        railVisible: !expectedMobile,
        railWidth: expectedMobile ? 0 : 50,
        scrollWidth: width,
        taskControlReceivesPointer: true,
      },
      `${String(width)}x598 must stay in exactly one Raft navigation regime`,
    );
  }
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 900,
    mobile: false,
    screenHeight: 900,
    screenWidth: 1_440,
    width: 1_440,
  });
  await clickButton(browser, { title: "计算机" });
  await waitFor(
    browser,
    () => document.querySelector(".rah-computer-detail h1") !== null,
    "Computer restored after responsive boundary scan",
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
    { clientWidth: 390, navVisible: false, scrollWidth: 390 },
    "390x844 Computer detail must hide root navigation without horizontal overflow",
  );
  assert.deepEqual(
    await call(browser, () => ({
      backVisible:
        document.querySelector(".rah-computer-detail-back")?.getClientRects()
          .length > 0,
      detailVisible:
        document.querySelector(".rah-computer-detail")?.getClientRects()
          .length > 0,
      listVisible:
        document.querySelector(".rah-computer-sidebar")?.getClientRects()
          .length > 0,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    {
      backVisible: true,
      detailVisible: true,
      listVisible: false,
      scrollWidth: 390,
    },
    "mobile Computer must be detail-first without horizontal overflow",
  );
  const mobileRuntimeLabel = await call(
    browser,
    () =>
      document
        .querySelector(".rah-computer-runtime-chips > button")
        ?.getAttribute("aria-label") ?? null,
  );
  assert.ok(mobileRuntimeLabel);
  await clickButton(browser, { ariaLabel: mobileRuntimeLabel });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-runtime-inspector-layer") !== null,
    "mobile Runtime inspector sheet",
  );
  assert.deepEqual(
    await call(browser, () => {
      const panel = document.querySelector(
        ".rah-computer-runtime-inspector.is-mobile",
      );
      const rectangle = panel?.getBoundingClientRect();
      return {
        bottom: rectangle?.bottom,
        scrollWidth: document.documentElement.scrollWidth,
        width: rectangle?.width,
      };
    }),
    { bottom: 844, scrollWidth: 390, width: 390 },
    "mobile Runtime sheet must fill the viewport width and anchor to bottom",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-computer-runtime-inspector-layer") === null,
    "mobile Runtime sheet Escape close",
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 900,
    mobile: false,
    screenHeight: 900,
    screenWidth: 1_440,
    width: 1_440,
  });
  await clickButton(browser, { ariaLabel: "聊天" });
  await waitFor(
    browser,
    () => document.querySelector(".channel-title h1") !== null,
    "desktop return from Computer to Chat",
  );
  await clickButton(browser, { text: "任务" });
  await waitFor(
    browser,
    () => document.querySelector(".kanban") !== null,
    "desktop Room Tasks tab before header action geometry gate",
  );
  assert.deepEqual(
    await call(browser, () => {
      const action = document.querySelector(
        'button[aria-label="频道详情与设置"]',
      );
      const icon = action?.querySelector("svg");
      const actionBounds = action?.getBoundingClientRect();
      const iconBounds = icon?.getBoundingClientRect();
      return {
        actionHeight: actionBounds?.height,
        actionWidth: actionBounds?.width,
        iconHeight: iconBounds?.height,
        iconWidth: iconBounds?.width,
      };
    }),
    {
      actionHeight: 28,
      actionWidth: 28,
      iconHeight: 14,
      iconWidth: 14,
    },
    "Room Tasks settings must use Raft's 28px small icon-button protocol",
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    screenHeight: 844,
    screenWidth: 390,
    width: 390,
  });
  await waitFor(
    browser,
    () => window.innerWidth === 390,
    "mobile Room Tasks toolbar viewport",
  );
  for (const view of ["列表", "看板"]) {
    await clickButton(browser, { text: view });
    assert.deepEqual(
      await call(browser, () => {
        const toolbar = document.querySelector(".tasks-toolbar");
        const create = toolbar?.querySelector(".rah-task-create");
        const icon = create?.querySelector("svg");
        const style = create && getComputedStyle(create);
        const bounds = toolbar?.getBoundingClientRect();
        const controls = [
          ...(toolbar?.querySelectorAll(".tasks-toolbar-row > *") ?? []),
        ].map((element) => element.getBoundingClientRect());
        return {
          controlsContained:
            !!bounds &&
            controls.every(
              (rect) =>
                rect.left >= bounds.left &&
                rect.right <= bounds.right &&
                rect.top >= bounds.top &&
                rect.bottom <= bounds.bottom,
            ),
          controlsOverlap: controls.some((a, index) =>
            controls
              .slice(index + 1)
              .some(
                (b) =>
                  a.left < b.right &&
                  a.right > b.left &&
                  a.top < b.bottom &&
                  a.bottom > b.top,
              ),
          ),
          createHeight: create?.getBoundingClientRect().height,
          fontSize: style?.fontSize,
          iconHeight: icon?.getBoundingClientRect().height,
          iconWidth: icon?.getBoundingClientRect().width,
          lineHeight: style?.lineHeight,
          scrollWidth: document.documentElement.scrollWidth,
          whiteSpace: style?.whiteSpace,
        };
      }),
      {
        controlsContained: true,
        controlsOverlap: false,
        createHeight: 28,
        fontSize: "12px",
        iconHeight: 12,
        iconWidth: 12,
        lineHeight: "16px",
        scrollWidth: 390,
        whiteSpace: "nowrap",
      },
      `mobile Room Tasks ${view} must wrap whole controls without overlap`,
    );
  }
  await clickButton(browser, { text: "聊天" });
  await waitFor(
    browser,
    () => document.querySelector('textarea[aria-label="消息输入框"]') !== null,
    "desktop Room chat tab before mobile detail gate",
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    screenHeight: 844,
    screenWidth: 390,
    width: 390,
  });
  await waitFor(
    browser,
    () =>
      document.querySelector('[aria-label="返回主页"]')?.getClientRects()
        .length > 0 && document.querySelector(".rah-mobile-nav") === null,
    "mobile Room detail hides root navigation and exposes back",
  );
  assert.equal(
    await call(browser, () => {
      const textarea = document.querySelector(
        'textarea[aria-label="消息输入框"]',
      );
      if (!(textarea instanceof HTMLTextAreaElement)) return false;
      textarea.focus();
      return true;
    }),
    true,
    "mobile Room composer must accept an Agent mention query",
  );
  await browser.command("Input.insertText", { text: "@" });
  await waitFor(
    browser,
    () =>
      document.querySelector(
        '#room-composer-mentions.rah-composer-mention-menu[role="listbox"]',
      ) !== null,
    "mobile Agent mention autocomplete",
  );
  assert.equal(
    await call(browser, () => {
      const menu = document.querySelector("#room-composer-mentions");
      const rectangle = menu?.getBoundingClientRect();
      return (
        rectangle !== undefined &&
        rectangle.left >= 0 &&
        rectangle.right <= document.documentElement.clientWidth
      );
    }),
    true,
    "mobile Agent mention menu must remain inside the viewport",
  );
  await dispatchKey(browser, "Escape", 27);
  await call(browser, () => {
    const textarea = document.querySelector(
      'textarea[aria-label="消息输入框"]',
    );
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await openMessageContextMenu(browser, "browser gate: attached source");
  await clickButton(browser, { text: "选择消息" });
  await waitFor(
    browser,
    () => {
      const toolbar = document.querySelector(".rah-message-selection-toolbar");
      const bounds = toolbar?.getBoundingClientRect();
      return (
        bounds !== undefined &&
        bounds.left >= 0 &&
        bounds.right <= document.documentElement.clientWidth &&
        document.documentElement.scrollWidth === 390
      );
    },
    "390px Room selection toolbar remains viewport-safe",
  );
  await clickButton(browser, { text: "转发" });
  await waitFor(
    browser,
    () => {
      const dialog = document.querySelector(".rah-message-forward-dialog");
      const bounds = dialog?.getBoundingClientRect();
      return (
        bounds !== undefined &&
        bounds.left >= 0 &&
        bounds.right <= document.documentElement.clientWidth &&
        bounds.bottom <= document.documentElement.clientHeight
      );
    },
    "390px forward dialog remains viewport-safe",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-message-forward-dialog") === null &&
      document.querySelector(".rah-message-selection-toolbar") !== null,
    "forward dialog Escape returns to message selection",
  );
  await dispatchKey(browser, "Escape", 27);
  await waitFor(
    browser,
    () => document.querySelector(".rah-message-selection-toolbar") === null,
    "mobile Room selection Escape close",
  );
  await clickButton(browser, { ariaLabel: "返回主页" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-room-sidebar.is-open") !== null &&
      [...document.querySelectorAll(".rah-mobile-nav button")]
        .map((button) => button.textContent?.trim())
        .join("|") === "主页|任务|成员|设置",
    "mobile Raft home with four root destinations",
  );
  await clickButton(browser, { text: "成员" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-sidebar-head h1")?.textContent ===
        "成员" &&
      document.querySelector(".rah-agent-detail-panel")?.getClientRects()
        .length === 0,
    "mobile Agent list-first surface",
  );
  await clickButton(browser, { text: "关系图" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-member-graph-surface") !== null &&
      document
        .querySelector(".rah-product-shell")
        ?.classList.contains("rah-mobile-navigation-visible") === true,
    "mobile relationship graph surface",
  );
  assert.deepEqual(
    await call(browser, () => {
      const graph = document.querySelector(".rah-member-graph-surface");
      const navigation = document.querySelector(".rah-mobile-nav");
      return {
        graphWidth: graph?.getBoundingClientRect().width,
        navigationDisplay:
          navigation === null ? null : getComputedStyle(navigation).display,
      };
    }),
    { graphWidth: 390, navigationDisplay: "grid" },
    "mobile Members root keeps the Raft four-tab navigation visible",
  );
  assert.equal(
    await call(browser, () => document.documentElement.scrollWidth),
    390,
    "mobile relationship graph must not overflow",
  );
  await clickButton(browser, { ariaLabel: "返回成员列表" });
  await waitFor(
    browser,
    () =>
      document.querySelector(".rah-agent-sidebar-head")?.getClientRects()
        .length > 0 &&
      document.querySelector(".rah-mobile-nav")?.getClientRects().length > 0,
    "mobile relationship graph returns to Agent list",
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
      (document.querySelector(".rah-mobile-nav") === null ||
        document.querySelector(".rah-mobile-nav")?.getClientRects().length ===
          0),
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
      tabs: ["动态", "资料", "聊天", "提醒", "工作区", "应用"],
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
    "mobile settings",
  );
  assert.equal(
    await call(browser, () => document.documentElement.scrollWidth),
    390,
    "mobile settings must not overflow",
  );

  await browser.command("Page.navigate", {
    url: new URL("/test/room-members-contract.html", descriptor.webOrigin).href,
  });
  await waitFor(
    browser,
    () => document.querySelector("#room-members-report") !== null,
    "isolated Room members and SOS contract fixture",
  );
  await clickButton(browser, { text: "运行成员回归" });
  await waitFor(
    browser,
    () => {
      const report = document.querySelector(
        "#room-members-report",
      )?.textContent;
      if (!report) return false;
      try {
        return JSON.parse(report).result === "PASS";
      } catch {
        return false;
      }
    },
    "Room members, lifecycle, and SOS pointer/keyboard contract",
  );
  assert.equal(
    await call(browser, () => document.documentElement.scrollWidth),
    390,
    "mobile Room lifecycle fixture must not overflow",
  );

  await browser.command("Page.navigate", {
    url: new URL("/test/workspace-roots-contract.html", descriptor.webOrigin)
      .href,
  });
  await waitFor(
    browser,
    () => document.querySelector("#workspace-roots-report") !== null,
    "isolated Agent workspace root contract fixture",
  );
  await clickButton(browser, { text: "运行工作区根回归" });
  await waitFor(
    browser,
    () => {
      const report = document.querySelector(
        "#workspace-roots-report",
      )?.textContent;
      if (!report) return false;
      try {
        return JSON.parse(report).result === "PASS";
      } catch {
        return false;
      }
    },
    "Agent workspace and runtime project root pointer contract",
  );
  assert.equal(
    await call(browser, () => document.documentElement.scrollWidth),
    390,
    "mobile workspace roots fixture must not overflow",
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
      const diagnostics = await call(browser, async () => {
        const request = async (path, body) =>
          await fetch(path, {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
            method: "POST",
          }).then(async (response) => ({
            body: await response.json(),
            status: response.status,
          }));
        const workspaces = await request("/v3/client/workspaces/list", {});
        const controlRoomId = workspaces.body?.workspaces?.[0]?.controlRoomId;
        const agents = controlRoomId
          ? await request("/v3/client/agents/list", { controlRoomId })
          : undefined;
        const kimi = agents?.body?.agents?.find(
          (entry) => entry?.handle === "Kimi",
        );
        const activity = kimi?.definition?.agentDefinitionId
          ? await request("/v3/client/agents/activity/list", {
              agentDefinitionId: kimi.definition.agentDefinitionId,
              limit: 20,
            })
          : undefined;
        const roomId = new URL(location.href).searchParams.get("room");
        const tasks = roomId
          ? await request("/v3/client/tasks/list", { roomId })
          : undefined;
        return { activity, agents, tasks, workspaces };
      });
      browserState = { ...browserState, diagnostics };
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

async function reloadPage(connection) {
  try {
    await connection.command("Page.reload", { ignoreCache: true });
  } catch (error) {
    // Current Chromium can destroy the inspected execution context before the
    // Page.reload acknowledgement is delivered. The following DOM recovery
    // assertion remains authoritative; ignore only that exact navigation race.
    if (
      !(error instanceof Error) ||
      !error.message.includes("Inspected target navigated or closed")
    ) {
      throw error;
    }
  }
  await delay(50);
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

async function waitForDownloadedIssueReport(directory, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const filename = readdirSync(directory).find(
      (candidate) =>
        candidate.startsWith("rah-agent-issue-") &&
        candidate.endsWith(".json") &&
        !candidate.endsWith(".crdownload"),
    );
    if (filename !== undefined) return join(directory, filename);
    await delay(50);
  }
  throw new Error("Timed out waiting for local Agent issue report download");
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

async function assertInteractionStateProtocol(connection) {
  const points = await call(connection, () => {
    const shell = document.querySelector(".rah-product-shell");
    if (!(shell instanceof HTMLElement)) return null;
    const probe = document.createElement("aside");
    probe.dataset.interactionStateProbe = "true";
    probe.style.cssText =
      "position:fixed;inset:48px auto auto 48px;z-index:2147483647;display:flex;gap:16px;padding:12px;background:white";
    const definitions = [
      ["enabled", "sq-btn", false],
      ["disabled-btn", "btn", true],
      ["disabled-flat", "rah-interaction-flat", true],
      ["disabled-segment", "rah-interaction-segment", true],
    ];
    for (const [name, className, disabled] of definitions) {
      const button = document.createElement("button");
      button.dataset.probe = name;
      button.className = className;
      button.disabled = disabled;
      button.textContent = name;
      if (name === "enabled") button.setAttribute("aria-label", name);
      probe.append(button);
    }
    shell.append(probe);
    return Object.fromEntries(
      [...probe.querySelectorAll("button")].map((button) => {
        const bounds = button.getBoundingClientRect();
        return [
          button.dataset.probe,
          {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2,
          },
        ];
      }),
    );
  });
  assert.notEqual(points, null, "interaction state probe must mount");
  const snapshot = (name) =>
    call(
      connection,
      (probeName) => {
        const button = document.querySelector(
          `[data-interaction-state-probe] [data-probe="${probeName}"]`,
        );
        if (!(button instanceof HTMLButtonElement)) return null;
        const bounds = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          background: style.backgroundColor,
          boxShadow: style.boxShadow,
          transform: style.transform,
          translate: style.translate,
          x: bounds.x,
          y: bounds.y,
        };
      },
      name,
    );
  const normal = await snapshot("enabled");
  await connection.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...points.enabled,
  });
  await delay(180);
  const hover = await snapshot("enabled");
  await connection.command("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    clickCount: 1,
    type: "mousePressed",
    ...points.enabled,
  });
  await delay(180);
  const active = await snapshot("enabled");
  await connection.command("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    ...points.enabled,
  });
  assert.notEqual(normal, null);
  assert.notEqual(hover, null);
  assert.notEqual(active, null);
  assert.equal(hover.translate, "none");
  assert.equal(active.translate, "none");
  assert.ok(Math.abs(hover.x - normal.x) < 0.05);
  assert.ok(Math.abs(hover.y - (normal.y - 1)) < 0.05);
  assert.ok(Math.abs(active.x - (normal.x + 1)) < 0.05);
  assert.ok(Math.abs(active.y - (normal.y + 1)) < 0.05);

  for (const name of ["disabled-btn", "disabled-flat", "disabled-segment"]) {
    await connection.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    });
    const before = await snapshot(name);
    await connection.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...points[name],
    });
    await delay(180);
    const after = await snapshot(name);
    assert.deepEqual(after, before, `${name} must not respond to hover`);
  }
  await call(connection, () => {
    document.querySelector("[data-interaction-state-probe]")?.remove();
  });
}

async function setRoomPreferenceCheckbox(connection, label, checked) {
  await waitFor(
    connection,
    (ariaLabel, expected) => {
      const input = document.querySelector(`input[aria-label="${ariaLabel}"]`);
      return (
        input instanceof HTMLInputElement &&
        !input.disabled &&
        input.checked !== expected
      );
    },
    `${label} before mutation`,
    [label, checked],
  );
  assert.equal(
    await call(
      connection,
      (ariaLabel) => {
        const input = document.querySelector(
          `input[aria-label="${ariaLabel}"]`,
        );
        input?.click();
        return input instanceof HTMLInputElement;
      },
      label,
    ),
    true,
  );
  await waitFor(
    connection,
    (ariaLabel, expected) => {
      const input = document.querySelector(`input[aria-label="${ariaLabel}"]`);
      return (
        input instanceof HTMLInputElement &&
        !input.disabled &&
        input.checked === expected
      );
    },
    `${label} persisted mutation`,
    [label, checked],
  );
}

async function clickTaskButton(connection, title, text) {
  if (text === "打开讨论") {
    const opened = await call(
      connection,
      (taskTitle) => {
        const card = [...document.querySelectorAll(".kcard")].find(
          (candidate) =>
            candidate.querySelector(".kcard-title")?.textContent === taskTitle,
        );
        const button = card?.querySelector(".rah-global-card-open");
        if (!(button instanceof HTMLButtonElement) || button.disabled)
          return false;
        button.click();
        return true;
      },
      title,
    );
    assert.equal(opened, true, `Task ${title} card must open its discussion`);
    return;
  }
  const statusLabel =
    text === "确认完成"
      ? "完成"
      : text === "关闭任务"
        ? "已关闭"
        : text === "重开为待办"
          ? "待办"
          : undefined;
  if (statusLabel !== undefined) {
    await selectTaskStatus(connection, title, statusLabel);
    return;
  }
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

async function readCanonicalTaskCompletion(connection, title) {
  return call(
    connection,
    async (taskTitle) => {
      const roomId = new URL(window.location.href).searchParams.get("room");
      if (!roomId) throw new Error("Task completion check has no active Room");
      const taskResponse = await fetch("/v3/client/tasks/list", {
        body: JSON.stringify({ roomId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!taskResponse.ok)
        throw new Error(`Task list failed with ${taskResponse.status}`);
      const taskPayload = await taskResponse.json();
      const task = taskPayload.tasks?.find(
        (candidate) => candidate.title === taskTitle,
      );
      if (!task) throw new Error(`Task ${taskTitle} is absent from task.list`);

      let afterSeq = 0;
      let completionEvent = false;
      for (let page = 0; page < 50; page += 1) {
        const syncResponse = await fetch("/v3/client/rooms/sync", {
          body: JSON.stringify({
            afterSeq,
            consumerId: "browser-gate-task-completion",
            limit: 500,
            roomId,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (!syncResponse.ok)
          throw new Error(`Room sync failed with ${syncResponse.status}`);
        const sync = await syncResponse.json();
        completionEvent ||= sync.events?.some(
          (event) =>
            event.type === "task.completed" &&
            event.aggregateId === task.taskId,
        );
        if (completionEvent || sync.cursorAfter >= sync.latestRoomSeq) break;
        if (!(sync.cursorAfter > afterSeq))
          throw new Error("Room sync cursor did not advance");
        afterSeq = sync.cursorAfter;
      }
      return {
        completedAt: typeof task.completedAt === "string",
        completionEvent,
        state: task.state,
        workflowStatus: task.workflowStatus,
      };
    },
    title,
  );
}

async function selectTaskStatus(connection, title, label) {
  await waitFor(
    connection,
    (taskTitle) => {
      if (document.querySelector(".rah-discovery-popover.is-status") !== null)
        return true;
      const card = [...document.querySelectorAll(".kcard")].find(
        (candidate) =>
          candidate.querySelector(".kcard-title")?.textContent === taskTitle,
      );
      const trigger = card?.querySelector(".rah-task-status-picker > button");
      if (!(trigger instanceof HTMLButtonElement) || trigger.disabled)
        return false;
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      return false;
    },
    `Task ${title} status editor`,
    [title],
  );
  await waitFor(
    connection,
    (optionLabel) =>
      [
        ...document.querySelectorAll(
          ".rah-discovery-popover.is-status [role=menuitemradio]",
        ),
      ].some(
        (option) =>
          !option.hasAttribute("disabled") &&
          option.textContent?.trim().replace("✓", "") === optionLabel,
      ),
    `Task ${title} Raft status option ${label}`,
    [label],
  );
  const changed = await call(
    connection,
    (optionLabel) => {
      const option = [
        ...document.querySelectorAll(
          ".rah-discovery-popover.is-status [role=menuitemradio]",
        ),
      ].find(
        (candidate) =>
          candidate.textContent?.trim().replace("✓", "") === optionLabel,
      );
      if (!(option instanceof HTMLButtonElement) || option.disabled)
        return false;
      option.click();
      return true;
    },
    label,
  );
  assert.equal(changed, true, `Task ${title} must select ${label}`);
  const targetGroup =
    label === "待办"
      ? "todo"
      : label === "进行中"
        ? "in-progress"
        : label === "待确认"
          ? "review"
          : label === "完成"
            ? "done"
            : "closed";
  await expandTaskGroup(connection, targetGroup);
}

async function expandTaskGroup(connection, group) {
  await waitFor(
    connection,
    (taskGroup) => {
      const trigger = document.querySelector(
        `[data-task-group="${taskGroup}"] > .kcol-head`,
      );
      if (!(trigger instanceof HTMLButtonElement)) return false;
      if (trigger.getAttribute("aria-expanded") === "false") {
        trigger.click();
        return false;
      }
      return true;
    },
    `expanded Raft Task group ${group}`,
    [group],
  );
}

async function clickTaskButtonWithPointer(connection, title, text) {
  if (["确认完成", "关闭任务", "重开为待办"].includes(text)) {
    await clickTaskButton(connection, title, text);
    return;
  }
  assert.equal(
    await call(
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
        if (!(button instanceof HTMLButtonElement)) return false;
        button.scrollIntoView({ block: "center", inline: "center" });
        return true;
      },
      title,
      text,
    ),
    true,
    `Task ${title} button ${text} must be scrollable into view`,
  );
  await delay(50);
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
  const positioned = await call(
    connection,
    (messageBody, selector) => {
      const message = [...document.querySelectorAll(`${selector} .msg`)].find(
        (candidate) =>
          candidate
            .querySelector(".rah-message-markdown")
            ?.textContent?.trim() === messageBody.trim(),
      );
      if (message === undefined) return false;
      message.scrollIntoView({ block: "center", inline: "nearest" });
      return true;
    },
    body,
    scope,
  );
  assert.equal(positioned, true, `Message ${body} must be loaded`);
  await waitFor(
    connection,
    (messageBody, selector) => {
      const message = [...document.querySelectorAll(`${selector} .msg`)].find(
        (candidate) =>
          candidate
            .querySelector(".rah-message-markdown")
            ?.textContent?.trim() === messageBody.trim(),
      );
      const scroller = message?.closest(".messages");
      if (message === undefined || scroller === null) return false;
      const bounds = message.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
    },
    `Message ${body} enters the visible virtual range`,
    [body, scope],
  );
  const target = await call(
    connection,
    (messageBody, selector) => {
      const message = [...document.querySelectorAll(`${selector} .msg`)].find(
        (candidate) =>
          candidate
            .querySelector(".rah-message-markdown")
            ?.textContent?.trim() === messageBody.trim(),
      );
      const content = message?.querySelector(".rah-message-markdown");
      const scroller = message?.closest(".messages");
      if (
        !(message instanceof HTMLElement) ||
        !(content instanceof HTMLElement) ||
        !(scroller instanceof HTMLElement)
      )
        return null;
      const viewport = scroller.getBoundingClientRect();
      for (const bounds of [
        content.getBoundingClientRect(),
        message.getBoundingClientRect(),
      ]) {
        const left = Math.max(bounds.left, viewport.left, 0);
        const right = Math.min(
          bounds.right,
          viewport.right,
          document.documentElement.clientWidth,
        );
        const top = Math.max(bounds.top, viewport.top, 0);
        const bottom = Math.min(
          bounds.bottom,
          viewport.bottom,
          document.documentElement.clientHeight,
        );
        if (right <= left || bottom <= top) continue;
        for (const yRatio of [0.5, 0.25, 0.75]) {
          for (const xRatio of [0.5, 0.2, 0.8]) {
            const x = left + (right - left) * xRatio;
            const y = top + (bottom - top) * yRatio;
            const hit = document.elementFromPoint(x, y);
            if (
              hit instanceof Element &&
              message.contains(hit) &&
              hit.closest("a, button, input, label") === null
            )
              return {
                hitTarget: true,
                targetClass: hit.getAttribute("class") ?? "",
                x,
                y,
              };
          }
        }
      }
      return null;
    },
    body,
    scope,
  );
  assert.ok(target, `Message ${body} must expose a pointer target`);
  assert.equal(target.hitTarget, true);
  await connection.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.x,
    y: target.y,
  });
  await connection.command("Input.dispatchMouseEvent", {
    button: "right",
    clickCount: 1,
    type: "mousePressed",
    x: target.x,
    y: target.y,
  });
  await connection.command("Input.dispatchMouseEvent", {
    button: "right",
    clickCount: 1,
    type: "mouseReleased",
    x: target.x,
    y: target.y,
  });
  await waitFor(
    connection,
    () => document.querySelector('[role="menu"]') !== null,
    `Message ${body} context menu opens`,
  );
}

async function clickMessageRow(
  connection,
  body,
  { scope = ".chan-pane" } = {},
) {
  const target = await call(
    connection,
    (messageBody, selector) => {
      const message = [...document.querySelectorAll(`${selector} .msg`)].find(
        (candidate) =>
          candidate.querySelector(".rah-message-markdown")?.textContent ===
          messageBody,
      );
      message?.scrollIntoView({ block: "center", inline: "nearest" });
      const content = message?.querySelector(".rah-message-markdown");
      if (
        !(message instanceof HTMLElement) ||
        !(content instanceof HTMLElement)
      )
        return null;
      for (const bounds of [
        content.getBoundingClientRect(),
        message.getBoundingClientRect(),
      ]) {
        for (const yRatio of [0.25, 0.5, 0.75]) {
          for (const xRatio of [0.1, 0.5, 0.9]) {
            const x = bounds.left + bounds.width * xRatio;
            const y = bounds.top + bounds.height * yRatio;
            const hit = document.elementFromPoint(x, y);
            if (
              hit instanceof Element &&
              message.contains(hit) &&
              hit.closest("a, button, input, label") === null
            )
              return { hitTarget: true, x, y };
          }
        }
      }
      return null;
    },
    body,
    scope,
  );
  assert.ok(target, `Message ${body} must expose a pointer target`);
  assert.equal(target.hitTarget, true);
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

async function setTaskDialogContent(connection, title) {
  assert.equal(
    await call(
      connection,
      (nextTitle) => {
        const dialog = document.querySelector(".rah-task-create-dialog");
        const input = dialog?.querySelector("input");
        if (!(input instanceof HTMLInputElement)) return false;
        const inputSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        inputSetter?.call(input, nextTitle);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      title,
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

async function mutateRoomAgent(connection, handle, action) {
  if (
    await call(
      connection,
      () =>
        document.querySelector('[data-room-members-view="settings"]') !== null,
    )
  ) {
    await clickButton(connection, { ariaLabel: "管理成员" });
  }
  await waitFor(
    connection,
    () => document.querySelector('[data-room-members-view="members"]') !== null,
    "Room member page",
  );
  const adding = action === "加入 Room";
  if (adding) {
    await clickButton(connection, { ariaLabel: "添加成员" });
    await clickButton(connection, { ariaLabel: `选择 ${handle}` });
    await clickButton(connection, { text: "添加所选（1）" });
  } else {
    await clickButton(connection, { ariaLabel: `移出 ${handle}` });
  }
  await waitFor(
    connection,
    (agentHandle, shouldExist) =>
      document.querySelector('[data-room-members-view="members"]') !== null &&
      [...document.querySelectorAll(".rah-member-row")].some(
        (row) => row.querySelector("b")?.textContent === agentHandle,
      ) === shouldExist,
    `${handle} membership mutation`,
    [handle, adding],
  );
}

async function closeRoomSettings(connection, description) {
  const view = await call(connection, () =>
    document
      .querySelector(".rah-channel-settings-drawer")
      ?.getAttribute("data-room-members-view"),
  );
  if (view !== "settings") {
    await dispatchKey(connection, "Escape", 27);
    await waitFor(
      connection,
      () =>
        document
          .querySelector(".rah-channel-settings-drawer")
          ?.getAttribute("data-room-members-view") === "settings",
      `${description} back to settings`,
    );
  }
  await dispatchKey(connection, "Escape", 27);
  await waitFor(
    connection,
    () => document.querySelector(".rah-channel-settings-drawer") === null,
    description,
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

async function uploadRoomAttachment(connection, filename) {
  const selected = await call(
    connection,
    (name) => {
      const input = document.querySelector(
        'form.composer input[aria-label="选择附件"]',
      );
      if (!(input instanceof HTMLInputElement)) return false;
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["RAH OS forwarded attachment browser gate\n"], name, {
          type: "text/plain",
        }),
      );
      Object.defineProperty(input, "files", {
        configurable: true,
        value: transfer.files,
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    filename,
  );
  assert.equal(selected, true);
  await waitFor(
    connection,
    (name) =>
      [...document.querySelectorAll("form.composer .rah-file-draft")].some(
        (row) =>
          row.querySelector("span")?.textContent === name &&
          row.querySelector("small")?.textContent === "已上传",
      ),
    `Room attachment upload ${filename}`,
    [filename],
  );
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

async function uploadThreadAttachment(connection, filename) {
  const selected = await call(
    connection,
    (name) => {
      const input = document.querySelector(
        '.thread input[aria-label="选择附件"]',
      );
      if (!(input instanceof HTMLInputElement)) return false;
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["RAH OS Thread attachment browser gate\n"], name, {
          type: "text/plain",
        }),
      );
      Object.defineProperty(input, "files", {
        configurable: true,
        value: transfer.files,
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    filename,
  );
  assert.equal(selected, true);
  await waitFor(
    connection,
    (name) =>
      [...document.querySelectorAll(".thread .rah-file-draft")].some(
        (row) =>
          row.querySelector("span")?.textContent === name &&
          row.querySelector("small")?.textContent === "已上传",
      ),
    `Thread attachment upload ${filename}`,
    [filename],
  );
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

async function waitForAnyMessage(connection, bodies, timeoutMs = 10_000) {
  return waitFor(
    connection,
    (expectedBodies) =>
      [...document.querySelectorAll(".msg .rah-message-markdown")].some(
        (element) => expectedBodies.includes(element.textContent ?? ""),
      ),
    `one Message from ${bodies.join(" | ")}`,
    [bodies],
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

async function messageCountByBody(connection, body) {
  return call(
    connection,
    (expectedBody) =>
      [...document.querySelectorAll(".msg .rah-message-markdown")].filter(
        (element) => element.textContent === expectedBody,
      ).length,
    body,
  );
}

async function sidebarRoomOrder(connection) {
  return call(connection, () =>
    [
      ...document.querySelectorAll(
        '.rah-room-sidebar [data-sidebar-key^="room:"] .rah-sidebar-channel-name',
      ),
    ].map((node) => node.textContent?.trim() ?? ""),
  );
}

async function dragSidebarRoom(connection, sourceName, targetName) {
  const points = await call(
    connection,
    (sourceLabel, targetLabel) => {
      const rows = [
        ...document.querySelectorAll(
          '.rah-room-sidebar [data-sidebar-key^="room:"]',
        ),
      ];
      const find = (label) =>
        rows.find(
          (row) =>
            row.querySelector(".rah-sidebar-channel-name")?.textContent ===
            label,
        );
      const source = find(sourceLabel)?.getBoundingClientRect();
      const target = find(targetLabel)?.getBoundingClientRect();
      if (!source || !target) return null;
      return {
        source: {
          x: source.left + source.width / 2,
          y: source.top + source.height / 2,
        },
        target: {
          x: target.left + target.width / 2,
          y: target.top + target.height / 4,
        },
      };
    },
    sourceName,
    targetName,
  );
  assert.notEqual(points, null, `Room drag ${sourceName} -> ${targetName}`);
  await connection.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 1,
    y: 1,
  });
  await delay(100);
  await connection.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: points.source.x,
    y: points.source.y,
  });
  await delay(100);
  await connection.command("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    clickCount: 1,
    type: "mousePressed",
    x: points.source.x,
    y: points.source.y,
  });
  await delay(60);
  await connection.command("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    type: "mouseMoved",
    x: points.source.x + (points.target.x - points.source.x) * 0.15,
    y: points.source.y + (points.target.y - points.source.y) * 0.15,
  });
  await waitFor(
    connection,
    () => document.querySelector(".rah-sidebar-sortable.is-dragging") !== null,
    `Room drag activates ${sourceName} -> ${targetName}`,
  );
  for (const ratio of [0.4, 0.7, 1]) {
    await connection.command("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      type: "mouseMoved",
      x: points.source.x + (points.target.x - points.source.x) * ratio,
      y: points.source.y + (points.target.y - points.source.y) * ratio,
    });
    await delay(30);
  }
  const dragState = await call(connection, () => {
    const source = document.querySelector(".rah-sidebar-sortable.is-dragging");
    const target = document.querySelector(".rah-sidebar-sortable.is-over");
    const overlay = document.querySelector(".rah-sidebar-drag-preview");
    return {
      draggingOpacity:
        source instanceof HTMLElement ? getComputedStyle(source).opacity : "",
      dropBorderColor:
        target instanceof HTMLElement
          ? getComputedStyle(target, "::after").borderBottomColor
          : "",
      dropBorderWidth:
        target instanceof HTMLElement
          ? getComputedStyle(target, "::after").borderBottomWidth
          : "",
      overlayBackground:
        overlay instanceof HTMLElement
          ? getComputedStyle(overlay).backgroundColor
          : "",
    };
  });
  await connection.command("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    x: points.target.x,
    y: points.target.y,
  });
  await waitFor(
    connection,
    () =>
      document.querySelector(".rah-sidebar-sortable.is-dragging") === null &&
      document.querySelector(".rah-sidebar-drag-preview") === null,
    `Room drag settles ${sourceName} -> ${targetName}`,
  );
  await delay(100);
  return dragState;
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

async function captureBrowserEvidence(connection, filename) {
  const directory = process.env.RAH_BROWSER_EVIDENCE_DIRECTORY;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  const { data } = await connection.command("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(join(directory, filename), Buffer.from(data, "base64"));
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
