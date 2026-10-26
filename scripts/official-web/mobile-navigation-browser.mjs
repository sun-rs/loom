// Real Kernel/API/gateway with deterministic fixture messages; no paid CLI.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../../packages/application-service/src/index.ts";
import { LocalWorkbenchGateway } from "../../packages/daemon/src/local-workbench-gateway.ts";
import { roleInstanceFixture } from "../../packages/kernel/test/role-instance-fixture.ts";
const results = [];
for (const [width, preset] of [
  [390, "brutal"],
  [390, "elegant-light"],
  [1440, "brutal"],
]) {
  const f = roleInstanceFixture();
  let service, gateway, browser;
  try {
    service = new ClientApplicationService({
      human: createHumanApplicationPort(f.kernel),
      health: () => {
        throw Error("unused");
      },
    });
    await service.start();
    gateway = new LocalWorkbenchGateway({
      accessToken: f.owner.accessToken,
      daemonOrigin: service.origin,
      port: 0,
      sessionToken: "x".repeat(43),
      staticDirectory: resolve("frontends/raft/packages/web/dist-workbench"),
    });
    await gateway.start();
    browser = await (
      process.env.LOOM_BROWSER_ENGINE === "webkit" ? webkit : chromium
    ).launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      locale: "en-US",
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    await context.addInitScript(
      (preset) => localStorage.setItem("slock-theme-preset", preset),
      preset,
    );
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(gateway.origin + "/?view=settings&lang=en");
    await page.getByTestId("settings-sidebar-list").waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
    if (width === 390) {
      const nav = page.locator(".loom-mobile-nav-group");
      await nav.waitFor();
      for (const label of [
        "首页",
        "动态",
        "任务",
        "搜索",
        "工作区与更多页面",
      ]) {
        const button = nav.getByRole("button", { name: label, exact: true });
        const box = await button.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44);
        assert.ok(
          await button.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        );
      }
      for (const label of ["首页", "动态", "任务", "搜索"]) {
        await nav.getByRole("button", { name: label, exact: true }).tap();
        await nav.waitFor();
        if (label === "搜索")
          await page.getByLabel("搜索内容", { exact: true }).waitFor();
        else
          await page
            .getByRole("heading", {
              name: label === "首页" ? "聊天" : label,
              exact: true,
            })
            .waitFor();
      }
      for (const [label, heading] of [
        ["成员", "Agent"],
        ["计算机", "计算机"],
        ["设置", "设置"],
        ["记忆", "记忆"],
      ]) {
        await nav
          .getByRole("button", { name: "工作区与更多页面", exact: true })
          .tap();
        const menu = page.getByTestId("mobile-workspace-menu");
        await menu.getByRole("button", { name: label, exact: true }).tap();
        await menu.waitFor({ state: "hidden" });
        await page
          .getByRole("heading", { name: heading, exact: true })
          .waitFor();
      }
      await nav.getByRole("button", { name: "首页", exact: true }).tap();
      await page.locator(`[data-public-channel-id="${f.home.roomId}"]`).tap();
      await nav.waitFor({ state: "hidden" });
      await page.getByTestId("composer-textarea").waitFor();
      const back = page.getByRole("button", { name: "聊天列表", exact: true });
      assert.equal(
        (await back.boundingBox()).height,
        44,
        "native mobile header action occupies a44px cell",
      );
      assert.equal(
        await back.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(r.x + 2, r.y + r.height / 2),
          );
        }),
        true,
        "native 44px header cell remains clickable at its edge",
      );
      await back.tap();
      await nav.waitFor();
      await nav
        .getByRole("button", { name: "工作区与更多页面", exact: true })
        .tap();
      await page
        .getByTestId("mobile-workspace-menu")
        .getByRole("button", { name: "成员", exact: true })
        .tap();
      await page.getByPlaceholder("筛选角色").waitFor({ state: "visible" });
      await page.getByPlaceholder("筛选角色").focus();
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, "height", {
          configurable: true,
          value: 560,
        });
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue("--vv-height"),
        ),
        "560px",
      );
      await page.getByPlaceholder("筛选角色").blur();
      await page.evaluate(() => {
        delete window.visualViewport.height;
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue("--vv-height"),
        ),
        "",
      );
      await nav
        .getByRole("button", { name: "工作区与更多页面", exact: true })
        .tap();
      await page
        .getByTestId("mobile-workspace-menu")
        .getByRole("button", { name: "设置", exact: true })
        .tap();
      await page
        .getByTestId("settings-sidebar-list")
        .getByText("外观", { exact: true })
        .tap();
      await nav.waitFor({ state: "hidden" });
      const settingsBack = page.getByRole("button", {
        name: "设置列表",
        exact: true,
      });
      assert.ok(
        await settingsBack.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width >= 44 &&
            r.height >= 44 &&
            [
              [-21, 0],
              [21, 0],
              [0, -21],
              [0, 21],
            ].every(([x, y]) =>
              el.contains(
                document.elementFromPoint(
                  r.x + r.width / 2 + x,
                  r.y + r.height / 2 + y,
                ),
              ),
            )
          );
        }),
        "native rounded header action spans44px and accepts edge taps",
      );
      await page.getByRole("button", { name: "设置列表", exact: true }).tap();
      await nav.waitFor();
      await page.screenshot({ path: "/tmp/loom-mobile-navigation-after.png" });
    }
    if (width === 1440) {
      const nav = page.getByRole("navigation", { name: "主导航" });
      for (const label of ["任务", "Agent", "记忆", "设置"]) {
        await nav.getByRole("button", { name: label, exact: true }).click();
        await page
          .getByTestId(
            {
              任务: "loom-tasks-page",
              Agent: "loom-role-list",
              记忆: "loom-memory-list",
              设置: "settings-sidebar-list",
            }[label],
          )
          .waitFor();
      }
    }
    assert.equal(
      await page.getByText("语言与区域", { exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    results.push({ width, preset, navigation: true, chineseOnly: true });
  } finally {
    await browser?.close();
    await gateway?.stop();
    await service?.close();
    f.close();
  }
}
console.log(JSON.stringify(results, null, 2));
