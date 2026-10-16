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
  `#!${process.execPath}\nconst args=process.argv.slice(2).join(' ');if(args==='--version') console.log('FAKE discovery only');else if(args==='debug models --bundled') console.log(JSON.stringify({models:[{slug:"gpt-members-fixture",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"}],service_tiers:[]}]}));else process.exitCode=2;\n`,
  { mode: 0o700 },
);
let running;
let browser;
const results = [];
try {
  running = await startRestartableLocalCoreWorkbench({
    environment: { ...process.env, PATH: bin },
    mode: process.env.LOOM_BROWSER_TRUSTED_HOST
      ? {
          kind: "tailnet",
          bindHost: process.env.LOOM_BROWSER_TRUSTED_HOST,
          additionalBindHosts: ["127.0.0.1"],
          port: 0,
        }
      : { kind: "loopback", port: 0 },
    staticDirectory: resolve(
      process.env.LOOM_BROWSER_STATIC_DIRECTORY ??
        "frontends/raft/packages/web/dist-workbench",
    ),
    workbenchHome: join(directory, "home"),
    workspaceCwd: cwd,
  });
  const origin = running.descriptor.webOrigin;
  const response = await fetch(origin);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
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

  browser = await chromium.launch({ headless: true });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page
      .getByTestId("settings-sidebar-list")
      .getByRole("button", { name: "运行设置", exact: true })
      .click();
    const advanced = page.getByTestId("advanced-runtime-settings");
    await advanced.waitFor();
    assert.equal(await advanced.getAttribute("open"), null);
    await advanced.locator("summary").click();
    const before = await client.request("runtime.settings.read", {});
    const next = before.maxConcurrentStarts === 3 ? 4 : 3;
    await page.getByLabel("同时启动上限", { exact: true }).fill(String(next));
    await page
      .getByLabel("无进展告警（分钟）", { exact: true })
      .fill(before.watchdog.noProgressWarnMs === 90000 ? "2" : "1.5");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page
      .getByText("已保存；看门狗阈值立即适用于正在运行的工作。", {
        exact: true,
      })
      .waitFor();
    const saved = await client.request("runtime.settings.read", {});
    assert.equal(saved.maxConcurrentStarts, next);
    assert.equal(
      saved.watchdog.noProgressWarnMs,
      before.watchdog.noProgressWarnMs === 90000 ? 120000 : 90000,
    );
    assert.equal(saved.maxConcurrentRuns, before.maxConcurrentRuns);
    await client.request("runtime.settings.update", {
      expectedRevision: saved.revision,
      minStartIntervalMs: saved.minStartIntervalMs + 1,
    });
    await page.getByLabel("同时启动上限", { exact: true }).fill("6");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(
      await page.getByLabel("同时启动上限", { exact: true }).inputValue(),
      "6",
    );
    assert.equal(
      (await client.request("runtime.settings.read", {})).maxConcurrentStarts,
      next,
    );
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await page.waitForFunction(
      (v) =>
        document.querySelector('input[aria-label="同时启动上限"]')?.value ===
        String(v),
      next,
    );
    let updates = 0;
    await page.route("**/v3/client/runtime-settings/update", async (route) => {
      updates++;
      await route.fetch();
      await route.abort();
    });
    await page.getByLabel("同时启动上限", { exact: true }).fill("7");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "放弃核实并重新读取" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('input[aria-label="同时启动上限"]')?.value ===
        "7",
    );
    assert.equal(updates, 1);
    await page.unroute("**/v3/client/runtime-settings/update");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `/tmp/loom-runtime-settings-${viewport.width}.png`,
    });
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      save: true,
      conflict: true,
      unknownNotResent: true,
    });
    await context.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await running?.stop();
  rmSync(directory, { recursive: true, force: true });
}
