import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
export async function verifyNativeConversations({
  browser,
  origin,
  workspace,
  client,
  role: template,
  head,
}) {
  const out =
    process.env.LOOM_WEB123_CONVERSATION_EVIDENCE ??
    "/tmp/loom-web123-conversations";
  mkdirSync(out, { recursive: true });
  const results = [];
  for (const width of [1440, 390]) {
    const { role } = await client.request("role.create", {
      controlRoomId: workspace.controlRoomId,
      configuration: {
        ...template.configuration,
        displayName: "Solo" + width,
        handle: "Solo" + width,
      },
      basedOnRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "solo-role-" + width,
    });
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
      }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    const catalog = () =>
      client.request("role.list", { controlRoomId: workspace.controlRoomId });
    const prefs = () =>
      client.request("sidebar.get", { workspaceId: workspace.workspaceId });
    const visit = async () => {
      await page.goto(
        origin + "/s/" + workspace.slug + "/agent/" + role.roleId,
      );
      await page
        .getByRole("button", { name: "编辑提示词", exact: true })
        .waitFor();
    };
    const message = async () => {
      const inline = page.getByTestId("agent-profile-inline-message");
      if (await inline.isVisible()) await inline.click();
      else {
        await page.getByTestId("agent-profile-overflow-trigger").click();
        await page.getByTestId("agent-profile-overflow-message").click();
      }
    };
    async function until(check, label) {
      const end = Date.now() + 12000;
      while (!(await check())) {
        assert.ok(Date.now() < end, label);
        await page.waitForTimeout(40);
      }
    }
    try {
      // Known failure after accepted Room/Instance creation: retain progress and
      // let the same original native action continue, without duplicate objects.
      let fail = true;
      await page.route("**/v3/client/sidebar/patch", async (route) => {
        if (fail) {
          fail = false;
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "forbidden",
                message: "列表设置被拒绝（验收注入）",
              },
            }),
          });
        } else await route.continue();
      });
      await visit();
      await message();
      await page
        .getByText("列表设置被拒绝（验收注入）", { exact: true })
        .waitFor();
      const before = (await catalog()).instances.filter(
        (i) => i.roleId === role.roleId,
      );
      assert.equal(before.length, 1);
      const roomId = before[0].channelId;
      await message();
      await page.waitForURL("**/dm/" + roomId);
      await page.getByTestId("composer-textarea").waitFor();
      await page.unroute("**/v3/client/sidebar/patch");
      assert.equal(
        (await catalog()).instances.filter((i) => i.roleId === role.roleId)
          .length,
        1,
      );
      assert.ok((await prefs()).preferences.dmOrder.includes("room:" + roomId));
      const body = "FIXTURE independent chat " + width;
      await page.getByTestId("composer-textarea").fill(body);
      await page.getByTestId("composer-textarea").press("Enter");
      await until(
        async () =>
          (
            await client.request("message.list", { roomId, limit: 10 })
          ).messages.some((m) => m.body === body),
        "DM message did not commit",
      );
      await page.getByText(body, { exact: true }).waitFor();
      // Refresh and re-enter from Role: exactly the same Channel and instance.
      await visit();
      await message();
      await page.waitForURL("**/dm/" + roomId);
      await page.getByText(body, { exact: true }).waitFor();
      assert.equal(
        (await catalog()).instances.filter((i) => i.roleId === role.roleId)
          .length,
        1,
      );
      await page.screenshot({ path: out + "/standalone-" + width + ".png" });
      assert.deepEqual(errors, []);
      results.push({
        width,
        roleCreatesSeparateChannelAndInstance: true,
        knownPartialFailureContinuesWithoutDuplicates: true,
        nativeDmMessagePersists: true,
        reopenAndRefreshRetainSameInstance: true,
        errors,
      });
    } catch (error) {
      await page.screenshot({ path: out + "/failure-" + width + ".png" });
      writeFileSync(
        out + "/failure.json",
        JSON.stringify(
          {
            width,
            error: error.stack,
            body: await page.locator("body").innerText(),
            errors,
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
  const result = { temporaryCore: true, paidCalls: 0, results };
  writeFileSync(out + "/report.json", JSON.stringify(result, null, 2) + "\n");
  return result;
}
