import assert from "node:assert/strict";
export async function verifyPersistentPreferences({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const { room } = await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "pref-room-" + width,
      kind: "channel",
      name: "FIXTURE preferences " + width,
      slug: "pref-" + width,
    });
    await client.request("message.post", {
      roomId: room.roomId,
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: "long-" + width,
      body:
        "FIXTURE long message\n\n" +
        Array.from(
          { length: 60 },
          (_, i) => `Paragraph ${i}: bounded native folding test.`,
        ).join("\n\n"),
      recipients: [],
    });
    const context = await browser.newContext({
        viewport: { width, height: 844 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(origin + "/?room=" + room.roomId);
      const collapsed = page
        .getByTestId("loom-message-timeline")
        .locator("[data-message-collapsed]");
      await collapsed.waitFor();
      await page.waitForFunction(
        () =>
          document
            .querySelector("[data-message-collapsed]")
            ?.getAttribute("data-message-collapsed") === "true",
      );
      await page.getByTestId("loom-channel-control-trigger").click();
      const sheet = page.getByTestId("loom-channel-control-sheet");
      const toggle = sheet.getByTestId("channel-settings-collapse-switch");
      await toggle.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="channel-settings-collapse-switch"]')
            ?.getAttribute("aria-checked") === "false",
      );
      assert.ok(
        (
          await client.request("sidebar.get", {
            workspaceId: workspace.workspaceId,
          })
        ).preferences.expandedLongMessages.includes("room:" + room.roomId),
      );
      await page.waitForFunction(
        () => !document.querySelector("[data-message-collapsed]"),
      );
      await sheet.getByRole("button", { name: "取消", exact: true }).click();
      await page.reload();
      await page
        .getByText("Paragraph 59: bounded native folding test.", {
          exact: true,
        })
        .waitFor();
      await page.waitForFunction(
        () => !document.querySelector("[data-message-collapsed]"),
      );
      assert.ok(
        (
          await page
            .getByTestId("loom-message-timeline")
            .locator("[data-message-id]")
            .first()
            .boundingBox()
        ).height > 1000,
      );
      await page.goto(origin + "/?view=settings&settings=notifications");
      const mute = page.getByRole("checkbox", { name: /静音此服务器/ });
      await mute.waitFor();
      const before = (
        await client.request("sidebar.get", {
          workspaceId: workspace.workspaceId,
        })
      ).preferences;
      await mute.click();
      let original;
      await page.route("**/v3/client/sidebar/patch", async (route) => {
        original = route.request().postDataJSON();
        const response = await route.fetch();
        assert.equal(response.status(), 200, await response.text());
        await route.abort();
      });
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .waitFor();
      await page.unroute("**/v3/client/sidebar/patch");
      const replay = page.waitForRequest((r) =>
        r.url().endsWith("/sidebar/patch"),
      );
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .click();
      assert.deepEqual((await replay).postDataJSON(), original);
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .waitFor({ state: "hidden" });
      await page.reload();
      await mute.waitFor();
      const after = (
        await client.request("sidebar.get", {
          workspaceId: workspace.workspaceId,
        })
      ).preferences;
      assert.equal(after.mutedWorkspace, !before.mutedWorkspace);
      assert.equal(await mute.isChecked(), after.mutedWorkspace);
      assert.deepEqual(after.expandedLongMessages, before.expandedLongMessages);
      assert.deepEqual(after.mutedActivity, before.mutedActivity);
      await mute.click();
      await client.request("sidebar.patch", {
        workspaceId: workspace.workspaceId,
        expectedVersion: after.version,
        idempotencyKey: "stale-prefs-" + width,
        patch: {
          pinned: [...new Set([...after.pinned, "room:" + room.roomId])],
        },
      });
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page
        .getByText("通知偏好可能已变化，未保存。请重新读取后再修改。", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await mute.isChecked(),
        !after.mutedWorkspace,
        "rejected write preserves draft",
      );
      assert.equal(
        (
          await client.request("sidebar.get", {
            workspaceId: workspace.workspaceId,
          })
        ).preferences.mutedWorkspace,
        after.mutedWorkspace,
      );
      await page
        .getByRole("button", { name: "放弃草稿并重新读取", exact: true })
        .click();
      await page.waitForFunction((expected) => {
        const label = [...document.querySelectorAll("label")].find((el) =>
          el.textContent.includes("静音此服务器"),
        );
        return (
          label
            ?.querySelector('[role="checkbox"]')
            ?.getAttribute("aria-checked") === String(expected)
        );
      }, after.mutedWorkspace);
      assert.deepEqual(errors, []);
      results.push({
        width,
        collapsedByDefault: true,
        expandedAfterReload: true,
        workspaceMutePersisted: true,
        staleWritePreservesDraft: true,
        lostResponseExactReplay: true,
        unrelatedPreferencesPreserved: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
