import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium, expect } from "playwright/test";
import {
  classifyFormalBrowserRequest,
  parseFormalBrowserTarget,
} from "./formal-browser-request-policy.mjs";

const { origin, databasePath } = parseFormalBrowserTarget(process.env);
const database = new DatabaseSync(databasePath, { readOnly: true });
const snapshot = () =>
  database
    .prepare(
      "SELECT room_id, max(room_seq) seq FROM room_events GROUP BY room_id ORDER BY room_id",
    )
    .all();
const before = snapshot();
const output = mkdtempSync(join(tmpdir(), "rah-workspace-formal-"));
const browser = await chromium.launch();
const results = [];
const workspaceReads = new Set([
  "/v3/client/agents/workspace/list",
  "/v3/client/agents/workspace/read",
  "/v3/client/agents/workspace/roots",
]);
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const rejected = [],
      errors = [];
    await context.route("**/*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        url.origin === origin &&
        request.method() === "POST" &&
        workspaceReads.has(url.pathname)
      )
        return route.continue();
      const result = classifyFormalBrowserRequest({
        method: request.method(),
        origin,
        url: request.url(),
      });
      if (result.decision === "reject") {
        rejected.push(result.identity);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const post = async (path, data) => {
      const response = await context.request.post(
        `${origin}/v3/client/${path}`,
        { data, headers: { Origin: origin } },
      );
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const workspace = (await post("workspaces/list", {})).workspaces[0];
    const agents = (
      await post("agents/list", { controlRoomId: workspace.controlRoomId })
    ).agents;
    assert.ok(agents.length);
    const agentDefinitionId = agents[0].definition.agentDefinitionId;
    assert.deepEqual(
      (await post("agents/workspace/roots", { agentDefinitionId })).roots.map(
        (root) => root.rootId,
      ),
      ["agent-workspace"],
    );
    await page.goto(
      `${origin}/?surface=agents&agent=${encodeURIComponent(agentDefinitionId)}&agentTab=workspace`,
    );
    const pane = page.locator(".rah-workspace-browser");
    const file = pane.getByRole("treeitem", { name: "MEMORY.md", exact: true });
    await expect(file).toBeVisible({ timeout: 20000 });
    await expect(pane.getByRole("combobox")).toHaveCount(0);
    await expect(pane.locator("footer")).toHaveCount(0);
    assert.equal(
      await file.evaluate((e) => getComputedStyle(e).fontSize),
      "14px",
    );
    await page.screenshot({ path: join(output, `${width}-tree.png`) });
    await file.click();
    await expect(pane.locator(".rah-workspace-markdown")).not.toBeEmpty();
    await pane
      .getByRole("button", { name: "关闭文件预览", exact: true })
      .click();
    await expect(file).toBeVisible();
    await page.reload();
    await expect(file).toBeVisible();
    assert.deepEqual(rejected, []);
    assert.deepEqual(errors, []);
    results.push({ width, status: "passed" });
    await context.close();
  }
  assert.deepEqual(
    snapshot(),
    before,
    "Formal Room content must remain unchanged",
  );
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(output);
  await browser.close();
  database.close();
}
