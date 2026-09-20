import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch();
try {
  const p = await b.newPage();
  const post = async (path, data) => {
    const r = await p.request.post(`${f.origin}/v3/client/${path}`, { data });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const head = async (roomId) =>
    (
      await post("rooms/sync", {
        roomId,
        consumerId: "search-prefix-fixture",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const room = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: "archived-reference-fixture",
      slug: "archived-reference-fixture",
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  await post("rooms/archive", {
    roomId: room.roomId,
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: crypto.randomUUID(),
  });
  const searchRequests = [];
  let replySearch;
  await p.route("**/v3/client/search", async (route) => {
    searchRequests.push(route.request().postDataJSON().query);
    if (route.request().postDataJSON().query?.startsWith("#")) {
      await new Promise((resolve) => {
        replySearch = resolve;
        setTimeout(resolve, 1500);
      });
    }
    await route.continue();
  });
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 844 });
    await p.goto(`${f.origin}/?room=${f.roomId}`);
    const composer = p.getByRole("textbox", {
      name: "消息输入框",
      exact: true,
    });
    await composer.fill("#archived");
    await expect(p.getByRole("option")).toContainText("已归档");
    await p.getByRole("option").click();
    await expect(composer).toHaveValue("#archived-reference-fixture ");
    await composer.fill("");
    await p.goto(`${f.origin}/?room=${f.roomId}&surface=search`);
    const input = p.getByRole("textbox", { name: "搜索频道、私信、消息" });
    await input.fill("@");
    const cards = p.locator(".rah-search-destination");
    await expect(cards.first()).toBeVisible();
    assert.equal(await p.getByRole("listbox").count(), 0);
    const titles = await cards.locator("b").allTextContents();
    assert.ok(titles.length >= 2);
    await input.fill("#");
    const archived = cards.filter({ hasText: "archived-reference-fixture" });
    await expect(archived).toBeVisible({ timeout: 700 });
    await expect(archived).toContainText("已归档");
    await p.waitForTimeout(300);
    assert.ok(
      !searchRequests.some((query) => ["@", "#"].includes(query?.trim())),
      "bare sigils must not issue message search",
    );
    await expect(p.locator(".rah-search-count")).toHaveText(
      `${await cards.count()} 条结果`,
    );
    await expect(p.locator(".rah-search-hit")).toHaveCount(0);
    await expect(
      p.getByRole("heading", { name: "消息", exact: true }),
    ).toHaveCount(0);

    await input.fill("#archived");
    await expect(cards).toHaveCount(1, { timeout: 700 });
    await p.screenshot({ path: `/tmp/search-prefix-${width}.png` });
    await expect.poll(() => searchRequests.includes("#archived")).toBe(true);
    await input.fill(" # ");
    replySearch?.();
    await p.waitForTimeout(1600);
    await expect(p.locator(".rah-search-hit")).toHaveCount(0);
    await expect(p.locator(".rah-search-count")).toHaveText(
      `${await cards.count()} 条结果`,
    );
    assert.ok(
      !searchRequests.some((query) => ["@", "#"].includes(query?.trim())),
    );
    await archived.click();
    await expect(
      p.getByText("archived-reference-fixture", { exact: true }).first(),
    ).toBeVisible();
  }
  console.log(
    "PASS real fixture archived composer reference and immediate search directory, no autocomplete popup in search, desktop/mobile",
  );
} finally {
  await b.close();
  await f.close();
}
