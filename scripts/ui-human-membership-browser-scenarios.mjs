import assert from "node:assert/strict";
import { join } from "node:path";

// Uses the real App and canonical APIs of the explicitly disposable fixture.
// Synthetic replies below are read/transport fault injections, never success fixtures.
export async function verifyHumanMembershipInteractions({
  page,
  origin,
  workspace,
  humans,
  post,
  roleWrite,
  output,
  engine,
}) {
  const colleague = humans.find(
    (x) => x.principal.handle === "fixture-colleague",
  ).principal;
  const coowner = humans.find(
    (x) => x.principal.handle === "fixture-coowner",
  ).principal;
  const actor = humans.find((x) => x.principal.handle === "sun").principal;
  const panel = page.getByRole("region", { name: "Human 详情" });
  const edit = panel.getByRole("button", { name: "编辑角色", exact: true });
  const role = panel.locator(".rah-profile-role");
  const roleUrl = `${origin}/v3/client/rooms/members/role`;
  const directoryUrl = `${origin}/v3/client/workspaces/humans`;
  const openColleague = async () => {
    if ((await page.viewportSize()).width < 768)
      await panel
        .getByRole("button", { name: "返回成员列表", exact: true })
        .click();
    await page
      .locator(".rah-agent-human-section button")
      .filter({ hasText: "Fixture colleague /" })
      .click();
    await edit.waitFor();
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openColleague();
    assert.equal(
      (await panel.locator(".rah-panel-header").boundingBox()).height,
      62,
      "Human header retains the observed Raft 62px height at both viewports",
    );
    await edit.click();
    const select = panel.getByRole("combobox");
    assert.equal(
      await select.evaluate((e) => e === document.activeElement),
      true,
    );
    await select.selectOption("admin");
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "编辑角色",
    );
    await edit.click();
    await select.selectOption("admin");
    const saved = page.waitForResponse((r) => r.url() === roleUrl);
    await panel.getByRole("button", { name: "保存", exact: true }).click();
    assert.equal((await saved).status(), 200);
    await role.filter({ hasText: "管理员" }).waitFor();
    const canonical = await post("humans/profile", {
      workspaceId: workspace.workspaceId,
      principalId: colleague.principalId,
    });
    assert.equal(canonical.membership.role, "admin");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "编辑角色",
    );
    // An external canonical update must refresh a profile left open, no reload.
    await roleWrite(colleague.principalId, "member");
    await role.filter({ hasText: "成员" }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    await page.screenshot({
      path: join(output, `${engine}-human-role-${width}.png`),
    });
    const url = page.url();
    await page.reload({ waitUntil: "load" });
    await role.filter({ hasText: "成员" }).waitFor();
    assert.equal(page.url(), url);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Failed directory read is actionable and closes stale-authority editing.
  await edit.click();
  const failDirectory = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "fixture_unavailable",
          message: "Intentional directory outage",
        },
      }),
    });
  await page.route(directoryUrl, failDirectory);
  await page
    .getByRole("button", { name: "重试成员列表", exact: true })
    .waitFor();
  assert.equal(await edit.count(), 0);
  assert.equal(await panel.locator(".rah-profile-role-editor").count(), 0);
  await page.unroute(directoryUrl, failDirectory);
  await page.getByRole("button", { name: "重试成员列表", exact: true }).click();
  await edit.waitFor();

  // A failed late write belongs to its old subject. Its canonical operation
  // actually succeeded; the response is deliberately lost after acceptance.
  let release, accepted;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const reached = new Promise((resolve) => {
    accepted = resolve;
  });
  const delayedWrite = async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    accepted();
    await held;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "fixture_lost_receipt", message: "Old subject failure" },
      }),
    });
  };
  await page.route(roleUrl, delayedWrite);
  await edit.click();
  await panel.getByRole("combobox").selectOption("admin");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await reached;
  await page
    .locator(".rah-agent-human-section button")
    .filter({ hasText: "Fixture co-owner" })
    .click();
  await role.filter({ hasText: "所有者" }).waitFor();
  release();
  await page.waitForResponse((r) => r.url() === roleUrl && r.status() === 503);
  await page.unroute(roleUrl, delayedWrite);
  assert.equal(await panel.getByText("Old subject failure").count(), 0);
  assert.equal(
    (
      await post("humans/profile", {
        workspaceId: workspace.workspaceId,
        principalId: colleague.principalId,
      })
    ).membership.role,
    "admin",
  );
  await roleWrite(colleague.principalId, "member");
  await roleWrite(coowner.principalId, "member");
  await roleWrite(actor.principalId, "member", 409);
  assert.equal(
    (
      await post("humans/profile", {
        workspaceId: workspace.workspaceId,
        principalId: actor.principalId,
      })
    ).membership.role,
    "owner",
  );
  await roleWrite(coowner.principalId, "owner");
  await openColleague();
  // Human DM opens an idempotent canonical direct Room; no message/model call.
  const opened = page.waitForResponse((r) =>
    r.url().endsWith("/rooms/direct/open"),
  );
  await panel.getByRole("button", { name: "发送私信", exact: true }).click();
  const response = await opened;
  assert.equal(response.status(), 200);
  const direct = await response.json();
  assert.equal(direct.room.kind, "direct");
  const memberships = await post("rooms/members/list", {
    roomId: direct.room.roomId,
  });
  assert.deepEqual(
    memberships.memberships.map((x) => x.principalId).sort(),
    [actor.principalId, colleague.principalId].sort(),
  );
  await page.goto(`${origin}/?surface=agents`, { waitUntil: "load" });
  await openColleague();
}
