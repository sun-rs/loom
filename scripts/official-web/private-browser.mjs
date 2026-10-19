import { verifyPrivateSidebar } from "./private-sidebar-browser.mjs";
import { showChatList, openChatRow } from "./mobile-chat-browser.mjs";
// FIXTURE ONLY: real Core, disabled fixture instance, no provider execution.
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertSparseHistoryStartsAtTop } from "./history-layout.mjs";
export async function verifyPrivateBoxes({
  browser,
  origin,
  client,
  workspace,
  channel,
  instance,
  name,
  head,
}) {
  // The shared fixture disables its instances before any composer send.
  const results = [];
  let boxId;
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
    await page.goto(`${origin}/?room=${channel.roomId}`);
    await page.getByTestId("loom-channel-control-trigger").click();
    const requests = [];
    let lost = false;
    await page.route("**/v3/client/rooms/direct/open", async (route) => {
      requests.push(route.request().postDataJSON());
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: `频道内私密消息 ${name}`, exact: true })
      .click();
    await page.getByRole("button", { name: "核实打开私聊" }).waitFor();
    assert.equal(requests.length, 1);
    await page.getByRole("button", { name: "核实打开私聊" }).click();
    await page
      .getByRole("heading", { name: `私聊 · ${name}`, exact: true })
      .waitFor();
    assert.deepEqual(requests[0], requests[1]);
    const current = new URL(page.url()).searchParams.get("room");
    if (boxId) assert.equal(current, boxId);
    else boxId = current;
    const composer = page.locator("textarea");
    const body = `FIXTURE private ${viewport.width}`;
    const sends = [];
    let lostSend = false;
    await page.route("**/v3/client/messages/post", async (route) => {
      sends.push(route.request().postDataJSON());
      if (!lostSend) {
        lostSend = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await composer.fill(body);
    await page.locator('button[type="submit"]:enabled').waitFor();
    await composer.press("Enter");
    await page.getByRole("button", { name: "核实发送" }).waitFor();
    if (viewport.width < 768) {
      assert.equal(
        await page.getByRole("navigation", { name: "主导航" }).isVisible(),
        false,
      );
      await showChatList(page);
      await page.goBack();
    }
    await page.getByRole("button", { name: "核实发送" }).click();
    await page.getByText(body, { exact: true }).waitFor();
    assert.deepEqual(sends[0], sends[1]);
    assert.equal(sends[0].roomId, boxId);
    assert.equal(
      (
        await client.request("message.list", { roomId: boxId, limit: 50 })
      ).messages.filter((m) => m.body === body).length,
      1,
    );
    assert.equal(
      (
        await client.request("message.list", {
          roomId: channel.roomId,
          limit: 50,
        })
      ).messages.filter((m) => m.body === body).length,
      0,
    );
    await page.reload();
    await page.getByText(body, { exact: true }).waitFor();
    await assertSparseHistoryStartsAtTop(
      page,
      viewport.width === 1440
        ? ["FIXTURE private 1440"]
        : ["FIXTURE private 1440", "FIXTURE private 390"],
    );
    await verifyPrivateSidebar({
      page,
      client,
      workspace,
      channel,
      boxId,
      instance,
      name,
    });
    await page.screenshot({
      path: join(tmpdir(), `loom-official-private-${viewport.width}.png`),
      animations: "disabled",
    });
    if (viewport.width === 390) {
      await client.request("room.member.remove", {
        roomId: channel.roomId,
        principalId: instance.instanceId,
        basedOnRoomSeq: await head(channel.roomId),
        idempotencyKey: "fixture-private-remove",
      });
      await page.reload();
      await page
        .getByText("此私聊已停用，历史只读。", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "此私聊已停用", exact: true })
          .isDisabled(),
        true,
      );
      const sendCount = sends.length;
      await composer.fill("FIXTURE forbidden");
      await composer.press("Enter");
      assert.equal(sends.length, sendCount);
      assert.equal(
        (
          await client.request("message.list", { roomId: boxId, limit: 50 })
        ).messages.some((m) => m.body === "FIXTURE forbidden"),
        false,
      );
    }
    await openChatRow(page, channel.roomId);
    await page
      .getByRole("heading", { name: channel.name, exact: true })
      .waitFor();
    assert.equal(await page.getByText(body, { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      privateOpenUnknownReplay: true,
      privateSendUnknownReplay: true,
      mobileBackPreservesUnknownWrite: viewport.width < 768,
      stableBoxAcrossReload: true,
      sparseHistoryTopAlignedAndChronological: true,
      privateChannelIsolation: true,
      channelScopedHistoryEntry: true,
      inactiveHistoryReadOnly: viewport.width === 390,
    });
    await context.close();
  }
  return results;
}
