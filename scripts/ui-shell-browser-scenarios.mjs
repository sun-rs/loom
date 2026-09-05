import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { parseFixtureAnnouncement } from "./real-browser-gate-support.mjs";

// The existing fixture starts the real Kernel/daemon/application with isolated
// temporary state and fake provider binaries. No reference store is imported.
export async function startShellFixture() {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(
    process.execPath,
    ["scripts/run-multi-agent-web-fixture.mjs"],
    {
      env: {
        ...process.env,
        RAH_WEB_PORT: String(port),
        RAH_FIXTURE_HISTORY_MESSAGES: "5",
        RAH_FIXTURE_HOST_ID: `ui-shell-${process.pid}-${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const close = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  };
  try {
    for (let n = 0; n < 400; n++) {
      if (child.exitCode !== null) throw new Error(output);
      if (/^RAH_MULTI_AGENT_FIXTURE .*\n/m.test(output)) {
        const descriptor = parseFixtureAnnouncement(output);
        return { origin: descriptor.webOrigin, close };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Shell fixture did not start: ${output}`);
  } catch (error) {
    await close();
    throw error;
  }
}

export async function verifyIntegratedShell(page, origin, output, engine) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const roomHeader = page.locator(".rah-conversation-head");
  await page
    .getByRole("button", { name: "频道详情与设置", exact: true })
    .waitFor();
  await page
    .locator('textarea[aria-label="消息输入框"]:not(:disabled)')
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  const viewports = [
    [1440, 1000],
    [1440, 598],
    [1280, 598],
    [1279, 598],
    [1024, 598],
    [1023, 598],
    [768, 598],
    [767, 598],
    [701, 598],
    [700, 598],
    [390, 844],
  ];
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await roomHeader.waitFor({ state: "visible" });
    const header = await roomHeader.boundingBox();
    if (!header) {
      await page.screenshot({
        path: join(output, `${engine}-shell-failure-${width}.png`),
      });
      throw new Error(
        `Room header missing at ${width}×${height}; ${await page.locator(".channel > header").evaluateAll((es) => es.map((e) => e.outerHTML.slice(0, 250)))}`,
      );
    }
    const track = height <= 600 ? 48 : 62;
    assert.equal(header.height, track, `Room header at ${width}×${height}`);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    if (width > 767) {
      const rail = await page.locator(".rail-head").boundingBox();
      const sidebar = await page
        .locator(".rah-room-sidebar .sidebar-head")
        .boundingBox();
      assert.equal(
        rail.y + rail.height,
        header.y + header.height,
        "rail/header baseline",
      );
      assert.equal(
        sidebar.y + sidebar.height,
        header.y + header.height,
        "sidebar/header baseline",
      );
      assert.equal(
        (await page.locator(".rail").boundingBox()).width,
        height <= 600 ? 50 : 64,
      );
    }
    const tabs = page.getByRole("tablist", { name: "对话内容", exact: true });
    assert.equal(
      await tabs.evaluate(
        (e) => e.parentElement.getBoundingClientRect().height,
      ),
      30,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".rah-direct-room-row").first().click();
  await page.locator(".rah-direct-header-avatar").click();
  const peek = page.locator(".rah-agent-peek");
  const close = peek.getByRole("button", {
    name: "关闭 Agent 侧栏",
    exact: true,
  });
  await close.waitFor();
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const inspector = await peek.boundingBox();
    const head = await peek.locator(".rah-agent-detail-head").boundingBox();
    assert.equal(head.height, width <= 767 ? 76 : height <= 600 ? 48 : 62);
    if (width >= 1024) {
      const room = await roomHeader.boundingBox();
      assert.equal(
        head.y + head.height,
        room.y + room.height,
        "Room/inspector header dividers align",
      );
      assert.equal(inspector.width, 380);
      assert.equal(inspector.x, room.x + room.width);
    } else {
      assert.equal(inspector.x, 0);
      assert.equal(inspector.width, width);
    }
    assert.equal(
      await close.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
      true,
      "close action cannot be covered or clipped",
    );
    const list = peek.getByRole("tablist", { name: "Agent 详情" });
    await list.getByRole("tab", { name: "动态", exact: true }).focus();
    await page.keyboard.press("End");
    const mcp = list.getByRole("tab", { name: "MCP", exact: true });
    assert.equal(await mcp.getAttribute("aria-selected"), "false");
    assert.equal(await mcp.evaluate((e) => document.activeElement === e), true);
    await page.keyboard.press("Enter");
    assert.equal(await mcp.getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    if ([1440, 1024, 767, 390].includes(width))
      await page.screenshot({
        path: join(output, `${engine}-shell-${width}-${height}.png`),
      });
  }
  await close.click();
  await peek.waitFor({ state: "detached" });
  // A real Room tab callback must still select its canonical Files read view.
  const roomTabs = page.getByRole("tablist", { name: "对话内容", exact: true });
  await roomTabs.getByRole("tab", { name: "聊天", exact: true }).focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  assert.equal(
    await roomTabs
      .getByRole("tab", { name: "文件", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
}

// Production routes, not fixture copies. Only navigation/read actions are used.
export async function verifySurfaceHeaders(page, origin, output, engine) {
  const routes = [
    [
      "settings",
      "&settingsSection=notifications",
      ".rah-settings-page-head",
      ".rah-settings-navigation:not(.rah-settings-mobile-index) > header",
    ],
    ["room", "", ".rah-conversation-head", ".rah-room-sidebar .sidebar-head"],
    [
      "computers",
      "",
      ".rah-computer-detail-head",
      ".rah-computer-sidebar > header",
    ],
    ["agents", "", null, ".rah-agent-sidebar-head"],
    ["tasks", "", ".activity-head", null],
    ["activity", "", ".activity-head", null],
  ];
  for (const [surface, suffix, main, side] of routes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/?surface=${surface}${suffix}`, {
      waitUntil: "networkidle",
    });
    await page.locator(main ?? side).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of [
      [1440, 900],
      [1440, 598],
      [768, 598],
    ]) {
      await page.setViewportSize({ width, height });
      for (const selector of [main, side].filter(Boolean)) {
        const header = page.locator(selector);
        const bounds = await header.boundingBox();
        if (!bounds) {
          await page.screenshot({
            path: join(
              output,
              `${engine}-${surface}-${width}-header-failure.png`,
            ),
          });
          throw new Error(
            `${surface} ${selector} missing at ${width}x${height}: ${await header.evaluateAll((es) => es.map((e) => ({ html: e.outerHTML.slice(0, 350), display: getComputedStyle(e).display })))}; url=${page.url()}`,
          );
        }
        assert.equal(
          bounds.height,
          height <= 600 ? 48 : 62,
          `${surface} ${selector} ${width}x${height}`,
        );
        assert.equal(
          await header.evaluate((e) => getComputedStyle(e).borderBottomWidth),
          "2px",
        );
      }
    }
    if (main) {
      const tile = page.locator(`${main} .rah-panel-header-icon`);
      assert.equal(
        await tile.count(),
        1,
        `${surface} must use shared identity slot`,
      );
      assert.deepEqual(
        await tile.evaluate((e) => {
          const s = getComputedStyle(e);
          return [s.width, s.height, s.boxShadow];
        }),
        ["36px", "36px", "none"],
      );
    }
    await page.screenshot({
      path: join(output, `${engine}-${surface}-short-header.png`),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/?surface=settings&settingsSection=notifications`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(() => document.fonts.ready);
  const back = page.getByRole("button", { name: "返回设置", exact: true });
  await back.waitFor();
  assert.deepEqual(
    await back.evaluate((e) => {
      const r = e.getBoundingClientRect(),
        s = e.querySelector("svg");
      return [
        r.width,
        r.height,
        s.getBoundingClientRect().width,
        getComputedStyle(s).transform,
        e.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        ),
      ];
    }),
    [28, 28, 14, "none", true],
  );
  await back.click();
  await page
    .locator('.rah-settings-surface[data-mobile-index="true"]')
    .waitFor();
  await page
    .locator(".rah-settings-mobile-index")
    .getByRole("button", { name: "通知", exact: true })
    .click();
  await back.waitFor();
  // The newly mounted index/page can start a font after the back button exists.
  // Finish that load before reload; Firefox reports its cancellation as an error.
  await page.evaluate(() => document.fonts.ready);
  await page.reload();
  await back.waitFor();
  // Header geometry may be ready before notification diagnostics. Let the
  // status/error text mount before snapshot/navigation so its font is not aborted.
  await page.waitForFunction(
    () =>
      document.querySelector(".rah-settings-push-card .rah-count-badge")
        ?.textContent !== "正在检查",
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: join(output, `${engine}-settings-mobile-header.png`),
  });
}
