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
      const nav = page.locator('[data-slot="mobile-nav-root"]');
      await nav.waitFor();
      // Model the root height used by the official keyboard/visual viewport contract.
      if (preset === "brutal")
        await page.evaluate(() =>
          document.documentElement.style.setProperty("--vv-height", "560px"),
        );
      const rect = await nav.boundingBox();
      assert.ok(
        rect && rect.y + rect.height <= (preset === "brutal" ? 561 : 844),
        "bottom navigation must stay inside visual viewport",
      );
      await page.evaluate(() =>
        document.documentElement.style.removeProperty("--vv-height"),
      );
      assert.equal(await nav.getByRole("button").count(), 5);
      assert.equal(
        await page.getByTestId("mobile-bottom-bar-overlay").count(),
        1,
      );
      const centers = [];
      for (const button of await nav.getByRole("button").all()) {
        const geometry = await button.evaluate((el) => {
          const b = el.getBoundingClientRect(),
            i = el.querySelector("svg").getBoundingClientRect();
          return {
            dx: i.x + i.width / 2 - b.x - b.width / 2,
            dy: i.y + i.height / 2 - b.y - b.height / 2,
            center: i.x + i.width / 2,
            pseudo: getComputedStyle(el, "::before").display,
          };
        });
        assert.ok(
          Math.abs(geometry.dx) < 1 && Math.abs(geometry.dy) < 1,
          "icon centered in its touch target",
        );
        assert.equal(
          geometry.pseudo,
          "none",
          "icon-only navigation must not retain labeled-tab sticker",
        );
        centers.push(geometry.center);
        const box = await button.boundingBox();
        assert.ok(
          box && box.width >= 44 && box.x >= 0 && box.x + box.width <= 390,
        );
        assert.ok(
          await button.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        );
      }
      const steps = centers.slice(1).map((x, i) => x - centers[i]);
      assert.ok(
        Math.max(...steps) - Math.min(...steps) < 1,
        "equal icon spacing",
      );
      const rootHeaderColor = await page
        .locator("[data-loom-root-header]")
        .filter({ visible: true })
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      for (const label of ["任务", "Agent", "记忆", "设置", "首页"]) {
        await nav.getByRole("button", { name: label, exact: true }).tap();
        await nav.waitFor();
        await page
          .getByRole("heading", {
            name: label === "首页" ? "聊天" : label,
            exact: true,
          })
          .waitFor();
        const header = page
          .locator("[data-loom-root-header], [data-slot=panel-header]")
          .filter({ visible: true });
        await header.waitFor();
        assert.equal(
          (await header.boundingBox()).height,
          48,
          label + " uses the owner-approved compact root header",
        );
        assert.equal(
          await header.evaluate((el) => getComputedStyle(el).backgroundColor),
          rootHeaderColor,
          label + " uses the shared root header surface",
        );
        if (label === "首页") {
          for (const id of [
            "mobile-home-search-entry",
            "mobile-home-activity-entry",
            "sidebar-saved-entry",
          ]) {
            const row = page.getByTestId(id);
            assert.equal(
              (await row.boundingBox()).height,
              32,
              "native mobile home row",
            );
            assert.equal(
              await row
                .locator("svg")
                .first()
                .evaluate((el) => el.getBoundingClientRect().width),
              14,
            );
          }
          assert.equal(
            await page.getByText("暂无频道", { exact: true }).count(),
            0,
            "mobile hides empty sections without changing desktop preference",
          );
        }
        if (label === "任务") {
          const title = await header.getByRole("heading").boundingBox();
          const count = await header.locator("p").boundingBox();
          const frame = await header.boundingBox();
          assert.ok(
            Math.abs(title.x - frame.x - 16) < 1,
            "task title aligns to left content edge",
          );
          assert.ok(
            Math.abs(frame.x + frame.width - count.x - count.width - 16) < 1,
            "task count aligns to right content edge",
          );
          assert.ok(
            Math.abs(title.y + title.height / 2 - count.y - count.height / 2) <
              2,
            "task count shares title row",
          );
          const empty = page.locator('[data-slot="empty-state"]');
          await empty.waitFor();
          assert.equal(
            await empty.evaluate((el) => getComputedStyle(el).paddingTop),
            "24px",
          );
          assert.ok(
            (
              await empty
                .locator('[data-slot="empty-state-content"]')
                .boundingBox()
            ).width <= 280,
          );
        }
        if (label === "记忆") {
          const select = page.getByRole("combobox", {
            name: "频道",
            exact: true,
          });
          await select.waitFor();
          assert.deepEqual(
            await select.evaluate((el) => {
              const css = getComputedStyle(el);
              return [
                css.fontSize,
                css.lineHeight,
                el.getBoundingClientRect().height,
              ];
            }),
            ["13px", "18px", 32],
          );
          await select.tap();
          await page.getByRole("listbox").waitFor();
          await page.keyboard.press("Escape");
          await page.getByRole("listbox").waitFor({ state: "hidden" });
          assert.equal(
            await select.evaluate((el) => el === document.activeElement),
            true,
          );
        }
        assert.equal(
          Math.round((await nav.boundingBox()).height),
          50,
          "shared capsule height",
        );
      }
      for (const id of ["search", "activity"]) {
        await page.getByTestId("mobile-home-" + id + "-entry").tap();
        await nav.waitFor({ state: "hidden" });
        if (id === "search")
          await page.getByLabel("搜索内容", { exact: true }).waitFor();
        await page
          .getByRole("button", { name: "返回聊天列表", exact: true })
          .first()
          .tap();
        await nav.waitFor();
      }
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
      await nav.getByRole("button", { name: "Agent", exact: true }).tap();
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
      await nav.getByRole("button", { name: "设置", exact: true }).tap();
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
