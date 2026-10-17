import { openChannelWithHistory } from "./mobile-chat-browser.mjs";
// FIXTURE ONLY: temporary real Core, fake discovery, prewarm disabled; no provider execution.
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
export async function verifyInstanceCreation({
  browser,
  origin,
  client,
  workspace,
  channel,
  role,
}) {
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const before = (
      await client.request("role.list", {
        controlRoomId: workspace.controlRoomId,
      })
    ).instances.filter((i) => i.channelId === channel.roomId);
    await openChannelWithHistory(page, origin, channel.roomId);
    await page.getByRole("button", { name: "频道成员与状态" }).click();
    await page.route("**/v3/client/roles/list", (route) => route.abort());
    await page.getByRole("button", { name: "添加实例", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "重新读取角色" }).waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "添加到频道", exact: true })
        .isDisabled(),
      true,
    );
    await page.unroute("**/v3/client/roles/list");
    await dialog.getByRole("button", { name: "重新读取角色" }).click();
    await dialog
      .getByRole("button", { name: new RegExp(role.configuration.displayName) })
      .click();
    await page.screenshot({
      path: join(tmpdir(), `loom-official-add-instance-${viewport.width}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") === "频道成员与状态",
    );
    await page.getByRole("button", { name: "频道成员与状态" }).press("Enter");
    await page.getByRole("button", { name: "添加实例", exact: true }).click();
    await dialog
      .getByRole("button", { name: new RegExp(role.configuration.displayName) })
      .click();
    const calls = [];
    let lost = false;
    await page.route("**/v3/client/roles/instantiate", async (route) => {
      calls.push(route.request().postDataJSON());
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await dialog
      .getByRole("button", { name: "添加到频道", exact: true })
      .click();
    await dialog.getByRole("button", { name: "核实添加结果" }).waitFor();
    assert.equal(calls.length, 1);
    assert.equal(
      await dialog
        .getByRole("button", { name: "添加到频道", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await dialog.isVisible(),
      true,
      "unknown creation cannot be silently abandoned by Escape",
    );
    await page.goBack();
    await dialog.getByRole("button", { name: "核实添加结果" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].channelId, channel.roomId);
    assert.equal(calls[0].roleId, role.roleId);
    const after = (
      await client.request("role.list", {
        controlRoomId: workspace.controlRoomId,
      })
    ).instances.filter((i) => i.channelId === channel.roomId);
    assert.equal(after.length, before.length + 1);
    const added = after.find(
      (i) => !before.some((old) => old.instanceId === i.instanceId),
    );
    assert.equal(added.roleRevisionId, role.roleRevisionId);
    const snapshot = (
      await client.request("room.sync", {
        roomId: channel.roomId,
        consumerId: "instance-browser-check",
      })
    ).snapshot;
    const member = snapshot.members.find(
      (m) => m.principalId === added.instanceId,
    );
    assert.ok(member);
    await page.goto(`${origin}/?room=${channel.roomId}`);
    await page.reload();
    await page.getByRole("button", { name: "频道成员与状态" }).click();
    await page
      .getByRole("dialog")
      .getByText(member.displayName ?? member.handle, { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      existingRoleMayHaveMultipleInstances: true,
      unknownResultExactReplay: true,
      targetPreservedAcrossNavigation: true,
      exactlyOneNewInstance: true,
      frozenRoleRevision: true,
      reloadMembership: true,
      catalogReadFailureDisablesSubmitAndRecovers: true,
    });
    await context.close();
  }
  return results;
}
