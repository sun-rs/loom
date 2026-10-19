import { verifyInspector } from "./inspector-browser.mjs";
import assert from "node:assert/strict";
export async function verifyMentions({
  browser,
  origin,
  client,
  channel,
  otherChannel,
  instance,
  name,
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
    try {
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`${origin}/?room=${channel.roomId}`);
      const composer = page.getByTestId("composer-textarea");
      await composer.waitFor();
      let sends = 0;
      page.on("request", (r) => {
        if (new URL(r.url()).pathname === "/v3/client/messages/post") sends++;
      });
      // Scope the keyboard candidate to the intended member; other slices may add peers.
      await composer.fill("@Fixture");
      await page
        .getByTestId("mention-autocomplete-popover")
        .getByText(name, { exact: true })
        .filter({ visible: true })
        .last()
        .waitFor()
        .catch(async (e) => {
          await page.screenshot({ path: "/tmp/loom-mentions-failure.png" });
          console.error(await page.locator("body").innerText());
          throw e;
        });
      assert.equal(
        await page.locator("[data-mention-avatar-badge-shell]").count(),
        0,
        "unknown execution state must not be shown as offline",
      );
      await page.screenshot({
        path: `/tmp/loom-mention-picker-${viewport.width}.png`,
        animations: "disabled",
      });
      if (viewport.width >= 768) {
        const row = page
          .getByTestId("mention-autocomplete-popover")
          .locator("[data-ac-index]")
          .filter({ has: page.getByText(name, { exact: true }) });
        const index = Number(await row.getAttribute("data-ac-index"));
        for (let i = 0; i < index; i++) await composer.press("ArrowDown");
        await composer.press("Enter");
      } else
        await page
          .getByTestId("mention-autocomplete-popover")
          .getByText(name, { exact: true })
          .filter({ visible: true })
          .last()
          .click();
      assert.equal(sends, 0, "candidate selection never sends");
      assert.ok((await composer.inputValue()).includes(`@${name}`));
      await composer.fill(`@${name} FIXTURE mention ${viewport.width}`);
      await composer.press("Enter");
      const body = `@${name} FIXTURE mention ${viewport.width}`;
      await page
        .getByText(body, { exact: true })
        .waitFor()
        .catch(async (error) => {
          await page.screenshot({ path: "/tmp/loom-message-send-failure.png" });
          console.error(await page.locator("body").innerText());
          throw error;
        });
      const message = (
        await client.request("message.list", {
          roomId: channel.roomId,
          limit: 50,
        })
      ).messages.find((m) => m.body === body);
      assert.ok(message);
      assert.ok(
        message.mentions.some((m) => m.principalId === instance.instanceId),
      );
      await page
        .locator('[data-testid^="message-sender-mention-"]')
        .first()
        .click();
      assert.equal(
        await composer.inputValue(),
        `@${(await client.request("principal.me", {})).principal.handle} `,
      );
      assert.equal(
        await composer.evaluate((el) => document.activeElement === el),
        true,
      );
      await composer.fill("");
      const avatar = page.locator('[data-avatar-kind="human"]').first();
      await avatar.hover();
      const profile = page.getByTestId("loom-message-profile");
      await profile.waitFor();
      const me = (await client.request("principal.me", {})).principal;
      assert.ok((await profile.innerText()).includes(`@${me.handle}`));
      assert.equal(
        await profile.locator('[data-slot="avatar-badge"]').count(),
        0,
      );
      await page.mouse.move(viewport.width - 2, 2);
      await profile.waitFor({ state: "hidden" });
      await composer.fill("@Fixture");
      const candidate = page
        .getByTestId("mention-autocomplete-popover")
        .getByText(name, { exact: true })
        .filter({ visible: true })
        .last();
      await candidate.waitFor();
      await page.route("**/v3/client/rooms/sync", (route) =>
        route.request().postDataJSON().roomId === channel.roomId
          ? route.abort()
          : route.continue(),
      );
      await page.getByRole("alert").waitFor();
      await candidate.waitFor({ state: "hidden" });
      await avatar.hover();
      await profile.waitFor();
      assert.ok((await profile.innerText()).includes("成员资料暂不可用"));
      assert.equal(
        (await profile.innerText()).includes(`@${me.handle}`),
        false,
        "failed member refresh must not retain stale hover identity",
      );
      await page.mouse.move(viewport.width - 2, 2);
      await profile.waitFor({ state: "hidden" });
      await page.unroute("**/v3/client/rooms/sync");
      await page.getByRole("alert").waitFor({ state: "hidden" });
      await candidate.waitFor();
      await composer.press("Escape");
      await candidate.waitFor({ state: "hidden" });
      await composer.fill("");
      await page.goto(`${origin}/?room=${otherChannel.roomId}`);
      await composer.waitFor();
      await page.getByTestId("loom-message-timeline").waitFor();
      await composer.fill("@Fixture");
      assert.equal(
        await page
          .getByTestId("mention-autocomplete-popover")
          .getByText(name, { exact: true })
          .filter({ visible: true })
          .count(),
        0,
        "other channel has no candidate leak",
      );
      await composer.fill("");
      // Presentation-only agent-author fixture: no Worker impersonation,
      // provider execution or durable message mutation. Keep this separate
      // from the real gateway human-author path above.
      await page.route("**/v3/client/rooms/timeline", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        for (const item of data.items ?? [])
          if (item.kind === "message")
            item.message.actorId = instance.instanceId;
        await route.fulfill({ response, json: data });
      });
      await page.goto(`${origin}/?room=${channel.roomId}`);
      await composer.waitFor();
      const agentAvatar = page.locator('[data-avatar-kind="agent"]').first();
      await agentAvatar.waitFor();
      await agentAvatar.getByTestId("message-instance-status").waitFor();
      assert.equal(
        await agentAvatar
          .getByTestId("message-instance-status")
          .getAttribute("data-state"),
        "idle",
        "disabled fixture has no active work; not a fabricated online claim",
      );
      await agentAvatar.hover();
      await profile.waitFor();
      assert.ok((await profile.innerText()).includes(`@${name}`));
      assert.equal((await profile.innerText()).includes("离线"), false);
      await page.screenshot({
        path: `/tmp/loom-message-profile-${viewport.width}.png`,
        animations: "disabled",
      });
      await page.mouse.move(viewport.width - 2, 2);
      await profile.waitFor({ state: "hidden" });
      await verifyInspector({
        client,
        agentId: instance.agentId,
        page,
        agentAvatar,
        composer,
        viewport,
        name,
        instanceId: instance.instanceId,
        roomId: channel.roomId,
      });
      results.push({
        humanProfileFromGateway: true,
        agentProfilePresentationFixture: true,
        blockedWorkResponseFixture: true,
        nativeHoverDismissal: true,
        unknownPresenceOmitted: true,
        viewport,
        canonicalMention: true,
        senderClickFocus: true,
        keyboardOrPointerSelection: true,
        membershipFailureClearsAndRecovers: true,
        channelIsolation: true,
        runUsagePartialAndUnknown: true,
        usageDialogEscapeKeepsInspector: true,
        trajectoryScopedPagedAndExpandable: true,
        runtimeEnableStopAgainstCore: true,
        runtimeLostResponseExactVerification: true,
        runtimeCancelNoMutation: true,
        runtimeIdentityAndConfigurationPreserved: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
