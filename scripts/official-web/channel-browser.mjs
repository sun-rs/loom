// FIXTURE ONLY: real temporary Loom Core/gateway, no provider execution or user data.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { HttpRahClient } from "@rah-os/client-sdk";
import { startRestartableLocalCoreWorkbench } from "../../packages/daemon/src/restartable-local-workbench.ts";
const directory = mkdtempSync(join(tmpdir(), "loom-official-channel-"));
const bin = join(directory, "bin");
const cwd = join(directory, "workspace");
mkdirSync(bin);
mkdirSync(cwd);
writeFileSync(
  join(bin, "codex"),
  `#!${process.execPath}\nconst args=process.argv.slice(2).join(' ');if(args==='--version') console.log('FAKE discovery only');else if(args==='debug models --bundled') console.log(JSON.stringify({models:[]}));else process.exitCode=2;\n`,
  { mode: 0o700 },
);
let running;
let browser;
const results = [];
try {
  running = await startRestartableLocalCoreWorkbench({
    environment: { ...process.env, PATH: bin },
    mode: { kind: "loopback", port: 0 },
    staticDirectory: resolve("frontends/raft/packages/web/dist-workbench"),
    workbenchHome: join(directory, "home"),
    workspaceCwd: cwd,
  });
  const origin = running.descriptor.webOrigin;
  const response = await fetch(origin);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const client = new HttpRahClient({
    baseUrl: origin,
    accessToken: () => "trusted-proxy-auth",
    fetch: (url, init) =>
      fetch(url, { ...init, headers: { ...init.headers, cookie, origin } }),
  });
  const workspace = (await client.request("workspace.list", {})).workspaces[0];
  const head = async (roomId) =>
    (
      await client.request("room.sync", {
        roomId,
        consumerId: "browser-fixture",
      })
    ).latestRoomSeq;
  const channels = [];
  for (const name of ["FIXTURE Alpha", "FIXTURE Beta"]) {
    const result = await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: name,
      kind: "channel",
      name,
      slug: name.toLowerCase().replaceAll(" ", "-"),
    });
    channels.push(result.room);
  }
  for (let i = 1; i <= 55; i++)
    await client.request("message.post", {
      roomId: channels[0].roomId,
      body: `FIXTURE history ${i}`,
      basedOnRoomSeq: await head(channels[0].roomId),
      idempotencyKey: `history-${i}`,
      recipients: [],
    });
  browser = await chromium.launch({ headless: true });
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
    const external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${origin}/?room=${channels[0].roomId}`);
    const composer = page.locator("textarea");
    await composer.waitFor({ timeout: 20000 });
    const columns = await page.evaluate(() => {
      const sidebar = document
        .querySelector('[data-testid="public-server-channel-sidebar-root"]')
        .getBoundingClientRect();
      const timeline = document
        .querySelector("textarea")
        .getBoundingClientRect();
      return { sidebarRight: sidebar.right, composerLeft: timeline.left };
    });
    assert.ok(
      columns.composerLeft >= columns.sidebarRight,
      "native shell columns must stay side by side",
    );
    await page.getByText("FIXTURE history 55", { exact: true }).waitFor();
    const timeline = page.getByTestId("loom-message-timeline");
    await timeline.evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.getByText("FIXTURE history 1", { exact: true }).waitFor();
    await timeline.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const body = `FIXTURE send ${viewport.width}`;
    await composer.fill(body);
    await composer.press("Enter");
    await page.getByText(body, { exact: true }).waitFor();
    assert.equal(
      (
        await client.request("message.list", {
          roomId: channels[0].roomId,
          limit: 100,
        })
      ).messages.filter((m) => m.body === body).length,
      1,
    );
    await page.reload();
    await page.getByText(body, { exact: true }).waitFor();
    await page
      .locator(`[data-public-channel-id="${channels[1].roomId}"]`)
      .click();
    await page
      .locator('textarea[placeholder="发送到 #FIXTURE Beta"]')
      .waitFor();
    if (viewport.width === 1440)
      await page.getByText("频道还没有消息", { exact: true }).waitFor();
    else await page.getByText("FIXTURE lost 1440", { exact: true }).waitFor();
    assert.equal(await page.getByText(body, { exact: true }).count(), 0);
    await composer.fill("FIXTURE IME");
    await composer.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    assert.equal(await composer.inputValue(), "FIXTURE IME");
    await composer.press("Shift+Enter");
    assert.ok((await composer.inputValue()).includes("\n"));
    let dropped = false;
    const sendRequests = [];
    await page.route("**/v3/client/messages/post", async (route) => {
      sendRequests.push(route.request().postDataJSON());
      if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await composer.fill(`FIXTURE lost ${viewport.width}`);
    await composer.press("Enter");
    await page.getByRole("button", { name: "核实发送" }).waitFor();
    assert.equal(sendRequests.length, 1);
    await page.evaluate((room) => {
      history.pushState({}, "", `?room=${room}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, channels[0].roomId);
    await page.getByText(body, { exact: true }).waitFor();
    await page.evaluate((room) => {
      history.back();
    }, channels[1].roomId);
    await page.getByRole("button", { name: "核实发送" }).waitFor();
    await page.getByRole("button", { name: "核实发送" }).click();
    await page
      .getByText(`FIXTURE lost ${viewport.width}`, { exact: true })
      .waitFor();
    assert.deepEqual(sendRequests[0], sendRequests[1]);
    assert.equal(
      await composer.inputValue(),
      "",
      "confirmed delivery must not leave the sent draft ready to send again",
    );
    assert.equal(
      (
        await client.request("message.list", {
          roomId: channels[1].roomId,
          limit: 100,
        })
      ).messages.filter((m) => m.body === `FIXTURE lost ${viewport.width}`)
        .length,
      1,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await page.screenshot({
      path: join(tmpdir(), `loom-official-channel-${viewport.width}.png`),
    });
    await page.goto(`${origin}/?room=unavailable-channel`);
    await page
      .getByText("此频道不存在或没有访问权限", { exact: true })
      .waitFor();
    assert.equal(await page.locator("textarea").count(), 0);
    results.push({
      viewport,
      sendAndReload: true,
      historyPagination: true,
      unavailableChannelFailsClosed: true,
      switchIsolation: true,
      ime: true,
      unknownResultVerified: true,
      externalRequests: 0,
    });
    await context.close();
  }
  console.log(
    JSON.stringify(
      { fixtureOnly: true, realCore: true, paidCli: false, results },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await running?.stop();
  rmSync(directory, { recursive: true, force: true });
}
