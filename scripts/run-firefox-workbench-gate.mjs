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
const profileImagePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V7viPwAHwwMjerDEwwAAAABJRU5ErkJggg==",
  "base64",
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

  const secondaryWorkspace = await page.evaluate(async () => {
    const request = async (path, body) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(
          `${path} failed: ${response.status} ${await response.text()}`,
        );
      return await response.json();
    };
    const created = await request("/v3/client/workspaces/create", {
      idempotencyKey: "firefox-workspace-switcher-secondary",
      name: "Second Workspace",
      slug: "second-workspace",
    });
    const room = await request("/v3/client/rooms/create", {
      basedOnControlRoomSeq: created.event.roomSeq,
      idempotencyKey: "firefox-workspace-switcher-room",
      kind: "channel",
      name: "Second Council",
      slug: "second-council",
      workspaceId: created.workspace.workspaceId,
    });
    return {
      roomId: room.room.roomId,
      workspaceId: created.workspace.workspaceId,
    };
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator(".channel-title h1", { hasText: "Agent Council" })
    .waitFor({ timeout: 20_000 });
  const workspaceTrigger = page.locator(".rah-space-mark");
  await workspaceTrigger.click();
  const workspaceMenu = page.getByRole("menu", { name: "切换协作空间" });
  await workspaceMenu.waitFor();
  assert.deepEqual(
    await workspaceMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const trigger = document
        .querySelector(".rah-space-mark")
        ?.getBoundingClientRect();
      if (!trigger) throw new Error("missing Workspace switcher trigger");
      return {
        leftGap: rect.left - trigger.right,
        maxHeight: getComputedStyle(element).maxHeight,
        topOffset: rect.top - trigger.top,
        width: rect.width,
      };
    }),
    { leftGap: 8, maxHeight: "984px", topOffset: 4, width: 256 },
  );
  const workspaceRows = workspaceMenu.getByRole("menuitemradio");
  assert.equal(await workspaceRows.count(), 2);
  assert.equal(
    await workspaceRows
      .filter({ hasText: "Second Workspace" })
      .getAttribute("aria-checked"),
    "false",
  );
  await page.keyboard.press("Escape");
  await workspaceMenu.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.querySelector(".rah-space-mark") === document.activeElement,
  );
  assert.equal(
    await workspaceTrigger.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  await page.locator(".channel-title").click();
  await workspaceMenu.waitFor({ state: "detached" });

  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  const dragHandles = workspaceMenu.locator(".rah-space-switcher-drag");
  const firstDragBox = await dragHandles.nth(0).boundingBox();
  const secondDragBox = await dragHandles.nth(1).boundingBox();
  assert.ok(firstDragBox && secondDragBox);
  await page.mouse.move(
    secondDragBox.x + secondDragBox.width / 2,
    secondDragBox.y + secondDragBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    firstDragBox.x + firstDragBox.width / 2,
    firstDragBox.y + firstDragBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.match(
    (await workspaceRows.first().textContent()) ?? "",
    /Second Workspace/u,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator(".channel-title h1", { hasText: "Agent Council" })
    .waitFor({ timeout: 20_000 });
  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  assert.match(
    (await workspaceRows.first().textContent()) ?? "",
    /Second Workspace/u,
  );

  await workspaceRows.filter({ hasText: "Second Workspace" }).click();
  await page
    .locator(".channel-title h1", { hasText: "Second Council" })
    .waitFor({ timeout: 20_000 });
  assert.equal(
    await workspaceTrigger.getAttribute("title"),
    "Second Workspace",
  );
  assert.equal(
    new URL(page.url()).searchParams.get("room"),
    secondaryWorkspace.roomId,
  );
  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  await workspaceRows.filter({ hasNotText: "Second Workspace" }).click();
  await page
    .locator(".channel-title h1", { hasText: "Agent Council" })
    .waitFor({ timeout: 20_000 });
  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  await workspaceRows.filter({ hasText: "Second Workspace" }).click();
  await page
    .locator(".channel-title h1", { hasText: "Second Council" })
    .waitFor({ timeout: 20_000 });
  assert.equal(
    new URL(page.url()).searchParams.get("room"),
    secondaryWorkspace.roomId,
  );
  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  await workspaceRows.filter({ hasNotText: "Second Workspace" }).click();
  await page
    .locator(".channel-title h1", { hasText: "Agent Council" })
    .waitFor({ timeout: 20_000 });

  const roomSeparator = page.getByRole("separator", {
    name: "调整聊天边栏宽度",
  });
  assert.deepEqual(
    await roomSeparator.evaluate((element) => ({
      max: element.getAttribute("aria-valuemax"),
      min: element.getAttribute("aria-valuemin"),
      now: element.getAttribute("aria-valuenow"),
      width: element.getBoundingClientRect().width,
    })),
    { max: "320", min: "180", now: "240", width: 8 },
  );
  const roomSidebar = page.locator(".rah-room-sidebar");
  await dragRoomSeparator(page, roomSeparator, 200);
  assert.equal(
    await roomSidebar.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    320,
  );
  await dragRoomSeparator(page, roomSeparator, -200);
  assert.equal(
    await roomSidebar.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    180,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator(".channel-title h1", { hasText: "Agent Council" })
    .waitFor({ timeout: 20_000 });
  await page.locator(".messages").waitFor({ timeout: 20_000 });
  await roomSidebar.waitFor({ state: "visible" });
  assert.equal(
    await roomSidebar.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    180,
  );
  await dragRoomSeparator(page, roomSeparator, 60);
  assert.equal(
    await roomSidebar.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    240,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator(".channel-title h1", { hasText: "Agent Council" })
    .waitFor({ timeout: 20_000 });
  await page.locator(".messages").waitFor({ timeout: 20_000 });
  await roomSidebar.waitFor({ state: "visible" });
  assert.equal(
    await roomSidebar.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    240,
  );
  const composer = page.getByRole("textbox", { name: "消息输入框" });
  await composer.fill("toolbar-probe");
  await composer.press("Enter");
  const probeMessage = page.locator(".msg", { hasText: "toolbar-probe" });
  await probeMessage.waitFor();
  const probeMessageId = await probeMessage.getAttribute("data-message-id");
  assert.ok(probeMessageId);
  for (const body of [
    "任务已经进入队列，等待其他 Agent 认领",
    "只有任务这个词",
    "这里只有认领这个词",
  ]) {
    await composer.fill(body);
    await composer.press("Enter");
    await page.locator(".msg", { hasText: body }).waitFor();
  }
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const globalSearch = page.getByRole("main", { name: "全局搜索" });
  await globalSearch.waitFor();
  await globalSearch.getByRole("button", { name: "不限时间" }).click();
  await page
    .getByRole("menu", { name: "时间筛选" })
    .getByRole("menuitemradio", { name: "今天" })
    .click();
  await globalSearch.locator(".rah-search-count").waitFor();
  assert.equal(
    await globalSearch.getByText("搜索所有内容").count(),
    0,
    "an active Raft filter must enter result mode without a keyword",
  );
  assert.equal(
    await globalSearch.getByRole("button", { name: "相关度" }).isDisabled(),
    true,
  );
  await globalSearch.getByRole("button", { name: "清除筛选" }).click();
  await globalSearch.getByText("搜索所有内容").waitFor();
  const globalSearchBox = globalSearch.getByRole("textbox", {
    name: "搜索频道、私信、消息",
  });
  await globalSearchBox.fill("任务 认领");
  await page.waitForFunction(
    () => document.querySelectorAll(".rah-search-hit").length === 3,
  );
  const searchHits = globalSearch.locator(".rah-search-hit");
  assert.match((await searchHits.first().textContent()) ?? "", /任务.*认领/u);
  assert.deepEqual(await searchHits.first().locator("mark").allTextContents(), [
    "任务",
    "认领",
  ]);
  await page.setViewportSize({ height: 844, width: 390 });
  assert.deepEqual(
    await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    { clientWidth: 390, scrollWidth: 390 },
  );
  await page.setViewportSize({ height: 1_000, width: 1_440 });
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await probeMessage.waitFor();
  const probeActions = probeMessage.locator(".msg-actions");
  assert.equal(
    await probeActions.evaluate((element) => getComputedStyle(element).opacity),
    "0",
  );
  await probeMessage.hover();
  assert.ok(
    Number(
      await probeActions.evaluate(
        (element) => getComputedStyle(element).opacity,
      ),
    ) < 1,
  );
  await page.waitForTimeout(200);
  assert.equal(
    await probeActions.evaluate((element) => getComputedStyle(element).opacity),
    "1",
  );
  const replyAction = probeActions.getByRole("button", {
    name: "在消息列中回复",
  });
  await replyAction.hover();
  assert.equal(
    await replyAction.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    "rgba(255, 212, 64, 0.3)",
  );
  const threadPanel = page.getByLabel("Thread 讨论");
  const threadClose = page.getByRole("button", { name: "关闭消息列" });
  const threadOverflow = page.getByRole("button", { name: "消息列操作" });
  await replyAction.click();
  await threadPanel.waitFor();
  await threadClose.click();
  await threadPanel.waitFor({ state: "detached" });
  await page.waitForFunction(
    (messageId) =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset.messageId === messageId,
    probeMessageId,
  );
  assert.equal(
    await probeMessage.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );

  await probeMessage.hover();
  await replyAction.click();
  await threadPanel.waitFor();
  await threadOverflow.click();
  const threadOverflowMenu = page.getByRole("menu").filter({
    has: page.getByRole("menuitem", { name: "在消息列中搜索" }),
  });
  await threadOverflowMenu.waitFor();
  await page.keyboard.press("Escape");
  await threadOverflowMenu.waitFor({ state: "detached" });
  assert.equal(await threadPanel.isVisible(), true);
  assert.equal(
    await threadOverflow.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await threadOverflow.click();
  await threadOverflowMenu
    .getByRole("menuitem", { name: "在消息列中搜索" })
    .click();
  const threadSearch = page.getByRole("textbox", {
    name: "在消息列中搜索",
  });
  await threadSearch.waitFor();
  await threadSearch.press("Escape");
  await threadSearch.waitFor({ state: "detached" });
  assert.equal(await threadPanel.isVisible(), true);
  await threadOverflow.focus();
  await page.keyboard.press("Escape");
  await threadPanel.waitFor({ state: "detached" });
  await page.waitForFunction(
    (messageId) =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset.messageId === messageId,
    probeMessageId,
  );
  assert.equal(
    await probeMessage.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );

  await page.setViewportSize({ height: 844, width: 390 });
  await probeMessage.hover();
  await replyAction.click();
  await threadPanel.waitFor();
  assert.deepEqual(
    await threadPanel.evaluate((element) => ({
      clientWidth: document.documentElement.clientWidth,
      panelWidth: element.getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    { clientWidth: 390, panelWidth: 390, scrollWidth: 390 },
  );
  await threadClose.click();
  await threadPanel.waitFor({ state: "detached" });
  await page.waitForFunction(
    (messageId) =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset.messageId === messageId,
    probeMessageId,
  );
  assert.equal(
    await probeMessage.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await page.setViewportSize({ height: 1_000, width: 1_440 });
  const reactionAction = probeActions.getByRole("button", {
    name: "添加回应",
  });
  await reactionAction.click();
  const reactionPicker = page.locator(".rah-discovery-popover.is-reaction");
  await reactionPicker.waitFor();
  assert.deepEqual(
    await reactionPicker.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    }),
    { height: 40, width: 224 },
  );
  const checkReaction = page.getByTitle("用 ✅ 回应");
  assert.deepEqual(
    await checkReaction.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const glyph = element.querySelector(".rah-reaction-glyph");
      if (!(glyph instanceof HTMLElement))
        throw new Error("missing reaction glyph");
      const glyphRect = glyph.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        borderRadius: style.borderRadius,
        centers: {
          x: glyphRect.x + glyphRect.width / 2 - (rect.x + rect.width / 2),
          y: glyphRect.y + glyphRect.height / 2 - (rect.y + rect.height / 2),
        },
        display: style.display,
        glyph: { height: glyphRect.height, width: glyphRect.width },
        padding: style.padding,
      };
    }),
    {
      borderRadius: "4px",
      centers: { x: 0, y: 0 },
      display: "flex",
      glyph: { height: 18, width: 18 },
      padding: "0px",
    },
  );
  await reactionAction.hover();
  await reactionPicker.hover();
  await page.waitForTimeout(140);
  assert.equal(await reactionPicker.isVisible(), true);
  await checkReaction.hover();
  await page.waitForTimeout(175);
  assert.ok(
    [
      "rgba(254, 125, 168, 0.2)",
      "color(srgb 0.996079 0.490196 0.658824 / 0.2)",
    ].includes(
      await checkReaction.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await reactionPicker.waitFor({ state: "detached" });
  await reactionAction.click();
  await reactionPicker.waitFor();
  await page.keyboard.press("Escape");
  await reactionPicker.waitFor({ state: "detached" });
  assert.equal(
    await reactionAction.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await reactionAction.click();
  await reactionPicker.waitFor();
  await page.locator("body").dispatchEvent("pointerdown");
  await reactionPicker.waitFor({ state: "detached" });
  await reactionAction.click();
  await reactionPicker.waitFor();
  await reactionPicker.hover();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(140);
  await reactionPicker.waitFor({ state: "detached" });
  await reactionAction.click();
  await reactionPicker.waitFor();
  await page.getByTitle("用 ✅ 回应").click();
  const reactionChips = probeMessage.locator(".rah-message-reaction");
  await reactionChips.first().waitFor();
  await probeMessage.hover();
  await page.waitForTimeout(200);
  await reactionAction.click();
  await reactionPicker.waitFor();
  await page.getByTitle("用 ❤️ 回应").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".rah-message-reaction").length === 2,
  );
  const reactionActorsTooltip = page.locator(
    '[data-message-affordance="reaction-reactors-popover"]',
  );
  await reactionChips.first().hover();
  await reactionActorsTooltip.waitFor();
  assert.equal((await reactionActorsTooltip.textContent())?.trim(), "你");
  assert.deepEqual(
    await reactionActorsTooltip.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        border: style.border,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        maxWidth: style.maxWidth,
        padding: style.padding,
        pointerEvents: style.pointerEvents,
        position: style.position,
        topGap:
          rect.top -
          document
            .querySelector(".rah-message-reaction")
            .getBoundingClientRect().bottom,
        zIndex: style.zIndex,
      };
    }),
    {
      border: "2px solid oklch(0 0 0)",
      fontSize: "12px",
      fontWeight: "700",
      maxWidth: "280px",
      padding: "6px 8px",
      pointerEvents: "none",
      position: "fixed",
      topGap: 4,
      zIndex: "80",
    },
  );
  await page.mouse.move(0, 0);
  await reactionActorsTooltip.waitFor({ state: "detached" });
  await reactionChips.first().focus();
  await reactionActorsTooltip.waitFor();
  await composer.focus();
  await reactionActorsTooltip.waitFor({ state: "detached" });
  await page.setViewportSize({ height: 844, width: 390 });
  await reactionChips.first().scrollIntoViewIfNeeded();
  await reactionChips.first().hover();
  await reactionActorsTooltip.waitFor();
  assert.deepEqual(
    await reactionActorsTooltip.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottomFits: rect.bottom <= window.innerHeight - 8,
        leftFits: rect.left >= 8,
        rightFits: rect.right <= window.innerWidth - 8,
        scrollWidth: document.documentElement.scrollWidth,
      };
    }),
    { bottomFits: true, leftFits: true, rightFits: true, scrollWidth: 390 },
  );
  await page.mouse.move(0, 0);
  await reactionActorsTooltip.waitFor({ state: "detached" });
  await page.setViewportSize({ height: 1_000, width: 1_440 });
  await probeMessage.hover();
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('700 12px "Space Mono"');
    }),
    true,
  );
  assert.equal(await reactionChips.count(), 2);
  assert.deepEqual(
    await reactionChips.first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const glyph = element.querySelector(".rah-reaction-glyph");
      const count = element.querySelector(".rah-message-reaction-count");
      if (!(glyph instanceof HTMLElement) || !(count instanceof HTMLElement))
        throw new Error("missing reaction chip content");
      const glyphRect = glyph.getBoundingClientRect();
      const countStyle = getComputedStyle(count);
      const countRect = count.getBoundingClientRect();
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        gap: style.gap,
        glyph: { height: glyphRect.height, width: glyphRect.width },
        height: rect.height,
        width: rect.width,
        lineHeight: style.lineHeight,
        padding: style.padding,
        count: {
          family: countStyle.fontFamily,
          variant: countStyle.fontVariantNumeric,
          width: countRect.width,
        },
      };
    }),
    {
      backgroundColor: "color(srgb 0.996079 0.490196 0.658824 / 0.2)",
      borderRadius: "4px",
      gap: "4px",
      glyph: { height: 15, width: 15 },
      height: 20,
      // Firefox exposes the same official font metric at its own 1/65536px
      // layout quantization; Chromium reports 38.3515625 for this exact chip.
      width: 38.350006103515625,
      lineHeight: "12px",
      padding: "0px 6px",
      count: {
        family: '"Space Mono", ui-monospace, monospace',
        variant: "tabular-nums",
        width: 7.350006103515625,
      },
    },
  );
  const saveAction = probeActions.locator("button.msg-action-btn").last();
  await saveAction.hover();
  assert.equal(
    await saveAction.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    "rgba(255, 212, 64, 0.3)",
  );
  await saveAction.click();
  const savedBadge = probeMessage.locator(".rah-message-saved-badge");
  await savedBadge.waitFor();
  assert.equal(await savedBadge.textContent(), "已保存");
  assert.equal(await savedBadge.getAttribute("title"), "从收藏中移除");
  assert.deepEqual(
    await savedBadge.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const icon = element.querySelector("svg");
      if (!(icon instanceof SVGElement)) throw new Error("missing saved icon");
      const iconRect = icon.getBoundingClientRect();
      return {
        border: style.border,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        height: rect.height,
        icon: { height: iconRect.height, width: iconRect.width },
        lineHeight: style.lineHeight,
        padding: style.padding,
        transitionDuration: style.transitionDuration,
        transitionProperty: style.transitionProperty,
      };
    }),
    {
      border: "1px solid oklch(0 0 0)",
      fontSize: "10px",
      fontWeight: "700",
      height: 20,
      icon: { height: 10, width: 10 },
      lineHeight: "10px",
      padding: "0px 6px",
      transitionDuration: "0.1s",
      transitionProperty: "filter",
    },
  );
  await savedBadge.hover();
  await page.waitForTimeout(120);
  assert.equal(
    await savedBadge.evaluate((element) => getComputedStyle(element).filter),
    "brightness(0.9)",
  );
  await page.mouse.move(0, 0);
  assert.equal(
    await saveAction.evaluate((element) => getComputedStyle(element).color),
    "rgb(248, 161, 111)",
  );
  assert.equal(
    await saveAction.locator("svg").getAttribute("fill"),
    "currentColor",
  );
  const socialSummary = probeMessage.locator(".rah-message-social-summary");
  assert.deepEqual(
    await socialSummary.evaluate((element) => {
      const style = getComputedStyle(element);
      const saved = element.querySelector(
        '[data-message-affordance="saved-badge"]',
      );
      const reaction = element.querySelector(
        '[data-message-affordance="reaction-chip"]',
      );
      if (!(saved instanceof HTMLElement) || !(reaction instanceof HTMLElement))
        throw new Error("missing inline social summary controls");
      const savedRect = saved.getBoundingClientRect();
      const reactionRect = reaction.getBoundingClientRect();
      return {
        alignItems: style.alignItems,
        display: style.display,
        gap: style.gap,
        sameRow: savedRect.y === reactionRect.y,
      };
    }),
    { alignItems: "center", display: "flex", gap: "6px", sameRow: true },
  );
  const reactionRows = await reactionChips.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().y),
  );
  assert.equal(new Set(reactionRows).size, 1);
  const dispatchTouch = async (type) =>
    probeMessage.evaluate((element, eventType) => {
      const rect = element.getBoundingClientRect();
      const event = new Event(eventType, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "touches", {
        value:
          eventType === "touchend"
            ? []
            : [
                {
                  clientX: rect.left + Math.min(32, rect.width / 2),
                  clientY: rect.top + Math.min(32, rect.height / 2),
                },
              ],
      });
      element.dispatchEvent(event);
    }, type);
  await dispatchTouch("touchstart");
  await dispatchTouch("touchmove");
  await page.waitForTimeout(550);
  assert.equal(await page.locator(".rah-message-context-menu").count(), 0);
  await dispatchTouch("touchstart");
  await page.waitForTimeout(550);
  const longPressMenu = page.locator(".rah-message-context-menu");
  await longPressMenu.waitFor();
  await dispatchTouch("touchend");
  await page.keyboard.press("Escape");
  await longPressMenu.waitFor({ state: "detached" });
  assert.equal(
    await probeMessage.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await probeMessage.click({ button: "right" });
  const messageContextMenu = page.locator(".rah-message-context-menu");
  await messageContextMenu.waitFor();
  assert.equal(await messageContextMenu.getByRole("menuitemradio").count(), 7);
  assert.deepEqual(
    await messageContextMenu.getByRole("menuitem").allTextContents(),
    ["复制链接", "复制 Markdown", "在消息列中回复", "从收藏中移除", "转为任务"],
  );
  assert.deepEqual(
    await messageContextMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        bottomFits: rect.bottom <= window.innerHeight - 8,
        border: style.border,
        leftFits: rect.left >= 8,
        minWidth: style.minWidth,
        rightFits: rect.right <= window.innerWidth - 8,
        zIndex: style.zIndex,
      };
    }),
    {
      bottomFits: true,
      border: "2px solid oklch(0 0 0)",
      leftFits: true,
      minWidth: "224px",
      rightFits: true,
      zIndex: "60",
    },
  );
  await page.keyboard.press("Escape");
  await messageContextMenu.waitFor({ state: "detached" });
  assert.equal(
    await probeMessage.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await probeMessage.click({ button: "right" });
  await messageContextMenu.waitFor();
  await messageContextMenu
    .getByRole("menuitem", { name: "复制 Markdown" })
    .click();
  await messageContextMenu.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "toolbar-probe",
  );
  await probeMessage.click({ button: "right" });
  await messageContextMenu.waitFor();
  await messageContextMenu
    .getByRole("menuitemradio", { name: "用 🔥 回应" })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".rah-message-reaction").length === 3,
  );
  for (const body of ["saved-gate-two", "saved-gate-three"]) {
    await composer.fill(body);
    await composer.press("Enter");
    const message = page.locator(".msg", { hasText: body });
    await message.waitFor();
    await message.hover();
    await page.waitForTimeout(200);
    await message.locator(".msg-actions button.msg-action-btn").last().click();
    await message.locator(".rah-message-saved-badge").waitFor();
  }
  await page.locator(".sidebar-bookmarks").click();
  const savedCards = page.locator(".rah-saved-card");
  await savedCards.first().waitFor();
  assert.equal(await savedCards.count(), 3);
  assert.equal(
    await page.locator(".rah-saved-header-copy > span").textContent(),
    "3 项",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await savedCards.first().waitFor();
  assert.equal(await savedCards.count(), 3);
  assert.deepEqual(
    await savedCards.first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const avatar = element.querySelector(".rah-saved-sender-avatar");
      const remove = element.querySelector(".rah-saved-remove");
      if (!(avatar instanceof HTMLElement) || !(remove instanceof HTMLElement))
        throw new Error("missing Saved card controls");
      const avatarRect = avatar.getBoundingClientRect();
      const removeRect = remove.getBoundingClientRect();
      return {
        border: getComputedStyle(element).border,
        height: rect.height,
        padding: getComputedStyle(element).padding,
        avatar: { height: avatarRect.height, width: avatarRect.width },
        remove: { height: removeRect.height, width: removeRect.width },
      };
    }),
    {
      border: "2px solid rgba(0, 0, 0, 0.3)",
      height: 68,
      padding: "12px",
      avatar: { height: 14, width: 14 },
      remove: { height: 28, width: 28 },
    },
  );
  const firstSavedCardBox = await savedCards.first().boundingBox();
  assert.ok(firstSavedCardBox);
  await savedCards.first().click({ button: "right" });
  const savedMenu = page.locator(".rah-saved-context-menu");
  await savedMenu.waitFor();
  assert.deepEqual(await savedMenu.getByRole("menuitem").allTextContents(), [
    "复制链接",
    "复制 Markdown",
    "从收藏中移除",
  ]);
  const firstSavedMenuItem = savedMenu.getByRole("menuitem").first();
  assert.deepEqual(
    await savedMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottomWithinViewport: rect.bottom <= window.innerHeight,
        height: rect.height,
        left: rect.left,
        rightWithinViewport: rect.right <= window.innerWidth,
        top: rect.top,
        width: rect.width,
      };
    }),
    {
      bottomWithinViewport: true,
      height: 114,
      left: Math.min(
        firstSavedCardBox.x + firstSavedCardBox.width / 2,
        1_440 - 200,
      ),
      rightWithinViewport: true,
      top: Math.min(
        firstSavedCardBox.y + firstSavedCardBox.height / 2,
        1_000 - 100,
      ),
      width: 180,
    },
  );
  assert.deepEqual(
    await firstSavedMenuItem.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        padding: style.padding,
      };
    }),
    {
      fontSize: "14px",
      fontWeight: "500",
      lineHeight: "20px",
      padding: "8px 12px",
    },
  );
  await firstSavedMenuItem.hover();
  assert.equal(
    await firstSavedMenuItem.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    "rgba(255, 212, 64, 0.3)",
  );
  assert.deepEqual(
    await savedMenu.locator("hr").evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderTop: style.borderTop, margin: style.margin };
    }),
    { borderTop: "2px solid oklch(0 0 0)", margin: "0px" },
  );
  await firstSavedMenuItem.press("ArrowDown");
  assert.equal(
    await savedMenu
      .getByRole("menuitem")
      .nth(1)
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("ArrowUp");
  assert.equal(
    await firstSavedMenuItem.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await page.keyboard.press("End");
  assert.equal(
    await savedMenu
      .getByRole("menuitem")
      .last()
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Home");
  assert.equal(
    await firstSavedMenuItem.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await page.keyboard.press("Escape");
  await savedMenu.waitFor({ state: "detached" });
  assert.equal(
    await savedCards
      .first()
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await savedCards.first().click({ button: "right" });
  await savedMenu.waitFor();
  await page.mouse.click(8, 8);
  await savedMenu.waitFor({ state: "detached" });
  await savedCards.first().click({ button: "right" });
  await savedMenu.waitFor();
  await page.setViewportSize({ height: 844, width: 390 });
  await savedMenu.waitFor({ state: "detached" });
  assert.deepEqual(
    await page.evaluate(() => ({
      cardWidth: document
        .querySelector(".rah-saved-card")
        ?.getBoundingClientRect().width,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    { cardWidth: 358, clientWidth: 390, scrollWidth: 390 },
  );
  await page.setViewportSize({ height: 1_000, width: 1_440 });
  await savedCards.first().click();
  await page.waitForURL(
    (url) =>
      url.searchParams.get("target") === "message" &&
      Boolean(url.searchParams.get("message")),
  );
  await page.goBack({ waitUntil: "domcontentloaded" });
  await savedCards.first().waitFor();
  while ((await savedCards.count()) > 0) {
    const before = await savedCards.count();
    await savedCards.first().locator(".rah-saved-remove").click();
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll(".rah-saved-card").length === expected,
      before - 1,
    );
  }
  assert.equal(
    await page.locator(".rah-saved-empty strong").textContent(),
    "暂无收藏的消息",
  );
  assert.equal(
    await page.locator(".rah-saved-empty p").textContent(),
    "选择消息上的书签图标即可保存。",
  );
  await page.getByTitle("聊天").click();
  await probeMessage.waitFor();
  while ((await reactionChips.count()) > 0) {
    const before = await reactionChips.count();
    await reactionChips.first().click();
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll(".rah-message-reaction").length === expected,
      before - 1,
    );
  }
  await savedBadge.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "频道详情与设置" }).click();
  await page.getByRole("button", { name: "添加成员" }).click();
  const availableAgent = page.locator('button[aria-label^="选择 "]').first();
  await availableAgent.waitFor({ timeout: 20_000 });
  await availableAgent.click();
  await page.getByRole("button", { name: "添加所选（1）" }).click();
  await page
    .locator('[data-room-members-view="settings"]')
    .waitFor({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await page
    .locator('[data-room-members-view="settings"]')
    .waitFor({ state: "detached", timeout: 20_000 });
  await page.locator(".rah-chat-system-notice").waitFor({ timeout: 20_000 });
  await page.getByTitle("Agent 与成员").click();
  await page.locator(".rah-agent-member-row").first().click();
  await page.getByRole("tab", { name: "聊天", exact: true }).click();
  await page.locator(".rah-agent-chat-compose").click({ timeout: 20_000 });
  const profileAvatar = page.locator(
    'button[aria-label^="打开 "][aria-label$=" Agent 资料"]',
  );
  await profileAvatar.waitFor({ timeout: 20_000 });
  await profileAvatar.click();
  const profilePanel = page.locator(".rah-agent-peek");
  const profileSeparator = page.getByRole("separator", {
    name: "调整 Agent 资料面板宽度",
  });
  await profilePanel.waitFor();
  assert.deepEqual(
    await profileSeparator.evaluate((element) => ({
      max: element.getAttribute("aria-valuemax"),
      min: element.getAttribute("aria-valuemin"),
      now: element.getAttribute("aria-valuenow"),
      panelWidth: element.parentElement?.getBoundingClientRect().width,
      width: element.getBoundingClientRect().width,
    })),
    { max: "600", min: "300", now: "380", panelWidth: 380, width: 8 },
  );
  await dragProfileSeparator(page, profileSeparator, -420);
  assert.equal(
    await profilePanel.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    600,
  );
  await dragProfileSeparator(page, profileSeparator, 520);
  assert.equal(
    await profilePanel.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    300,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await profileAvatar.waitFor({ timeout: 20_000 });
  await profileAvatar.click();
  assert.equal(
    await profilePanel.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    300,
  );
  await dragProfileSeparator(page, profileSeparator, -80);
  assert.equal(
    await profilePanel.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    380,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await profileAvatar.waitFor({ timeout: 20_000 });
  await profileAvatar.click();
  assert.equal(
    await profilePanel.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    380,
  );
  await page.setViewportSize({ height: 844, width: 390 });
  assert.equal(
    await profilePanel.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
    390,
  );
  assert.equal(await profileSeparator.isVisible(), false);
  await page.setViewportSize({ height: 1_000, width: 1_440 });
  await page.getByLabel("关闭 Agent 侧栏", { exact: true }).click();

  await page.getByTitle("Agent 与成员").click();
  await page
    .locator(".rah-agent-sidebar-head h1", { hasText: "成员" })
    .waitFor();
  assert.equal(await page.locator(".rah-agent-profile-pane").count(), 1);
  assert.deepEqual(
    await page.locator('.rah-agent-detail-tabs [role="tab"]').allTextContents(),
    ["动态", "资料", "聊天", "提醒", "工作区", "应用", "MCP"],
  );
  await page.getByRole("button", { name: "关系图", exact: true }).click();
  const relationshipCanvas = page.locator(".rah-member-graph-canvas");
  await relationshipCanvas.waitFor();
  assert.equal(
    new URL(page.url()).searchParams.get("memberView"),
    "relationship",
  );
  const relationshipNode = page
    .locator(".rah-member-graph-node-trigger")
    .first();
  await relationshipNode.hover();
  await page.locator('.rah-member-graph-preview[role="tooltip"]').waitFor();
  await page.keyboard.press("Escape");
  await page
    .locator('.rah-member-graph-preview[role="tooltip"]')
    .waitFor({ state: "detached" });
  const relationshipViewBox = await relationshipCanvas
    .locator("svg")
    .getAttribute("viewBox");
  await relationshipCanvas.hover();
  await page.mouse.wheel(0, -320);
  await page.waitForFunction(
    (before) =>
      document
        .querySelector(".rah-member-graph-canvas svg")
        ?.getAttribute("viewBox") !== before,
    relationshipViewBox,
  );
  await page.locator(".rah-agent-member-row").first().click();
  await page.locator(".rah-agent-profile-pane").waitFor();
  assert.equal(new URL(page.url()).searchParams.has("memberView"), false);
  const agentAvatarTrigger = page.locator(".rah-agent-profile-avatar-trigger");
  await agentAvatarTrigger.click();
  const agentAvatarInput = page.locator(
    '.rah-agent-avatar-picker input[type="file"]',
  );
  assert.equal(
    await agentAvatarInput.getAttribute("accept"),
    "image/jpeg,image/png,image/gif,image/webp",
  );
  await agentAvatarInput.setInputFiles({
    buffer: profileImagePng,
    mimeType: "image/png",
    name: "agent-avatar.png",
  });
  const uploadedAgentAvatar = agentAvatarTrigger.locator(
    ".rah-profile-image-avatar",
  );
  await uploadedAgentAvatar.waitFor();
  assert.match(
    (await uploadedAgentAvatar.getAttribute("src")) ?? "",
    /^\/v3\/client\/profile-images\/content\/upload_png_[a-f0-9]{40}$/u,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".rah-agent-profile-pane").waitFor();
  await page
    .locator(".rah-agent-profile-avatar-trigger .rah-profile-image-avatar")
    .waitFor();
  const executionResetButton = page.getByRole("button", {
    exact: true,
    name: "重启 / 重置",
  });
  await executionResetButton.click();
  const executionResetDialog = page.locator(".rah-agent-reset-dialog");
  await executionResetDialog.waitFor();
  const fullResetOption = executionResetDialog.locator('input[value="full"]');
  assert.equal(await fullResetOption.isDisabled(), false);
  await fullResetOption.check();
  await executionResetDialog
    .locator(".rah-agent-reset-warning", {
      hasText: "本机项目目录不会被删除",
    })
    .waitFor();
  assert.equal(
    await executionResetDialog
      .locator(".rah-agent-reset-confirm")
      .evaluate((node) => node.classList.contains("is-full")),
    true,
  );
  await page.keyboard.press("Escape");
  await executionResetDialog.waitFor({ state: "detached" });
  assert.equal(
    await executionResetButton.evaluate(
      (node) => node === document.activeElement,
    ),
    true,
  );
  const reportIssueButton = page.getByRole("button", {
    exact: true,
    name: "报告问题",
  });
  await reportIssueButton.click();
  const issueDialog = page.locator(".rah-agent-issue-report-dialog");
  await issueDialog.waitFor();
  await page.keyboard.press("Escape");
  await issueDialog.waitFor({ state: "detached" });
  assert.equal(
    await reportIssueButton.evaluate((node) => node === document.activeElement),
    true,
  );
  await page.setViewportSize({ height: 844, width: 390 });
  await reportIssueButton.click();
  await issueDialog.waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    { clientWidth: 390, scrollWidth: 390 },
  );
  await page.keyboard.press("Escape");
  await issueDialog.waitFor({ state: "detached" });
  await page.setViewportSize({ height: 1_000, width: 1_440 });
  await reportIssueButton.click();
  await issueDialog.waitFor();
  const exportButton = issueDialog.getByRole("button", {
    exact: true,
    name: "导出到本机",
  });
  assert.equal(await exportButton.isDisabled(), true);
  await issueDialog.locator("textarea").fill("firefox local diagnostic export");
  await issueDialog
    .locator('.rah-agent-issue-report-warning input[type="checkbox"]')
    .check();
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const issueDownload = await downloadPromise;
  const issueDownloadPath = await issueDownload.path();
  assert.notEqual(issueDownloadPath, null);
  const issueReport = JSON.parse(readFileSync(issueDownloadPath, "utf8"));
  assert.equal(issueReport.schemaVersion, "rah-agent-issue-report-v1");
  assert.equal(issueReport.disclosure.transport, "local_download");
  assert.equal(
    issueReport.issue.description,
    "firefox local diagnostic export",
  );
  assert.doesNotMatch(
    JSON.stringify(issueReport),
    /toolInput|recentMessages|runtimeTranscript|SECRET=/u,
  );
  await issueDialog.getByRole("button", { exact: true, name: "完成" }).click();
  await issueDialog.waitFor({ state: "detached" });
  assert.equal(
    await reportIssueButton.evaluate((node) => node === document.activeElement),
    true,
  );
  await page.getByRole("tab", { name: "聊天", exact: true }).click();
  await page.locator(".rah-agent-chat-pane").waitFor();
  assert.equal(
    await page.locator(".rah-agent-chat-room-list button").count(),
    2,
  );
  await page.getByTitle("计算机").click();
  const computerDirectory = page.locator("main.rah-computer-directory");
  await computerDirectory.waitFor();
  await page.locator(".rah-computer-detail h1").waitFor();
  const computerNameEdit = page.getByRole("button", {
    name: "编辑计算机名称",
  });
  const computerDescriptionEdit = page.getByRole("button", {
    name: "编辑计算机描述",
  });
  await computerNameEdit.click();
  const computerNameInput = page.getByLabel("计算机名称");
  await computerNameInput.fill("Firefox Gate Computer");
  await computerNameInput.press("Enter");
  await page
    .locator(".rah-computer-detail h1", { hasText: "Firefox Gate Computer" })
    .waitFor();
  await computerDescriptionEdit.click();
  const computerDescriptionInput = page.getByLabel("计算机描述");
  await computerDescriptionInput.fill("Firefox isolated Computer profile");
  await computerDescriptionInput.press("Control+Enter");
  await page
    .locator(".rah-computer-detail", {
      hasText: "Firefox isolated Computer profile",
    })
    .waitFor();
  const computerSidebar = page.locator(".rah-computer-sidebar");
  const computerSeparator = page.locator(
    '.rah-computer-sidebar-resizer[role="separator"]',
  );
  assert.deepEqual(
    await computerSeparator.evaluate((element) => ({
      maximum: element.getAttribute("aria-valuemax"),
      minimum: element.getAttribute("aria-valuemin"),
      sidebarWidth: document
        .querySelector(".rah-computer-sidebar")
        ?.getBoundingClientRect().width,
      storedWidth: localStorage.getItem("rah:computer-sidebar-width"),
    })),
    {
      maximum: "520",
      minimum: "240",
      sidebarWidth: 320,
      storedWidth: null,
    },
  );
  await dragRoomSeparator(page, computerSeparator, 80);
  await page.waitForFunction(
    () =>
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 400 &&
      localStorage.getItem("rah:computer-sidebar-width") === "400",
  );
  await computerSeparator.focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(
    () =>
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 240,
  );
  await page.keyboard.press("End");
  await page.waitForFunction(
    () =>
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 520,
  );
  await page.keyboard.press("Home");
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForFunction(
    () =>
      document.querySelector(".rah-computer-sidebar")?.getBoundingClientRect()
        .width === 320 &&
      localStorage.getItem("rah:computer-sidebar-width") === "320",
  );
  const runtimeTrigger = page
    .locator(".rah-computer-runtime-chips > button")
    .first();
  await runtimeTrigger.hover();
  const runtimeInspector = page.locator(".rah-computer-runtime-inspector");
  await runtimeInspector.waitFor();
  assert.deepEqual(
    await runtimeInspector.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        fits: rectangle.left >= 8 && rectangle.right <= window.innerWidth - 8,
        width: rectangle.width,
      };
    }),
    { fits: true, width: 390 },
  );
  assert.match(
    (await runtimeInspector.textContent()) ?? "",
    /本机探测[\s\S]*Runtime Profile[\s\S]*不包含 Provider 账号配额或凭据/u,
  );
  await page.keyboard.press("Escape");
  await runtimeInspector.waitFor({ state: "detached" });
  assert.equal(
    await runtimeTrigger.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await runtimeTrigger.click();
  await runtimeInspector.waitFor();
  await page.locator(".rah-computer-detail-head").click();
  await runtimeInspector.waitFor({ state: "detached" });
  await page
    .locator(".rah-computer-diagnostics")
    .getByRole("button", { exact: true, name: "复制诊断信息" })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".rah-computer-diagnostics")
        ?.textContent?.includes("已复制") === true,
  );
  const copiedComputerDiagnostic = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  assert.doesNotMatch(
    copiedComputerDiagnostic,
    /participantId|runtimeProfileRevisionId|environment|token|secret/iu,
  );
  assert.equal(JSON.parse(copiedComputerDiagnostic).hostId.length > 0, true);
  const computerAgentButton = page
    .locator(".rah-computer-agent-list > button")
    .first();
  const computerAgentName =
    (await computerAgentButton.locator("b").textContent())?.trim() ?? "";
  assert.notEqual(computerAgentName, "");
  await computerAgentButton.click();
  await page.locator(".rah-agent-profile-pane").waitFor();
  assert.match(
    (await page.locator(".rah-agent-detail-head").textContent()) ?? "",
    new RegExp(computerAgentName, "u"),
  );
  assert.equal(new URL(page.url()).searchParams.get("surface"), "agents");
  await page.getByTitle("计算机").click();
  await page.locator(".rah-computer-detail h1").waitFor();
  assert.equal(
    await computerSidebar.evaluate(
      (node) => node.getBoundingClientRect().width,
    ),
    320,
  );
  await page.getByTitle("设置").click();
  await page.locator(".rah-settings-surface").waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    1_440,
  );
  const profileImageInput = page.locator(
    '.rah-settings-avatar-upload input[type="file"]',
  );
  assert.equal(
    await profileImageInput.getAttribute("accept"),
    "image/jpeg,image/png,image/gif,image/webp",
  );
  await profileImageInput.setInputFiles({
    buffer: profileImagePng,
    mimeType: "image/png",
    name: "profile.png",
  });
  const uploadedProfileImage = page.locator(
    ".rah-settings-avatar-upload .rah-profile-image-avatar",
  );
  await uploadedProfileImage.waitFor();
  assert.match(
    (await uploadedProfileImage.getAttribute("src")) ?? "",
    /^\/v3\/client\/profile-images\/content\/upload_png_[a-f0-9]{40}$/u,
  );

  await page.getByTitle("计算机").click();
  await page.locator(".rah-computer-detail h1").waitFor();

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
  assert.deepEqual(
    await page.evaluate(() => ({
      backVisible:
        (document.querySelector(".rah-computer-detail-back")?.getClientRects()
          .length ?? 0) > 0,
      detailVisible:
        (document.querySelector(".rah-computer-detail")?.getClientRects()
          .length ?? 0) > 0,
      listVisible:
        (document.querySelector(".rah-computer-sidebar")?.getClientRects()
          .length ?? 0) > 0,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    {
      backVisible: true,
      detailVisible: true,
      listVisible: false,
      scrollWidth: 390,
    },
  );
  await runtimeTrigger.click();
  const mobileRuntimeLayer = page.locator(
    ".rah-computer-runtime-inspector-layer",
  );
  await mobileRuntimeLayer.waitFor();
  assert.deepEqual(
    await page
      .locator(".rah-computer-runtime-inspector.is-mobile")
      .evaluate((element) => {
        const rectangle = element.getBoundingClientRect();
        return {
          bottom: rectangle.bottom,
          scrollWidth: document.documentElement.scrollWidth,
          width: rectangle.width,
        };
      }),
    { bottom: 844, scrollWidth: 390, width: 390 },
  );
  await page.keyboard.press("Escape");
  await mobileRuntimeLayer.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator(".rah-settings-mobile-index").waitFor();
  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  assert.deepEqual(
    await workspaceMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        fitsViewport: rect.left >= 0 && rect.right <= innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        width: rect.width,
      };
    }),
    { fitsViewport: true, scrollWidth: 390, width: 256 },
  );
  await page.keyboard.press("Escape");
  await workspaceMenu.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.querySelector(".rah-space-mark") === document.activeElement,
  );
  assert.equal(
    await workspaceTrigger.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await page.locator(".rah-settings-mobile-index").waitFor();
  await page
    .locator(".rah-settings-mobile-index")
    .getByRole("button", { name: "账户", exact: true })
    .click();
  await page.getByLabel("返回设置", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".rah-settings-mobile-index").isVisible(),
    false,
  );
  await page.getByLabel("返回设置", { exact: true }).click();
  await page.locator(".rah-settings-mobile-index").waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.locator(".channel-title h1").waitFor();
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
  await page.getByRole("button", { name: "关系图", exact: true }).click();
  await page.locator(".rah-member-graph-surface").waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  assert.equal(await page.locator(".rah-mobile-nav").isVisible(), false);
  await page.getByLabel("返回成员列表", { exact: true }).click();
  await page.locator(".rah-agent-sidebar-head").waitFor();
  assert.equal(await page.locator(".rah-mobile-nav").isVisible(), true);
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
        RAH_DATA_HOME: input.workbenchHome,
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

async function dragProfileSeparator(page, separator, deltaX) {
  const bounds = await separator.boundingBox();
  assert.notEqual(bounds, null);
  const startX = bounds.x + Math.max(5, bounds.width - 2);
  const y = bounds.y + Math.min(240, bounds.height / 2);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, y, { steps: 24 });
  await page.mouse.up();
}

async function dragRoomSeparator(page, separator, deltaX) {
  const bounds = await separator.boundingBox();
  assert.notEqual(bounds, null);
  const startX = bounds.x + bounds.width / 2;
  const y = bounds.y + Math.min(240, bounds.height / 2);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, y, { steps: 24 });
  await page.mouse.up();
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
