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
  // Reading gestures must release prepend correction, even during measurement.
  const scrollArea = page.locator(".messages");
  await scrollArea.hover();
  const restoredTop = await scrollArea.evaluate((e) => e.scrollTop);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(450);
  assert.ok(
    (await scrollArea.evaluate((e) => e.scrollTop)) > restoredTop + 100,
    "history prepend must not pull a user's downward scroll back to its anchor",
  );
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(1500);
  assert.ok(
    Math.abs((await scrollArea.evaluate((e) => e.scrollTop)) - restoredTop) <
      80,
    "history remains freely scrollable in both directions after settling",
  );
  assert.deepEqual(
    { browserErrors, failedResponses },
    { browserErrors: [], failedResponses: [] },
  );
  const touchPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const touchSession = await touchPage.context().newCDPSession(touchPage);
  for (const kind of ["channel", "direct", "thread"]) {
    await touchPage.goto(`${origin}/test/message-timeline.html?kind=${kind}`, {
      waitUntil: "networkidle",
    });
    const scroll = touchPage.locator(".messages");
    await scroll.evaluate((e) => {
      e.scrollTop = 0;
    });
    await touchPage.waitForTimeout(150);
    const touchAnchor = await firstVisibleMessage(touchPage);
    await touchPage.locator(".rah-message-history-trigger").click();
    if (kind === "thread")
      await touchPage.waitForFunction(
        () => document.querySelectorAll(".messages .msg").length === 201,
        undefined,
        { timeout: 5000 },
      );
    else
      await touchPage.waitForFunction(
        ({ messageId, offset }) => {
          const scroller = document.querySelector(".messages");
          const row = scroller?.querySelector(
            `[data-message-id="${CSS.escape(messageId)}"]`,
          );
          return (
            row &&
            Math.abs(
              row.getBoundingClientRect().top -
                scroller.getBoundingClientRect().top -
                offset,
            ) < 2
          );
        },
        touchAnchor,
        { timeout: 5000 },
      );
    const beforeTouch = await scroll.evaluate((e) => e.scrollTop);
    const readingAnchor = await firstVisibleMessage(touchPage);
    const area = await scroll.boundingBox();
    const x = area.x + area.width / 2,
      y = area.y + area.height / 2;
    const gesture = async (direction) => {
      await touchSession.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 8; step++) {
        await touchSession.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + direction * step * 20 }],
        });
        await touchPage.waitForTimeout(35);
      }
      await touchSession.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await touchPage.waitForTimeout(500);
    };
    await gesture(-1);
    const down = await scroll.evaluate((e) => e.scrollTop);
    const afterDown = await messagePosition(touchPage, readingAnchor.messageId);
    assert.ok(
      afterDown === null || afterDown.offset < readingAnchor.offset - 70,
      `${kind}: visible content must move down after prepend (${beforeTouch} -> ${down})`,
    );
    const reverseAnchor = await firstVisibleMessage(touchPage);
    await gesture(1);
    const afterUp = await messagePosition(touchPage, reverseAnchor.messageId);
    assert.ok(
      afterUp === null || afterUp.offset > reverseAnchor.offset + 70,
      `${kind}: visible content must also move up`,
    );
  }
  await touchPage.close();
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
  const sidebarAttention = await page.evaluate(() => {
    const channel = document.querySelector('[data-testid="channel-attention"]');
    const quietChannel = document.querySelector(
      '[data-testid="quiet-channel-attention"]',
    );
    const direct = document.querySelector('[data-testid="direct-attention"]');
    const mention = channel?.querySelector(".rah-room-mention");
    const mentionIcon = mention?.querySelector("svg");
    const channelUnread = channel?.querySelector(".rah-room-unread");
    const directUnread = direct?.querySelector(".rah-room-unread");
    const quietUnread = quietChannel?.querySelector(".rah-room-unread");
    const quietMuted = quietChannel?.querySelector(".rah-room-muted");
    const quietMutedIcon = quietMuted?.querySelector("svg");
    const quietName = quietChannel?.querySelector(".rah-sidebar-channel-name");
    const directAttention = direct?.querySelector(".rah-room-attention");
    if (
      !(mention instanceof HTMLElement) ||
      !(mentionIcon instanceof SVGElement) ||
      !(channelUnread instanceof HTMLElement) ||
      !(directUnread instanceof HTMLElement) ||
      !(quietUnread instanceof HTMLElement) ||
      !(quietMuted instanceof HTMLElement) ||
      !(quietMutedIcon instanceof SVGElement) ||
      !(quietName instanceof HTMLElement) ||
      !(directAttention instanceof HTMLElement)
    ) {
      throw new Error("missing Room attention browser sample");
    }
    const mentionStyle = getComputedStyle(mention);
    const unreadStyle = getComputedStyle(channelUnread);
    const quietStyle = getComputedStyle(quietUnread);
    const quietMutedStyle = getComputedStyle(quietMuted);
    const directAttentionStyle = getComputedStyle(directAttention);
    const mentionRect = mention.getBoundingClientRect();
    const iconRect = mentionIcon.getBoundingClientRect();
    return {
      channelMentionCount: channel.querySelectorAll(".rah-room-mention").length,
      directMentionCount: direct.querySelectorAll(".rah-room-mention").length,
      channelUnreadText: channelUnread.textContent,
      directUnreadText: directUnread.textContent,
      quietUnreadText: quietUnread.textContent,
      quietMutedCount: quietChannel.querySelectorAll(".rah-room-muted").length,
      directAttention: {
        alignItems: directAttentionStyle.alignItems,
        display: directAttentionStyle.display,
        overflow: directAttentionStyle.overflow,
      },
      mention: {
        backgroundColor: mentionStyle.backgroundColor,
        borderRadius: mentionStyle.borderRadius,
        borderWidth: mentionStyle.borderWidth,
        height: mentionRect.height,
        iconCenterDeltaX:
          iconRect.left +
          iconRect.width / 2 -
          (mentionRect.left + mentionRect.width / 2),
        iconCenterDeltaY:
          iconRect.top +
          iconRect.height / 2 -
          (mentionRect.top + mentionRect.height / 2),
        iconHeight: iconRect.height,
        iconWidth: iconRect.width,
        marginLeft: mentionStyle.marginLeft,
        width: mentionRect.width,
      },
      unread: {
        backgroundColor: unreadStyle.backgroundColor,
        borderRadius: unreadStyle.borderRadius,
        borderWidth: unreadStyle.borderWidth,
        color: unreadStyle.color,
        fontSize: unreadStyle.fontSize,
        height: channelUnread.getBoundingClientRect().height,
      },
      quietUnread: {
        backgroundColor: quietStyle.backgroundColor,
        borderWidth: quietStyle.borderWidth,
        color: quietStyle.color,
        fontFamily: quietStyle.fontFamily,
        fontSize: quietStyle.fontSize,
        fontWeight: quietStyle.fontWeight,
        height: quietUnread.getBoundingClientRect().height,
      },
      quietMuted: {
        color: quietMutedStyle.color,
        gapFromName:
          quietMuted.getBoundingClientRect().left -
          quietName.getBoundingClientRect().right,
        height: quietMuted.getBoundingClientRect().height,
        iconHeight: quietMutedIcon.getBoundingClientRect().height,
        iconWidth: quietMutedIcon.getBoundingClientRect().width,
        width: quietMuted.getBoundingClientRect().width,
      },
    };
  });
  const yellowAttention = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "var(--yellow)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  const pinkAttention = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "var(--pink)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  assert.deepEqual(
    {
      channelMentionCount: sidebarAttention.channelMentionCount,
      channelUnreadText: sidebarAttention.channelUnreadText,
      directMentionCount: sidebarAttention.directMentionCount,
      directUnreadText: sidebarAttention.directUnreadText,
      quietUnreadText: sidebarAttention.quietUnreadText,
      quietMutedCount: sidebarAttention.quietMutedCount,
    },
    {
      channelMentionCount: 1,
      channelUnreadText: "3",
      directMentionCount: 0,
      directUnreadText: "4",
      quietUnreadText: "7",
      quietMutedCount: 1,
    },
  );
  assert.deepEqual(sidebarAttention.mention, {
    backgroundColor: yellowAttention,
    borderRadius: "4px",
    borderWidth: "1px",
    height: 16,
    iconCenterDeltaX: 0,
    iconCenterDeltaY: 0,
    iconHeight: 10,
    iconWidth: 10,
    marginLeft: "4px",
    width: 16,
  });
  assert.equal(sidebarAttention.unread.backgroundColor, pinkAttention);
  assert.equal(sidebarAttention.unread.borderRadius, "4px");
  assert.equal(sidebarAttention.unread.borderWidth, "1px");
  assert.equal(sidebarAttention.unread.color, "rgb(255, 255, 255)");
  assert.equal(sidebarAttention.unread.fontSize, "10px");
  assert.equal(sidebarAttention.unread.height, 16);
  assert.deepEqual(sidebarAttention.directAttention, {
    alignItems: "center",
    // A direct child of the flex row is blockified by CSS Display, so the
    // computed value is `flex` even though the authored primitive is
    // `inline-flex`.
    display: "flex",
    overflow: "visible",
  });
  assert.equal(
    sidebarAttention.quietUnread.backgroundColor,
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(sidebarAttention.quietUnread.borderWidth, "0px");
  assert.equal(sidebarAttention.quietUnread.fontSize, "10px");
  assert.equal(sidebarAttention.quietUnread.fontWeight, "500");
  assert.equal(sidebarAttention.quietUnread.height, 14);
  assert.deepEqual(sidebarAttention.quietMuted, {
    color: "rgba(0, 0, 0, 0.4)",
    gapFromName: 4,
    height: 16,
    iconHeight: 12,
    iconWidth: 12,
    width: 16,
  });
  const workspaceActivity = await page.evaluate(() => {
    const working = document.querySelector(
      '[data-testid="direct-activity-working"] .rah-live-agent-activity-footer',
    );
    const online = document.querySelector(
      '[data-testid="direct-activity-online"] .rah-live-agent-activity-footer',
    );
    if (!(working instanceof HTMLElement)) {
      throw new Error("missing working Direct Room activity strip");
    }
    const label = working.querySelector(":scope > span:last-child");
    const dot = working.querySelector(".rah-live-agent-activity-dot");
    if (!(label instanceof HTMLElement) || !(dot instanceof HTMLElement)) {
      throw new Error("incomplete Direct Room activity strip");
    }
    const style = getComputedStyle(working);
    const labelStyle = getComputedStyle(label);
    return {
      activity: dot.dataset.activity,
      backgroundColor: style.backgroundColor,
      fontSize: labelStyle.fontSize,
      height: working.getBoundingClientRect().height,
      label: label.textContent,
      onlineStripCount: online === null ? 0 : 1,
      paddingBlock: [style.paddingTop, style.paddingBottom],
      paddingInline: [style.paddingLeft, style.paddingRight],
      pulse: dot.dataset.pulse,
    };
  });
  assert.deepEqual(workspaceActivity, {
    activity: "thinking",
    backgroundColor: "rgb(255, 250, 239)",
    fontSize: "14px",
    height: 48,
    label: "思考中…",
    onlineStripCount: 0,
    paddingBlock: ["8px", "8px"],
    paddingInline: ["12px", "12px"],
    pulse: "true",
  });
  const disabledWorkspaceActivityDisplay = await page.evaluate(() => {
    const footer = document.querySelector(
      '[data-testid="direct-activity-working"] .rah-live-agent-activity-footer',
    );
    if (!(footer instanceof HTMLElement))
      throw new Error("missing work strip preference fixture");
    document.documentElement.dataset.rahLiveAgentActivity = "false";
    const display = getComputedStyle(footer).display;
    document.documentElement.dataset.rahLiveAgentActivity = "true";
    return display;
  });
  assert.equal(disabledWorkspaceActivityDisplay, "none");
  const restStyles = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      assertElement(element, selector);
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
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
      self: read(".rah-rich-self-reference"),
      task: read(".rah-rich-task-reference"),
    };
  });
  assert.equal(restStyles.agent.fontSize, "14px");
  assert.equal(restStyles.task.fontSize, "12.25px");
  assert.equal(restStyles.task.borderRadius, "0px");
  assert.deepEqual(restStyles.self, {
    backgroundColor: yellowAttention,
    borderWidth: "1px",
    borderRadius: "0px",
    fontSize: "12.25px",
  });
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
  await page.setViewportSize({ height: 844, width: 390 });
  const mobileAttention = await page.evaluate(() => {
    const channel = document.querySelector('[data-testid="channel-attention"]');
    const quietChannel = document.querySelector(
      '[data-testid="quiet-channel-attention"]',
    );
    const direct = document.querySelector('[data-testid="direct-attention"]');
    const mention = channel?.querySelector(".rah-room-mention");
    const mentionIcon = mention?.querySelector("svg");
    const channelUnread = channel?.querySelector(".rah-room-unread");
    const directUnread = direct?.querySelector(".rah-room-unread");
    const quietUnread = quietChannel?.querySelector(".rah-room-unread");
    const quietMuted = quietChannel?.querySelector(".rah-room-muted");
    const quietMutedIcon = quietMuted?.querySelector("svg");
    const directAttention = direct?.querySelector(".rah-room-attention");
    const footer = document.querySelector(
      '[data-testid="direct-activity-working"] .rah-live-agent-activity-footer',
    );
    if (
      !(mention instanceof HTMLElement) ||
      !(mentionIcon instanceof SVGElement) ||
      !(channelUnread instanceof HTMLElement) ||
      !(directUnread instanceof HTMLElement) ||
      !(quietUnread instanceof HTMLElement) ||
      !(quietMuted instanceof HTMLElement) ||
      !(quietMutedIcon instanceof SVGElement) ||
      !(directAttention instanceof HTMLElement) ||
      !(footer instanceof HTMLElement)
    )
      throw new Error("incomplete mobile attention fixture");
    const mentionRect = mention.getBoundingClientRect();
    const iconRect = mentionIcon.getBoundingClientRect();
    const channelUnreadStyle = getComputedStyle(channelUnread);
    const directUnreadStyle = getComputedStyle(directUnread);
    const quietUnreadStyle = getComputedStyle(quietUnread);
    const directAttentionStyle = getComputedStyle(directAttention);
    const footerStyle = getComputedStyle(footer);
    return {
      channelMentionCount:
        channel?.querySelectorAll(".rah-room-mention").length,
      channelUnreadText: channelUnread?.textContent,
      directMentionCount: direct?.querySelectorAll(".rah-room-mention").length,
      directUnreadText: directUnread?.textContent,
      quietUnreadText: quietUnread.textContent,
      quietMutedCount: quietChannel.querySelectorAll(".rah-room-muted").length,
      quietMutedSize: [quietMuted.offsetWidth, quietMuted.offsetHeight],
      quietMutedIconSize: [
        quietMutedIcon.getBoundingClientRect().width,
        quietMutedIcon.getBoundingClientRect().height,
      ],
      mentionSize: [mention.offsetWidth, mention.offsetHeight],
      mentionIconSize: [iconRect.width, iconRect.height],
      mentionCenterDelta: [
        iconRect.left +
          iconRect.width / 2 -
          (mentionRect.left + mentionRect.width / 2),
        iconRect.top +
          iconRect.height / 2 -
          (mentionRect.top + mentionRect.height / 2),
      ],
      unread: {
        backgroundColor: channelUnreadStyle.backgroundColor,
        borderWidth: channelUnreadStyle.borderWidth,
        color: channelUnreadStyle.color,
        fontSize: channelUnreadStyle.fontSize,
        height: channelUnread.offsetHeight,
      },
      directUnread: {
        backgroundColor: directUnreadStyle.backgroundColor,
        height: directUnread.offsetHeight,
      },
      quietUnread: {
        backgroundColor: quietUnreadStyle.backgroundColor,
        borderWidth: quietUnreadStyle.borderWidth,
        height: quietUnread.offsetHeight,
      },
      directAttention: {
        alignItems: directAttentionStyle.alignItems,
        display: directAttentionStyle.display,
        overflow: directAttentionStyle.overflow,
      },
      footer: {
        backgroundColor: footerStyle.backgroundColor,
        height: footer.offsetHeight,
        paddingBlock: [footerStyle.paddingTop, footerStyle.paddingBottom],
        paddingInline: [footerStyle.paddingLeft, footerStyle.paddingRight],
      },
    };
  });
  assert.deepEqual(mobileAttention, {
    channelMentionCount: 1,
    channelUnreadText: "3",
    directMentionCount: 0,
    directUnreadText: "4",
    quietUnreadText: "7",
    quietMutedCount: 1,
    quietMutedSize: [16, 16],
    quietMutedIconSize: [12, 12],
    mentionSize: [16, 16],
    mentionIconSize: [10, 10],
    mentionCenterDelta: [0, 0],
    unread: {
      backgroundColor: pinkAttention,
      borderWidth: "1px",
      color: "rgb(255, 255, 255)",
      fontSize: "10px",
      height: 16,
    },
    directUnread: { backgroundColor: pinkAttention, height: 16 },
    quietUnread: {
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderWidth: "0px",
      height: 14,
    },
    directAttention: {
      alignItems: "center",
      display: "flex",
      overflow: "visible",
    },
    footer: {
      backgroundColor: "rgb(255, 255, 255)",
      height: 48,
      paddingBlock: ["8px", "8px"],
      paddingInline: ["12px", "12px"],
    },
  });
  console.log(
    JSON.stringify({
      anchorDelta: anchorAfter.offset - anchorBefore.offset,
      browser: await findChromeExecutable(),
      domRows: anchorAfter.domRows,
      logicalMessages: 10_050,
      markdown,
      workspaceActivity,
      disabledWorkspaceActivityDisplay,
      mobileAttention,
      sidebarAttention,
      viewports: ["1440x1000", "390x844"],
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
