// Real temporary Core persistence; no mock SDK responses and no provider calls.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
export async function verifyNativeSidebar({
  browser,
  origin,
  workspace,
  channels,
  client,
}) {
  const out =
    process.env.LOOM_WEB123_INTERACTION_CORE_EVIDENCE ??
    "/tmp/loom-web123-interaction-core";
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      serviceWorkers: "allow",
    }),
    page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [],
    writes = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/sidebar/patch")) writes.push(r.postDataJSON());
  });
  const get = async () =>
    (
      await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      })
    ).preferences;
  const patch = async (value) =>
    client.request("sidebar.patch", {
      workspaceId: workspace.workspaceId,
      expectedVersion: (await get()).version,
      idempotencyKey: crypto.randomUUID(),
      patch: value,
    });
  async function until(check, message) {
    const end = Date.now() + 12000;
    while (!(await check())) {
      assert.ok(Date.now() < end, message);
      await page.waitForTimeout(40);
    }
  }
  const row = (id) =>
      page
        .locator(`[data-sidebar-channel-id="${id}"]`)
        .filter({ visible: true }),
    menu = () =>
      page
        .locator('[data-slot="context-menu-content"]')
        .filter({ visible: true });
  async function open() {
    await page.goto(origin + "/s/" + workspace.slug + "/");
    await row(channels[0].roomId).waitFor();
    await page.waitForTimeout(200);
  }
  try {
    await patch({
      pinned: [],
      channelOrder: channels.map((c) => "room:" + c.roomId),
      customSections: [
        { id: "work", name: "Work", sortMode: "manual", items: [] },
      ],
      sectionOrder: ["pinned", "custom:work", "channels", "dms"],
    });
    await open();
    const hint = page.getByTestId("sidebar-pinned-empty-hint");
    if (!(await hint.isVisible()))
      await page.getByTestId("sidebar-section-toggle-pinned").click();
    await hint.waitFor();
    await row(channels[0].roomId).click({ button: "right" });
    await menu().getByText("置顶", { exact: true }).click();
    await until(
      async () => (await get()).pinned.includes("room:" + channels[0].roomId),
      "native pin did not persist",
    );
    await open();
    const pinned = page.getByTestId("sidebar-section-block-pinned");
    await pinned
      .locator(`[data-sidebar-channel-id="${channels[0].roomId}"]`)
      .waitFor();
    const b = await row(channels[0].roomId).boundingBox();
    await page.mouse.move(b.x + 70, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 82, b.y + b.height / 2, { steps: 4 });
    await page.getByTestId("sidebar-drag-overlay").waitFor();
    const target = await page
      .locator('[data-sidebar-dnd-container="sidebar:container:custom:work"]')
      .boundingBox();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 22 },
    );
    await page.waitForTimeout(300);
    await page.mouse.up();
    await until(async () => {
      const p = await get();
      return (
        p.pinned.length === 0 &&
        p.customSections[0].items.includes("room:" + channels[0].roomId)
      );
    }, "real pointer move did not persist");
    await open();
    const work = page.getByTestId("sidebar-custom-section-work");
    await work
      .locator(`[data-sidebar-channel-id="${channels[0].roomId}"]`)
      .waitFor();
    await work
      .locator('[data-slot="sidebar-section-disclosure"]')
      .click({ button: "right" });
    await page
      .getByTestId("sidebar-section-context-menu-custom:work")
      .getByText("A-Z", { exact: true })
      .click();
    await until(
      async () => (await get()).customSections[0].sortMode === "az",
      "per-section sorting was lost",
    );
    // A concurrent accepted preference must never be overwritten by a stale view.
    const concurrent = await patch({ pinned: ["room:" + channels[2].roomId] });
    const count = writes.length;
    await row(channels[1].roomId).click({ button: "right" });
    await menu().getByText("置顶", { exact: true }).click();
    await pinned
      .locator(`[data-sidebar-channel-id="${channels[2].roomId}"]`)
      .waitFor();
    assert.equal(
      writes.length,
      count,
      "stale preflight must refuse before writing",
    );
    assert.deepEqual(await get(), concurrent.preferences);
    // Lose a real accepted response. The native UI must await explicit verification,
    // which replays the exact same key/payload instead of toggling or duplicating.
    let lost = false;
    await page.route("**/v3/client/sidebar/patch", async (route) => {
      if (lost) return route.continue();
      lost = true;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    });
    await row(channels[1].roomId).click({ button: "right" });
    await menu().getByText("置顶", { exact: true }).click();
    const verify = page
      .getByText("核实原请求", { exact: true })
      .filter({ visible: true });
    await verify.waitFor();
    const accepted = await get();
    assert.ok(accepted.pinned.includes("room:" + channels[1].roomId));
    assert.equal(lost, true);
    const frozen = writes.at(-1);
    await verify.click();
    await until(
      () => writes.length >= count + 2,
      "verification did not resend the frozen intent",
    );
    await until(
      async () => !(await verify.isVisible()),
      "native UI stayed pending after verification",
    );
    assert.deepEqual(writes.at(-1), frozen);
    assert.deepEqual(
      await get(),
      accepted,
      "verification duplicated an accepted preference mutation",
    );
    await open();
    await pinned
      .locator(`[data-sidebar-channel-id="${channels[1].roomId}"]`)
      .waitFor();
    await page.screenshot({ path: out + "/real-core-sidebar.png" });
    assert.deepEqual(errors, []);
    const report = {
      temporaryCore: true,
      fakeRuntime: true,
      paidCalls: 0,
      nativePin: true,
      nativePointerMove: true,
      refreshPersistence: true,
      customSortPersistence: true,
      staleViewRefused: true,
      unknownHeldAndExplicitlyVerified: true,
      exactIntentReplay: true,
      writes: writes.length,
      errors,
    };
    writeFileSync(out + "/report.json", JSON.stringify(report, null, 2) + "\n");
    return report;
  } catch (error) {
    await page.screenshot({ path: out + "/failure.png" });
    writeFileSync(
      out + "/failure.json",
      JSON.stringify(
        {
          error: error.stack,
          body: await page.locator("body").innerText(),
          errors,
          writes,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await context.close();
  }
}
