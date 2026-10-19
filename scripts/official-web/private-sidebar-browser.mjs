import assert from "node:assert/strict";
import { showChatList, openChatRow } from "./mobile-chat-browser.mjs";
/** Channel-private records are not top-level standalone conversations. */
export async function verifyPrivateSidebar({ page, channel, boxId, name }) {
  await showChatList(page);
  assert.equal(
    await page.locator(`[data-sidebar-channel-id="${boxId}"]`).count(),
    0,
  );
  await openChatRow(page, channel.roomId);
  await page.getByTestId("loom-channel-control-trigger").click();
  await page
    .getByTestId("channel-private-history")
    .getByText(name, { exact: true })
    .click();
  await page
    .getByRole("heading", { name: `私聊 · ${name}`, exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("room"), boxId);
  await page.reload();
  await page
    .getByRole("heading", { name: `私聊 · ${name}`, exact: true })
    .waitFor();
}
