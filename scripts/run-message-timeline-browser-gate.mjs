import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "rah-os-message-timeline-gate-"),
);
const port = await availablePort();
const origin = `http://127.0.0.1:${String(port)}`;
let browser;
let server;
let serverOutput = "";

try {
  server = spawn(
    "npm",
    ["run", "dev", "--workspace=@rah-os/web", "--", "--host", "127.0.0.1"],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, RAH_WEB_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      serverOutput += chunk;
    });
  }
  await waitForHttp(`${origin}/test/message-timeline.html`, server);

  browser = await chromium.launch({
    executablePath: await findChromeExecutable(),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { height: 1_000, width: 1_440 },
  });
  const browserErrors = [];
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      browserErrors.push(
        location.url ? `${message.text()} (${location.url})` : message.text(),
      );
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });
  page.on("pageerror", (error) =>
    browserErrors.push(error.stack ?? error.message),
  );
  await page.goto(`${origin}/test/message-timeline.html`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".messages") instanceof HTMLElement &&
      document.querySelectorAll(".messages .msg").length > 0,
  );

  const initial = await page.evaluate(() => {
    const scroller = document.querySelector(".messages");
    if (!(scroller instanceof HTMLElement)) return null;
    const domRows = scroller.querySelectorAll(".msg").length;
    const authoredTotal = scroller
      .querySelector("[data-message-timeline-total-count]")
      ?.getAttribute("data-message-timeline-total-count");
    return {
      domRows,
      scrollHeight: scroller.scrollHeight,
      totalCount: Number(authoredTotal ?? domRows),
    };
  });
  assert.notEqual(initial, null);
  assert.equal(initial.totalCount, 10_000);
  assert.ok(
    initial.scrollHeight > 300_000,
    "the full logical history must remain scrollable",
  );
  assert.ok(
    initial.domRows <= 80,
    `10,000 logical Messages must keep a bounded DOM, got ${String(initial.domRows)} rows`,
  );

  await page.evaluate(() => {
    const scroller = document.querySelector(".messages");
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
  });
  await page.waitForFunction(() => {
    const scroller = document.querySelector(".messages");
    if (!(scroller instanceof HTMLElement)) return false;
    const scrollerRect = scroller.getBoundingClientRect();
    return [...scroller.querySelectorAll(".msg")].some((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom;
    });
  });
  const anchorBefore = await firstVisibleMessage(page);
  assert.notEqual(anchorBefore, null);
  await page.locator(".rah-message-history-trigger").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-message-timeline-total-count]")
        ?.getAttribute("data-message-timeline-total-count") === "10050",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.waitForFunction(
    ({ messageId, offset }) => {
      const scroller = document.querySelector(".messages");
      const row = scroller?.querySelector(
        `[data-message-id="${CSS.escape(messageId)}"]`,
      );
      return (
        scroller instanceof HTMLElement &&
        row instanceof HTMLElement &&
        Math.abs(
          row.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            offset,
        ) <= 2
      );
    },
    anchorBefore,
    { timeout: 5_000 },
  );
  const anchorAfter = await messagePosition(page, anchorBefore.messageId);
  assert.notEqual(anchorAfter, null, "the prepend anchor must stay rendered");
  assert.ok(
    Math.abs(anchorAfter.offset - anchorBefore.offset) <= 2,
    `prepending 50 Messages moved the visible anchor by ${String(anchorAfter.offset - anchorBefore.offset)}px`,
  );
  assert.ok(
    anchorAfter.domRows <= 80,
    `prepended history must keep the DOM bounded, got ${String(anchorAfter.domRows)} rows`,
  );
  assert.deepEqual(
    { browserErrors, failedResponses },
    { browserErrors: [], failedResponses: [] },
  );
  await page.goto(`${origin}/test/message-markdown-stability.html`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "开始回归", exact: true }).click();
  await page.waitForFunction(() => {
    const status = document.querySelector('[role="status"]')?.textContent;
    return status?.includes("PASS") || status?.includes("FAIL");
  });
  const markdown = JSON.parse(await page.getByRole("status").textContent());
  assert.equal(markdown.result, "PASS", JSON.stringify(markdown));
  assert.equal(markdown.refreshes, 20);
  assert.deepEqual(markdown.failures, []);
  const restStyles = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      assertElement(element, selector);
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
      };
    };
    function assertElement(element, selector) {
      if (!(element instanceof HTMLElement))
        throw new Error(`missing rich reference: ${selector}`);
    }
    return {
      agent: read(".rah-rich-agent-reference"),
      room: read(".rah-rich-room-reference"),
      task: read(".rah-rich-task-reference"),
    };
  });
  assert.equal(restStyles.agent.fontSize, "14px");
  assert.equal(restStyles.task.fontSize, "12.25px");
  assert.equal(restStyles.task.borderRadius, "0px");
  await page.locator(".rah-rich-agent-reference").first().hover();
  const agentHoverColor = await page
    .locator(".rah-rich-agent-reference")
    .first()
    .evaluate((element) => getComputedStyle(element).color);
  const pink = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--pink)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  assert.equal(agentHoverColor, pink);
  const resolvedBackground = (value) =>
    page.evaluate((background) => {
      const probe = document.createElement("span");
      probe.style.background = background;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    }, value);
  const yellow = await resolvedBackground("var(--yellow)");
  const pink60 = await resolvedBackground(
    "color-mix(in srgb, var(--pink) 60%, transparent)",
  );
  const cyan60 = await resolvedBackground(
    "color-mix(in srgb, var(--cyan) 60%, transparent)",
  );
  for (const [selector, expected] of [
    [".rah-rich-task-reference", yellow],
    [".rah-rich-room-reference", pink60],
    [".rah-rich-thread-reference", cyan60],
    [".rah-rich-computer-reference", cyan60],
    [".rah-rich-message-reference", yellow],
  ]) {
    await page.locator(selector).first().hover();
    const actual = await page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.equal(actual, expected, `${selector} hover background`);
  }
  assert.deepEqual(
    { browserErrors, failedResponses },
    { browserErrors: [], failedResponses: [] },
  );
  console.log(
    JSON.stringify({
      anchorDelta: anchorAfter.offset - anchorBefore.offset,
      browser: await findChromeExecutable(),
      domRows: anchorAfter.domRows,
      logicalMessages: 10_050,
      markdown,
      viewport: "1440x1000",
    }),
  );
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

async function firstVisibleMessage(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector(".messages");
    if (!(scroller instanceof HTMLElement)) return null;
    const scrollerRect = scroller.getBoundingClientRect();
    for (const row of scroller.querySelectorAll(".msg")) {
      if (!(row instanceof HTMLElement)) continue;
      const rect = row.getBoundingClientRect();
      if (rect.bottom <= scrollerRect.top || rect.top >= scrollerRect.bottom) {
        continue;
      }
      return {
        messageId: row.dataset.messageId ?? "",
        offset: rect.top - scrollerRect.top,
      };
    }
    return null;
  });
}

async function messagePosition(page, messageId) {
  return page.evaluate((targetMessageId) => {
    const scroller = document.querySelector(".messages");
    const row = scroller?.querySelector(
      `[data-message-id="${CSS.escape(targetMessageId)}"]`,
    );
    if (!(scroller instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      return null;
    }
    return {
      domRows: scroller.querySelectorAll(".msg").length,
      offset:
        row.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    };
  }, messageId);
}

async function waitForHttp(url, processHandle, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Vite exited before startup:\n${serverOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite has not bound yet.
    }
    if (Date.now() >= deadline) {
      throw new Error(`Vite startup timed out:\n${serverOutput}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const value =
    typeof address === "object" && address !== null ? address.port : undefined;
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  if (value === undefined) throw new Error("failed to allocate a port");
  return value;
}
