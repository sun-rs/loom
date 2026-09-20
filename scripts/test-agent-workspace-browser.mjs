import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const output = mkdtempSync(join(tmpdir(), "rah-agent-workspace-"));
process.env.RAH_FIXTURE_WORKSPACE_FILES = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const page = await context.newPage();
    const errors = [],
      calls = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().includes("/agents/workspace/"))
        calls.push(request.postDataJSON());
      assert.ok(
        !request.url().includes("/agents/memory/"),
        "Workspace must not load retired memory management",
      );
    });
    const post = async (path, data) => {
      const response = await page.request.post(
        `${fixture.origin}/v3/client/${path}`,
        { data },
      );
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const workspace = (await post("workspaces/list", {})).workspaces[0];
    const agent = (
      await post("agents/list", { controlRoomId: workspace.controlRoomId })
    ).agents[0];
    const agentId = agent.definition.agentId;
    const url = `${fixture.origin}/?surface=agents&agent=${agentId}&agentTab=workspace`;
    await page.goto(url);
    const pane = page.locator(".rah-workspace-browser");
    const file = pane.getByRole("treeitem", { name: "MEMORY.md", exact: true });
    await expect(file).toBeVisible({ timeout: 20000 });
    await expect(pane.getByRole("combobox")).toHaveCount(0);
    await expect(pane.locator("footer")).toHaveCount(0);
    const roots = await post("agents/workspace/roots", { agentId });
    assert.deepEqual(
      roots.roots.map((root) => root.rootId),
      ["agent-workspace"],
    );
    for (const operation of ["list", "read"]) {
      const response = await page.request.post(
        `${fixture.origin}/v3/client/agents/workspace/${operation}`,
        {
          data: {
            agentId,
            rootId: "runtime-project",
            path: operation === "read" ? "README.md" : "",
          },
        },
      );
      assert.notEqual(
        response.status(),
        200,
        "Retired project root must be unavailable even to an old client",
      );
    }
    await page.evaluate(() => document.fonts.ready);
    const metrics = await pane.evaluate((element) => {
      const style = (selector) =>
        getComputedStyle(element.querySelector(selector));
      const rect = (selector) =>
        element.querySelector(selector).getBoundingClientRect();
      return {
        fileSize: style('[role="treeitem"]').fontSize,
        fileLine: style('[role="treeitem"]').lineHeight,
        titleSize: style("nav > header b").fontSize,
        titleColor: style("nav > header b").color,
        hiddenIcon: rect("button[aria-pressed] svg").width,
        refreshIcon: rect('button[aria-label="刷新"] svg').width,
        controlsAligned:
          Math.abs(
            rect("button[aria-pressed] svg").y +
              rect("button[aria-pressed] svg").height / 2 -
              rect('button[aria-label="刷新"] svg').y -
              rect('button[aria-label="刷新"] svg').height / 2,
          ) < 0.5,
        emptySize: style(".rah-workspace-empty").fontSize,
        emptyColor: style(".rah-workspace-empty").color,
      };
    });
    assert.equal(metrics.fileSize, "14px");
    assert.equal(metrics.fileLine, "20px");
    assert.equal(metrics.titleSize, "12px");
    assert.equal(metrics.titleColor, "rgba(0, 0, 0, 0.6)");
    assert.equal(metrics.hiddenIcon, 13);
    assert.equal(metrics.refreshIcon, 12);
    assert.equal(metrics.controlsAligned, true);
    assert.equal(metrics.emptySize, "14px");
    assert.equal(metrics.emptyColor, "rgba(0, 0, 0, 0.3)");
    await page.screenshot({ path: join(output, `${width}-tree.png`) });
    const folder = pane.getByRole("treeitem", { name: "notes", exact: true });
    await folder.click();
    await expect(folder).toHaveAttribute("aria-expanded", "true");
    await expect(
      folder.locator('use[href$="#raft-icon-folder-open"]'),
    ).toHaveCount(1);
    await pane.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(folder).toHaveAttribute("aria-expanded", "true");
    await file.click();
    await expect(
      pane.getByRole("group", { name: "工作区文件查看模式" }),
    ).toBeVisible();
    await pane.getByRole("button", { name: "源码", exact: true }).click();
    await expect(pane.locator("pre")).not.toBeEmpty();
    await page.screenshot({ path: join(output, `${width}-preview.png`) });
    await pane
      .getByRole("button", { name: "关闭文件预览", exact: true })
      .click();
    await expect(file).toBeVisible();
    await page.route("**/v3/client/agents/workspace/list", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "forbidden", message: "Isolated denied read" },
        }),
      }),
    );
    await pane.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(pane.getByRole("alert").first()).toBeVisible();
    await expect(file).toBeVisible();
    await page.unrouteAll();
    await pane.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(pane.getByRole("alert")).toHaveCount(0);
    await page.reload();
    await expect(file).toBeVisible();
    assert.ok(
      calls.every(
        (input) =>
          input.rootId === undefined || input.rootId === "agent-workspace",
      ),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    results.push({ width, metrics, status: "passed" });
    await context.close();
  }
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(output);
  await browser.close();
  await fixture.close();
}
