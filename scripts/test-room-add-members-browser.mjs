import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import {
  roleBrowserFixture,
  selectRoleChannel,
} from "./role-browser-fixture.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const f = await roleBrowserFixture(page, fixture);
  const role = await f.createRole("MemberFixture");
  let retiredRequests = 0;
  page.on("request", (r) => {
    if (
      /\/(agents\/provision|agents\/onboard|rooms\/members\/add)$/.test(r.url())
    )
      retiredRequests++;
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const room = await f.channel(`fake-members-${width}`);
    const requests = [];
    const replies = [];
    await page.route("**/v3/client/roles/instantiate", async (route) => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1 && width === 390) {
        await route.fulfill({
          status: 503,
          json: {
            error: { code: "unavailable", message: "Fake pre-commit failure" },
          },
        });
        return;
      }
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      replies.push(await response.json());
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await selectRoleChannel(page, fixture.origin, role, room);
    await page
      .getByRole("button", { name: "创建实例并打开频道", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "核实创建结果", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "核实创建结果", exact: true })
      .click();
    await expect(page.locator(".rah-conversation-head")).toBeVisible();
    assert.equal(requests.length, 2);
    assert.deepEqual(
      requests[0],
      requests[1],
      "exact frozen payload, basis and idempotency key",
    );
    const instances = (await f.catalog()).instances.filter(
      (i) => i.roleId === role.roleId && i.channelId === room.roomId,
    );
    assert.equal(instances.length, 1);
    assert.equal(replies.at(-1).deduplicated, width === 1440);
    await page.unroute("**/v3/client/roles/instantiate");
    await page
      .getByRole("button", { name: "频道详情与设置", exact: true })
      .click();
    await page.getByRole("button", { name: "管理成员", exact: true }).click();
    await expect(
      page.locator(".rah-member-row").filter({ hasText: "MemberFixture" }),
    ).toHaveCount(1);
    await selectRoleChannel(page, fixture.origin, role, room);
    await expect(
      page.getByRole("button", { name: "创建实例并打开频道", exact: true }),
    ).toBeEnabled();
    assert.equal(retiredRequests, 0);
    await page.screenshot({
      path: `/private/tmp/loom-role-members-${width}.png`,
    });
  }
  console.log(
    "PASS desktop lost committed response / mobile pre-commit failure: exact retry, one instance, visible member, Role reusable, no retired writes",
  );
} finally {
  await browser.close();
  await fixture.close();
}
