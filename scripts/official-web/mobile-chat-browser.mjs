// FIXTURE ONLY: real navigation controls, no provider execution.
import assert from "node:assert/strict";
export async function showChatList(page) {
  if (page.viewportSize().width >= 768) return;
  await page.getByTestId("loom-channel-app").waitFor();
  const back = page.getByRole("button", { name: "聊天列表", exact: true });
  const sidebar = page.getByTestId("public-server-channel-sidebar-root");
  await back.or(sidebar).filter({ visible: true }).first().waitFor();
  if (!(await sidebar.isVisible())) {
    await back.click();
    await sidebar.waitFor();
  }
}
export async function openChatRow(page, id) {
  await showChatList(page);
  await page.locator(`[data-public-channel-id="${id}"]`).click();
  if (page.viewportSize().width < 768) {
    await page
      .getByTestId("public-server-channel-sidebar-root")
      .waitFor({ state: "hidden" });
    await page.getByTestId("composer-textarea").waitFor();
  }
}
export async function verifyMobileChatNavigation(page, roomId) {
  if (page.viewportSize().width >= 768) return;
  const sidebar = page.getByTestId("public-server-channel-sidebar-root");
  const composer = page.getByTestId("composer-textarea");
  const nav = page.getByRole("navigation", { name: "主导航" });
  assert.equal(
    await sidebar.isVisible(),
    false,
    "mobile detail covers the sidebar",
  );
  assert.equal(
    await nav.isVisible(),
    false,
    "mobile detail covers the bottom tabs",
  );
  await composer.fill("FIXTURE mobile back draft");
  const body = await composer.boundingBox();
  assert.ok(body.width > 300, "mobile composer uses the full detail column");
  const marks = [];
  const recordMark = (request) => {
    if (request.url().endsWith("/activity/mark")) marks.push(request.url());
  };
  page.on("request", recordMark);
  await showChatList(page);
  await sidebar.waitFor();
  assert.equal(new URL(page.url()).searchParams.get("room"), roomId);
  assert.deepEqual(
    marks,
    [],
    "popping to the list never acknowledges messages",
  );
  page.off("request", recordMark);
  const list = await sidebar.boundingBox();
  assert.equal(Math.round(list.width), 390);
  assert.deepEqual(
    await sidebar.evaluate((el) => {
      const style = getComputedStyle(el);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return [
        [...context.getImageData(0, 0, 1, 1).data],
        style.borderRightWidth,
      ];
    }),
    [[255, 255, 255, 255], "0px"],
    "official mobile root is white without a desktop side divider",
  );
  assert.equal(await composer.isVisible(), false);
  await nav.waitFor();
  await page.reload();
  await sidebar.waitFor();
  // Start a fresh draft after reload; native draft persistence is not inferred here.
  await openChatRow(page, roomId);
  await composer.fill("FIXTURE mobile back draft");
  await showChatList(page);
  await openChatRow(page, roomId);
  assert.equal(await composer.inputValue(), "FIXTURE mobile back draft");
  await page.goBack();
  await sidebar.waitFor();
  await page.goForward();
  await composer.waitFor();
  assert.equal(await composer.inputValue(), "FIXTURE mobile back draft");
  assert.equal(await nav.isVisible(), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await sidebar.waitFor();
  assert.equal(await composer.inputValue(), "FIXTURE mobile back draft");
  await page.setViewportSize({ width: 390, height: 844 });
  await sidebar.waitFor({ state: "hidden" });
  assert.equal(await composer.inputValue(), "FIXTURE mobile back draft");
  await composer.fill("");
  await page.route("**/v3/client/workspaces/list", (route) => route.abort());
  await page.goto(new URL("/", page.url()).href);
  await page.getByTestId("loom-bootstrap-loading").waitFor({ state: "hidden" });
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByRole("alert").isVisible(),
    true,
    "root connection errors cannot disappear with the hidden detail column",
  );
  await page.unroute("**/v3/client/workspaces/list");
  await page.goto(new URL(`/?room=${roomId}`, page.url()).href);
  await composer.waitFor();
  await page.goto(new URL(`/?view=agents&room=${roomId}`, page.url()).href);
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "首页", exact: true })
    .click();
  await sidebar.waitFor();
  assert.equal(
    await sidebar.isVisible(),
    true,
    "the mobile Chat tab opens its list root even from a direct Agent URL",
  );
  await openChatRow(page, roomId);
}

// Seed a real same-document history entry for unresolved-write Back checks.
export async function openChannelWithHistory(page, origin, roomId) {
  await page.goto(`${origin}/?view=agents&room=${roomId}`);
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await (
    page.viewportSize().width < 768
      ? navigation.getByRole("button", { name: "首页", exact: true })
      : navigation.getByTestId("left-rail-tab-channels")
  ).click();
  if (page.viewportSize().width < 768)
    await page.locator(`[data-public-channel-id="${roomId}"]`).click();
  await page.getByTestId("composer-textarea").waitFor();
}
