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
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        gap: style.gap,
        glyph: { height: glyphRect.height, width: glyphRect.width },
        height: rect.height,
        lineHeight: style.lineHeight,
        padding: style.padding,
        count: {
          family: countStyle.fontFamily,
          variant: countStyle.fontVariantNumeric,
        },
      };
    }),
    {
      backgroundColor: "color(srgb 0.996079 0.490196 0.658824 / 0.2)",
      borderRadius: "4px",
      gap: "4px",
      glyph: { height: 15, width: 15 },
      height: 20,
      lineHeight: "12px",
      padding: "0px 6px",
      count: {
        family: '"Space Mono", ui-monospace, monospace',
        variant: "tabular-nums",
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
  while ((await reactionChips.count()) > 0) {
    const before = await reactionChips.count();
    await reactionChips.first().click();
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll(".rah-message-reaction").length === expected,
      before - 1,
    );
  }
  await savedBadge.click();
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
  await page.getByRole("tab", { name: "聊天", exact: true }).click();
  await page.locator(".rah-agent-chat-pane").waitFor();
  assert.equal(
    await page.locator(".rah-agent-chat-room-list button").count(),
    2,
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
