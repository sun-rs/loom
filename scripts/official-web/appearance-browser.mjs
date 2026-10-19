import assert from "node:assert/strict";
export async function verifyAppearance({ browser, origin, channels }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(origin + "/?view=settings&settings=appearance");
      await page
        .getByTestId("appearance-theme-picker")
        .waitFor({ timeout: 3000 });
      await page.getByTestId("appearance-mode-light").click();
      await page.waitForFunction(
        () =>
          !document.documentElement.hasAttribute("data-theme") &&
          !document.documentElement.classList.contains("dark"),
      );
      await page.getByTestId("appearance-mode-dark").click();
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
      await page.reload();
      await page.waitForFunction(
        () =>
          !document.documentElement.hasAttribute("data-theme") &&
          document.documentElement.classList.contains("dark"),
      );
      await page.getByTestId("appearance-mode-system").click();
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(
        () => !document.documentElement.classList.contains("dark"),
      );
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
      await page.getByTestId("appearance-mode-light").click();
      await page.waitForFunction(
        () => !document.documentElement.hasAttribute("data-theme"),
      );
      if (process.env.LOOM_UI_SCREENSHOT_DIR)
        await page.screenshot({
          path:
            process.env.LOOM_UI_SCREENSHOT_DIR +
            "/appearance-" +
            width +
            ".png",
        });
      await page.getByTestId("message-font-size-lg").click();
      const preview = page.locator(
        '[aria-label="消息字号预览"] [data-slot="message-item-body"]',
      );
      assert.equal(
        await preview.evaluate((el) => getComputedStyle(el).fontSize),
        "18px",
      );
      await page.goto(origin + "/?room=" + channels[0].roomId);
      const body = page
        .locator('[data-timeline-message-id] [data-slot="message-item-body"]')
        .first();
      await body.waitFor();
      assert.equal(
        await body.evaluate((el) => getComputedStyle(el).fontSize),
        "18px",
      );
      await page.goto(origin + "/?view=settings&settings=appearance");
      await page.getByTestId("message-font-size-sm").click();
      assert.equal(
        await preview.evaluate((el) => getComputedStyle(el).fontSize),
        "14px",
      );
      await page.reload();
      assert.equal(
        await preview.evaluate((el) => getComputedStyle(el).fontSize),
        "14px",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: `/tmp/loom-appearance-${width}.png`,
        animations: "disabled",
      });
      const modelPreview = page.getByTestId(
        "message-sender-model-appearance-preview-message",
      );
      await modelPreview.waitFor();
      await page
        .getByRole("switch", { name: "显示 Agent 模型", exact: true })
        .click();
      await modelPreview.waitFor({ state: "detached" });
      await page
        .getByRole("switch", { name: "显示 Agent 模型", exact: true })
        .click();
      await modelPreview.waitFor();
      const hideEmpty = page.getByRole("switch", {
        name: "隐藏空的侧栏分区",
        exact: true,
      });
      if ((await hideEmpty.getAttribute("aria-checked")) !== "true")
        await hideEmpty.click();
      await page.goto(origin + "/?chat=list");
      const sidebar = page.getByTestId("public-server-channel-list");
      await sidebar.waitFor();
      assert.equal(await sidebar.getByText("置顶", { exact: true }).count(), 0);
      await page.goto(origin + "/?view=settings&settings=appearance");
      await page
        .getByRole("switch", { name: "隐藏空的侧栏分区", exact: true })
        .click();
      await page.goto(origin + "/?chat=list");
      await sidebar.getByText("置顶", { exact: true }).waitFor();
      let fixtureWorking = true;
      // UI-only status projection over a temporary Core; no fake-provider run or paid call.
      await page.route(
        "**/v3/client/rooms/agents/activity/list",
        async (route) => {
          try {
            const response = await route.fetch();
            const data = await response.json();
            if (route.request().postDataJSON().roomId === channels[2].roomId)
              for (const agent of data.agents)
                agent.state = fixtureWorking ? "working" : "idle";
            await route.fulfill({ json: data });
          } catch (error) {
            if (!/disposed|closed|abort|ERR_ABORTED/i.test(String(error)))
              throw error;
          }
        },
      );
      await page.goto(
        origin +
          "/?room=" +
          channels[2].roomId +
          (width === 390 ? "&chat=list" : ""),
      );
      const live = page
        .getByTestId("loom-live-agent-activity")
        .filter({ visible: true });
      await live.waitFor();
      await page.goto(
        origin +
          "/?view=settings&settings=appearance&room=" +
          channels[2].roomId,
      );
      await page
        .getByRole("switch", { name: "实时 Agent 动态", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("slock_show_live_agent_activity_bar"),
        ),
        "false",
      );
      await page.goto(
        origin +
          "/?room=" +
          channels[2].roomId +
          (width === 390 ? "&chat=list" : ""),
      );
      await sidebar.waitFor();
      assert.equal(await live.count(), 0);
      await page.goto(
        origin +
          "/?view=settings&settings=appearance&room=" +
          channels[2].roomId,
      );
      await page
        .getByRole("switch", { name: "实时 Agent 动态", exact: true })
        .click();
      await page.goto(
        origin +
          "/?room=" +
          channels[2].roomId +
          (width === 390 ? "&chat=list" : ""),
      );
      await live.waitFor();
      fixtureWorking = false;
      await page.reload();
      await sidebar.waitFor();
      assert.equal(await live.count(), 0);
      assert.deepEqual(errors, []);
      results.push({
        width,
        themes: true,
        systemMode: true,
        fontPreviewAndChat: true,
        persistence: true,
        modelToggle: true,
        emptySections: true,
        liveActivityToggle: true,
        noOverflow: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
