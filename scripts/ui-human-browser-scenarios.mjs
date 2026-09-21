import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyHumanProfile(browser, origin, output, engine) {
  const page = await browser.newPage();
  await page.addInitScript(() =>
    localStorage.setItem("rah:web-push-desired:v1", "disabled"),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (
      response.status() === 403 &&
      response.url().endsWith("/humans/profile") &&
      response.request().postDataJSON()?.principalId === "missing-principal"
    )
      return;
    errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Only the deliberate unknown-principal request is allowed to fail.
    if (
      message.location().url.endsWith("/humans/profile") &&
      /403/.test(message.text()) &&
      new URL(page.url()).searchParams.get("human") === "missing-principal"
    )
      return;
    errors.push(`${message.text()} ${message.location().url}`);
  });
  let directMutations = 0;
  const observe = (request) => {
    if (request.method() === "POST" && /rooms\/direct/.test(request.url()))
      directMutations++;
  };
  page.on("request", observe);
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`${origin}/?surface=agents`, {
        waitUntil: "load",
      });
      // A fresh mobile root is a list, not the previous Agent detail.
      const human = page.locator(".rah-agent-human-section button");
      await human.waitFor();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/humans/profile") &&
          r.request().method() === "POST",
      );
      await human.focus();
      await page.keyboard.press("Enter");
      const data = await (await response).json();
      const panel = page.getByRole("region", { name: "Human 详情" });
      await panel.getByText("加入时间", { exact: true }).waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("human"),
        data.principal.principalId,
      );
      const name = data.principal.displayName || data.principal.handle;
      assert.equal(
        await panel.locator(".rah-profile-identity h2").textContent(),
        name,
      );
      assert.equal(await human.getAttribute("aria-current"), "page");
      assert.equal(
        await panel.locator(".rah-entity-card").count(),
        data.createdAgentDefinitionIds.length,
      );
      assert.equal(
        await panel.getByRole("button", { name: /发消息/ }).count(),
        0,
        "viewing self does not create a self-DM",
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      const section = panel.locator(".rah-profile-section").first();
      assert.deepEqual(
        await section.evaluate((e) => {
          const s = getComputedStyle(e);
          return [s.paddingTop, s.paddingLeft, s.borderTopWidth];
        }),
        ["16px", "20px", "1px"],
      );
      if (width === 1440) {
        const header = await panel.locator("header").boundingBox();
        const sidebar = await page
          .locator(".rah-agent-sidebar-head")
          .boundingBox();
        assert.equal(header.y + header.height, sidebar.y + sidebar.height);
      }
      await page.screenshot({
        path: join(output, `${engine}-human-${width}.png`),
      });
      await page.reload({ waitUntil: "load" });
      await panel.getByText("加入时间", { exact: true }).waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("human"),
        data.principal.principalId,
      );
      const first = panel.locator(".rah-entity-card").first();
      if (await first.count()) {
        const childName = await first
          .locator(".rah-entity-card-name")
          .textContent();
        await first.click();
        await page.waitForFunction(
          (name) =>
            document.querySelector(".rah-agent-detail-identity h2")
              ?.textContent === name,
          childName,
        );
        assert.equal(new URL(page.url()).searchParams.get("human"), null);
      }
      await page.goto(
        `${origin}/?surface=agents&memberView=human&human=missing-principal`,
        { waitUntil: "load" },
      );
      await panel.getByRole("alert").waitFor();
      const retry = panel.getByRole("button", { name: "重试", exact: true });
      assert.equal(
        await (
          await page.waitForFunction(() => {
            const retry = [
              ...document.querySelectorAll('[aria-label="Human 详情"] button'),
            ].find((button) => button.textContent.trim() === "重试");
            // A catalog refresh may replace the denied-state node between locator
            // resolution and evaluation. Measure the current connected node.
            if (!retry?.isConnected) return false;
            const border = getComputedStyle(retry).borderTopWidth;
            return border === "2px" ? border : false;
          })
        ).jsonValue(),
        "2px",
        "profile retry uses the maintained button, not an unstyled settings alias",
      );
      const retried = page.waitForResponse(
        (r) => r.url().endsWith("/humans/profile") && r.status() === 403,
      );
      await retry.click();
      await retried;
      await panel.getByRole("alert").waitFor();
      assert.equal(
        await panel.locator(".rah-profile-identity").count(),
        0,
        "denied identity does not reuse the previous profile",
      );
      assert.equal(
        await panel.getByText("暂无已创建的 Agent", { exact: true }).count(),
        0,
      );
      await page.screenshot({
        path: join(output, `${engine}-human-denied-${width}.png`),
      });
      if (width === 390) {
        await panel
          .getByRole("button", { name: "返回成员列表", exact: true })
          .click();
        await human.waitFor({ state: "visible" });
        assert.equal(new URL(page.url()).searchParams.get("human"), null);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/?surface=agents`, { waitUntil: "load" });
    let release;
    let started;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const pending = new Promise((resolve) => {
      started = resolve;
    });
    await page.route("**/humans/profile", async (route) => {
      const response = await route.fetch();
      started();
      await held;
      try {
        await route.fulfill({ response });
      } catch {
        /* request was aborted on navigation */
      }
    });
    await page.locator(".rah-agent-human-section button").click();
    await pending;
    await page.getByRole("status").filter({ hasText: "加载中" }).waitFor();
    const agentRow = page
      .locator(
        ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
      )
      .first();
    const agentName = await agentRow.locator("b").textContent();
    await agentRow.click();
    release();
    await page.unroute("**/humans/profile");
    await page.waitForFunction(
      (name) =>
        document.querySelector(".rah-agent-detail-identity h2")?.textContent ===
        name,
      agentName,
    );
    assert.equal(
      await page.getByRole("region", { name: "Human 详情" }).count(),
      0,
      "late Human lookup cannot navigate back from another entity",
    );
    assert.equal(directMutations, 0);
    assert.deepEqual(errors, []);
  } finally {
    page.off("request", observe);
    await page.close();
  }
}
