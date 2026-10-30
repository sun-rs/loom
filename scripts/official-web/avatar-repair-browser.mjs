import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
export async function verifyAvatarRepair({
  browser,
  origin,
  client,
  workspace,
  role,
  instances,
  channels,
  head,
}) {
  const output =
    process.env.LOOM_AVATAR_REPAIR_EVIDENCE ?? "/tmp/loom-avatar-repair";
  mkdirSync(output, { recursive: true });
  const frozen = (
    await client.request("role.list", {
      controlRoomId: workspace.controlRoomId,
    })
  ).instances.map(({ isCurrent, ...snapshot }) => snapshot);

  const frozenAgents = await Promise.all(
    instances.map(
      async (instance) =>
        (await client.request("agent.get", { agentId: instance.agentId })).agent
          .currentRevision,
    ),
  );
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
      }),
      page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      // Only message authorship is projected for the read fixture. No provider is invoked.
      await page.route("**/v3/client/rooms/timeline", async (route) => {
        const response = await route.fetch(),
          data = await response.json();
        for (const item of data.items ?? [])
          if (
            item.kind === "message" &&
            item.message.body === "FIXTURE avatar propagation"
          )
            item.message.actorId = instances[0].instanceId;
        await route.fulfill({ response, json: data });
      });
      let roleReads = 0;
      await page.route("**/v3/client/roles/list", async (route) => {
        roleReads++;
        await route.continue();
      });
      await page.goto(`${origin}/?view=agents&role=${role.roleId}`);
      const profile = page.getByTestId("loom-role-profile");
      await profile.waitFor();
      await profile
        .getByRole("button", { name: "更换头像", exact: true })
        .click();
      const dialog = page.getByTestId("role-avatar-dialog");
      await dialog.waitFor();
      const random = dialog.getByRole("button", {
        name: "随机头像",
        exact: true,
      });
      await random.waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="随机头像"]')?.disabled,
      );
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="role-avatar-dialog"]')
          ?.getAnimations()
          .every((a) => a.playState !== "running"),
      );
      const geometry = await dialog.boundingBox(),
        reads = roleReads;
      await dialog.evaluate((e) => {
        window.__avatarDialog = e;
        window.__avatarTiles = [
          ...e.querySelectorAll("[data-avatar-series] button"),
        ];
        window.__avatarBounds = [];
      });
      for (let n = 0; n < 5; n++) {
        await random.click();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const state = await dialog.evaluate((e) => ({
          same: e === window.__avatarDialog,
          tiles: [...e.querySelectorAll("[data-avatar-series] button")].every(
            (el, i) => el === window.__avatarTiles[i] && !el.disabled,
          ),
          bounds: e.getBoundingClientRect().toJSON(),
          status: [...e.querySelectorAll('[role="status"]')].filter(
            (el) => getComputedStyle(el).position !== "absolute",
          ).length,
        }));
        assert.ok(
          state.same && state.tiles,
          "random retains the dialog and enabled preset nodes",
        );
        assert.ok(
          Math.abs(state.bounds.height - geometry.height) < 1 &&
            Math.abs(state.bounds.y - geometry.y) < 1,
          "random never changes dialog height or position",
        );
        assert.equal(
          state.status,
          0,
          "no temporary status row changes modal geometry",
        );
      }
      const randomNetworkReads = roleReads - reads;
      assert.equal(
        randomNetworkReads,
        0,
        "random is local after the initial occupancy read",
      );
      await page.screenshot({ path: `${output}/picker-${width}.png` });
      const key = width === 1440 ? "owl" : "spider";
      const tile = dialog.getByRole("button", { name: key, exact: true });
      await tile.click();
      const src = await tile.locator("img").getAttribute("src");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await profile.locator(`img[src="${src}"]`).first().waitFor();
      const nav = page.getByTestId("left-rail-tab-channels");
      if (width === 1440) {
        await page.evaluate(() => {
          window.__avatarDocument = document;
        });
        await nav.click();
        await page
          .locator(`[data-public-channel-id="${channels[2].roomId}"]`)
          .click();
        assert.equal(
          await page.evaluate(() => window.__avatarDocument === document),
          true,
          "desktop verifies same-SPA identity refresh without reloading",
        );
      } else await page.goto(`${origin}/?room=${channels[2].roomId}`);
      const message = page
        .locator("[data-timeline-message-id]")
        .filter({ hasText: "FIXTURE avatar propagation" });
      await message.waitFor();
      await message.locator(`img[src="${src}"]`).waitFor();
      await page.getByTestId("loom-channel-control-trigger").click();
      const sheet = page.getByTestId("loom-channel-control-sheet");
      await page.waitForFunction(
        (src) =>
          [
            ...document.querySelectorAll(
              '[data-testid="channel-member-strip-inset"] [data-kind="agent"] img',
            ),
          ].length === 2 &&
          [
            ...document.querySelectorAll(
              '[data-testid="channel-member-strip-inset"] [data-kind="agent"] img',
            ),
          ].every((i) => i.getAttribute("src") === src),
        src,
      );
      await page.screenshot({ path: `${output}/channel-members-${width}.png` });
      await sheet.getByTestId("channel-overflow-members-entry").click();
      await sheet
        .getByTestId("member-page")
        .locator(`img[src="${src}"]`)
        .first()
        .waitFor();
      assert.deepEqual(
        (
          await client.request("role.list", {
            controlRoomId: workspace.controlRoomId,
          })
        ).instances.map(({ isCurrent, ...snapshot }) => snapshot),
        frozen,
        "visual change never adopts a new frozen execution revision",
      );
      assert.deepEqual(
        await Promise.all(
          instances.map(
            async (instance) =>
              (await client.request("agent.get", { agentId: instance.agentId }))
                .agent.currentRevision,
          ),
        ),
        frozenAgents,
        "Role visual changes preserve exact frozen Agent execution revisions",
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        randomStable: true,
        randomNetworkReads,
        dialogGeometry: geometry,
        channelAndRosterUpdated: true,
        sameSpa: width === 1440,
        frozenExecutionRevisionsUnchanged: true,
      });
    } finally {
      await context.close();
    }
  }
  writeFileSync(
    `${output}/browser.json`,
    JSON.stringify(
      {
        fixture:
          "isolated real Core, read-only fixture message author, no paid provider",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  return results;
}
