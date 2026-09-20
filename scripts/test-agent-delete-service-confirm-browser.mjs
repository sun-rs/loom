import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const fixture = await startShellFixture();
const browser = await chromium.launch({ headless: true });
const failures = [];
async function check(name, run) {
  try {
    await run();
    console.log("PASS", name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error("FAIL", name, error.message);
  }
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(6000);
  await check("Raft Agent delete confirmation geometry", async () => {
    const workspace = (
      await (
        await page.request.post(`${fixture.origin}/v3/client/workspaces/list`, {
          data: {},
        })
      ).json()
    ).workspaces[0];
    const agent = (
      await (
        await page.request.post(`${fixture.origin}/v3/client/agents/list`, {
          data: { controlRoomId: workspace.controlRoomId },
        })
      ).json()
    ).agents[0];
    await page.goto(
      `${fixture.origin}/?surface=agents&agent=${agent.definition.agentId}&agentTab=profile`,
    );
    await page.getByRole("button", { name: "删除 Agent", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "删除 Agent",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    assert.equal((await dialog.boundingBox()).width, 384);
    if (process.platform === "darwin") {
      assert.ok(
        Math.abs(
          (await dialog.locator("h2").boundingBox()).width - 100.9609375,
        ) < 0.05,
        "matches live Raft title glyph metrics",
      );
      assert.ok(
        Math.abs(
          (
            await dialog
              .getByRole("button", { name: "删除 Agent", exact: true })
              .boundingBox()
          ).width - 86.9765625,
        ) < 0.05,
        "matches live Raft action glyph metrics",
      );
    }
    assert.match(
      await dialog.evaluate((el) => getComputedStyle(el).boxShadow),
      /4px 4px 0px/,
    );
    const paragraph = await dialog
      .locator(":scope > p")
      .first()
      .evaluate((el) => ({
        size: getComputedStyle(el).fontSize,
        line: getComputedStyle(el).lineHeight,
        margin: getComputedStyle(el).marginBottom,
      }));
    assert.deepEqual(paragraph, {
      size: "14px",
      line: "22.75px",
      margin: "20px",
    });
    assert.equal(
      await dialog.evaluate((el) => getComputedStyle(el).padding),
      "24px",
    );
    assert.equal(
      await dialog
        .locator("header")
        .evaluate((el) => getComputedStyle(el).borderBottomWidth),
      "0px",
    );
    const close = dialog.getByRole("button", { name: "关闭", exact: true });
    assert.equal((await close.boundingBox()).width, 32);
    assert.equal((await close.locator("svg").boundingBox()).width, 20);
    assert.equal(
      (
        await dialog
          .getByRole("button", { name: "取消", exact: true })
          .boundingBox()
      ).height,
      28,
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "取消", exact: true })
        .evaluate((el) => getComputedStyle(el).lineHeight),
      "12px",
    );
    await expect(
      dialog.getByRole("button", { name: "删除 Agent", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: "/tmp/rah-agent-delete-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal((await dialog.boundingBox()).width, 358);
    await page.screenshot({ path: "/tmp/rah-agent-delete-mobile.png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
  await check("Raft Agent inspector 28px close with 14px SVG", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
    await page
      .locator('[data-message-id] button[aria-label="查看 sun 资料"]')
      .first()
      .click();
    await page
      .getByRole("main", { name: "Human 详情侧栏" })
      .getByRole("button", { name: /^打开 .* Agent 资料$/ })
      .first()
      .click();
    const close = page.getByRole("button", {
      name: "关闭 Agent 侧栏",
      exact: true,
    });
    assert.equal((await close.boundingBox()).width, 28);
    assert.equal(await close.locator("svg").count(), 1);
    assert.equal((await close.locator("svg").boundingBox()).width, 14);
    await close.click();
    await expect(
      page.getByRole("main", { name: "Agent 详情侧栏" }),
    ).toBeHidden();
  });
  await check(
    "Service restart requires confirmation and reports inline",
    async () => {
      let generation = "fixture-before",
        posts = 0;
      await page.route("**/_rah/service", (route) =>
        route.fulfill({
          json: { available: true, state: "online", generation },
        }),
      );
      await page.route("**/_rah/service/restart", (route) => {
        posts++;
        generation = "fixture-after";
        return route.fulfill({ status: 202, json: { result: "accepted" } });
      });
      await page.goto(`${fixture.origin}/?surface=computers`);
      const button = page.getByRole("button", {
        name: "重启服务",
        exact: true,
      });
      await expect(button).toBeEnabled();
      await button.click();
      const dialog = page.getByRole("dialog", {
        name: "重启服务",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      assert.equal(posts, 0);
      await expect
        .poll(() =>
          dialog.locator("header svg").evaluate((el) => el.getBBox().width),
        )
        .toBeGreaterThan(0);
      assert.equal((await dialog.boundingBox()).width, 384);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(dialog).toBeHidden();
      assert.equal(posts, 0);
      await expect(button).toBeFocused();
      await button.click();
      await page.keyboard.press("Escape");
      assert.equal(posts, 0);
      await button.click();
      await expect
        .poll(() =>
          dialog.locator("header svg").evaluate((el) => el.getBBox().width),
        )
        .toBeGreaterThan(0);
      await page.screenshot({ path: "/tmp/rah-service-restart-confirm.png" });
      await dialog
        .getByRole("button", { name: "重启服务", exact: true })
        .click();
      const status = page.getByText("服务已重启，连接已恢复", { exact: true });
      await expect(status).toBeVisible();
      assert.equal(posts, 1);
      const a = await button.boundingBox(),
        b = await status.boundingBox();
      assert.ok(
        b.x >= a.x + a.width + 12,
        "status clears button by at least 12px",
      );
      assert.ok(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) < 2);
      assert.equal(
        await status.evaluate((el) => getComputedStyle(el).color),
        "rgba(0, 0, 0, 0.5)",
      );
      await page.screenshot({ path: "/tmp/rah-service-restart-status.png" });
    },
  );

  await check(
    "delete pending and error chrome retains retry and cancellation",
    async () => {
      const workspace = (
        await (
          await page.request.post(
            `${fixture.origin}/v3/client/workspaces/list`,
            { data: {} },
          )
        ).json()
      ).workspaces[0];
      const agent = (
        await (
          await page.request.post(`${fixture.origin}/v3/client/agents/list`, {
            data: { controlRoomId: workspace.controlRoomId },
          })
        ).json()
      ).agents[0];
      await page.goto(
        `${fixture.origin}/?surface=agents&agent=${agent.definition.agentId}&agentTab=profile`,
      );
      await page
        .getByRole("button", { name: "删除 Agent", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "删除 Agent",
        exact: true,
      });
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/agents/manage", async (route) => {
        await Promise.race([
          held,
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "fixture_failure",
              message: "Fixture deletion failure",
            },
          }),
        });
      });
      await dialog
        .getByRole("button", { name: "删除 Agent", exact: true })
        .click();
      await expect(dialog).toHaveAttribute("aria-busy", "true");
      await expect(dialog.getByRole("status")).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "取消", exact: true }),
      ).toHaveCSS("opacity", "0.3");
      await expect(dialog.locator("footer button").last()).toHaveCSS(
        "opacity",
        "0.8",
      );
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      release();
      await expect(dialog.getByRole("alert")).toBeVisible();
      assert.equal(
        await dialog
          .getByRole("alert")
          .evaluate((el) => getComputedStyle(el).padding),
        "12px",
      );
      await expect(
        dialog.getByRole("button", { name: "删除 Agent", exact: true }),
      ).toBeEnabled();
      await page.unroute("**/agents/manage");
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(dialog).toBeHidden();
    },
  );
  await check(
    "one confirmation deletes an enabled fixture Agent through the real endpoint",
    async () => {
      const workspace = (
        await (
          await page.request.post(
            `${fixture.origin}/v3/client/workspaces/list`,
            { data: {} },
          )
        ).json()
      ).workspaces[0];
      const agents = (
        await (
          await page.request.post(`${fixture.origin}/v3/client/agents/list`, {
            data: { controlRoomId: workspace.controlRoomId },
          })
        ).json()
      ).agents;
      const agent = agents.find((a) => a.definition.state === "enabled");
      assert.ok(agent);
      await page.goto(
        `${fixture.origin}/?surface=agents&agent=${agent.definition.agentId}&agentTab=profile`,
      );
      await page
        .getByRole("button", { name: "删除 Agent", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "删除 Agent",
        exact: true,
      });
      const commands = [];
      const capture = (request) => {
        if (request.url().endsWith("/agents/manage"))
          commands.push(request.postDataJSON());
      };
      page.on("request", capture);
      await dialog
        .getByRole("button", { name: "删除 Agent", exact: true })
        .click();
      await expect(dialog).toBeHidden({ timeout: 35000 });
      page.off("request", capture);
      assert.deepEqual(
        commands.map((c) => c.state),
        ["tombstoned"],
      );
      await page.reload();
      const after = (
        await (
          await page.request.post(`${fixture.origin}/v3/client/agents/list`, {
            data: { controlRoomId: workspace.controlRoomId },
          })
        ).json()
      ).agents;
      assert.equal(
        after.some((a) => a.definition.agentId === agent.definition.agentId),
        false,
      );
    },
  );
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
