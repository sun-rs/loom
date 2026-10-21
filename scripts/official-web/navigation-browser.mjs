import { openFullSearch } from "./topbar-browser.mjs";
import { showChatList, openChatRow } from "./mobile-chat-browser.mjs";
// FIXTURE ONLY: real temporary Core; navigation performs no provider execution.
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
export async function verifyGlobalNavigation({ browser, origin, channel }) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${origin}/?room=${channel.roomId}`);
    const nav = page.getByRole("navigation", { name: "主导航" });
    await showChatList(page);
    await nav.waitFor();
    if (viewport.width < 768) await openChatRow(page, channel.roomId);
    await page
      .getByTestId("composer-textarea")
      .fill("FIXTURE unsent navigation draft");
    await showChatList(page);
    for (const [id, label] of [
      ["search", "搜索"],
      ["agents", "Agent"],
      ["tasks", "任务"],
      ["activity", "动态"],
      ["settings", "设置"],
    ]) {
      if (viewport.width < 768 && !(await nav.isVisible())) {
        const view = new URL(page.url()).searchParams.get("view");
        const backName = view === "agents" ? "角色列表" : "返回聊天列表";
        await page.getByRole("button", { name: backName, exact: true }).click();
      }
      if (id === "search") {
        if (viewport.width < 768)
          await nav.getByRole("button", { name: "首页", exact: true }).click();
        await openFullSearch(page);
      } else if (id === "activity" && viewport.width < 768) {
        await nav.getByRole("button", { name: "首页", exact: true }).click();
        await page.getByTestId("mobile-home-activity-entry").click();
      } else {
        await nav.getByRole("button", { name: label, exact: true }).click();
        if (id === "settings" && viewport.width >= 768) {
          await page.getByTestId("settings-sidebar-list").waitFor();
          assert.equal(
            await page.getByTestId("settings-sidebar-header").count(),
            0,
          );
          await page.getByTestId("loom-settings-detail").waitFor();
        } else if (id === "agents") {
          await page.getByTestId("loom-agent-page").waitFor();
          await page
            .getByRole("button", { name: "新建角色", exact: true })
            .waitFor();
        } else {
          await page
            .getByRole("heading", { name: label, exact: true })
            .waitFor();
        }
      }
      assert.equal(new URL(page.url()).searchParams.get("view"), id);
      if (id !== "search" && !(id === "activity" && viewport.width < 768))
        assert.equal(
          await nav
            .getByRole("button", { name: label, exact: true })
            .getAttribute("aria-current"),
          "page",
        );
      if (id === "agents")
        await page
          .getByRole("button", { name: "新建角色", exact: true })
          .waitFor();
      else if (id === "search")
        await page.getByLabel("搜索内容", { exact: true }).waitFor();
      else if (id === "activity")
        await page.getByLabel("筛选收件箱", { exact: true }).waitFor();
      else if (id === "settings")
        await page.getByTestId("settings-sidebar-list").waitFor();
      else if (id === "tasks") {
        await page.getByTestId("loom-tasks-page").waitFor();
        await page.getByTestId("channel-task-view-board").waitFor();
        assert.equal(
          await page.getByTestId("composer-textarea").isVisible(),
          false,
        );
      }
    }
    await nav
      .getByRole("button", {
        name: viewport.width < 768 ? "首页" : "频道",
        exact: true,
      })
      .click();
    if (viewport.width < 768) await openChatRow(page, channel.roomId);
    await page.getByTestId("composer-textarea").waitFor({ state: "visible" });
    assert.equal(
      await page.getByTestId("composer-textarea").inputValue(),
      "FIXTURE unsent navigation draft",
    );
    assert.equal(new URL(page.url()).searchParams.get("room"), channel.roomId);
    await page.mouse.move(viewport.width - 12, 100);
    await page.screenshot({
      path: join(tmpdir(), `loom-official-shell-channel-${viewport.width}.png`),
      animations: "disabled",
    });
    await showChatList(page);
    await nav.getByRole("button", { name: "Agent", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("loom-agent-page").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("view"), "agents");
    await page.reload();
    await page.getByTestId("loom-agent-page").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("view"), "agents");
    await page.mouse.move(viewport.width - 12, 100);
    await page.screenshot({
      path: join(tmpdir(), `loom-official-shell-agents-${viewport.width}.png`),
      animations: "disabled",
    });
    await nav.getByRole("button", { name: "任务", exact: true }).click();
    await page.goBack();
    await page.getByTestId("loom-agent-page").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("view"), "agents");
    await page.goForward();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    for (const label of viewport.width < 768
      ? ["首页", "任务", "Agent", "记忆", "设置"]
      : ["频道", "动态", "任务", "Agent", "记忆", "设置"]) {
      const b = await nav
        .getByRole("button", { name: label, exact: true })
        .boundingBox();
      assert.ok(
        b &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= viewport.width &&
          b.y + b.height <= viewport.height,
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    results.push({
      viewport,
      destinationsViaNativeEntries: true,
      urlReloadAndBackForward: true,
      keyboardNavigation: true,
      channelDraftPreservedAcrossPages: true,
      visiblePointerTargets: true,
      noHorizontalOverflow: true,
      externalRequests: 0,
    });
    await context.close();
  }
  return results;
}
