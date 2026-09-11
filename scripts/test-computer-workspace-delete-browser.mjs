import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
process.env.RAH_FIXTURE_WORKSPACE_FILES = "1";
const f = await startShellFixture(),
  b = await chromium.launch({
    headless: true,
    executablePath: await findChromeExecutable(),
  });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(f.origin + "/?surface=computers");
  await p.getByRole("button", { name: "扫描工作区", exact: true }).click();
  const row = p.locator("[data-workspace-summary]").first();
  await row.waitFor();
  await row.getByRole("button", { name: /删除 .* 工作区/ }).click();
  const dialog = p.getByRole("dialog", { name: "删除工作区", exact: true });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await row.count(), 1);
  await row.getByRole("button", { name: /删除 .* 工作区/ }).click();
  const response = p.waitForResponse((r) =>
    r.url().endsWith("/agents/memory/reset"),
  );
  await dialog.getByRole("button", { name: "删除工作区", exact: true }).click();
  const r = await response;
  assert.equal(r.status(), 200, await r.text());
  await dialog.waitFor({ state: "detached" });
  await p.getByRole("button", { name: "重新扫描", exact: true }).click();
  await p.getByText("工作区尚未创建", { exact: false }).first().waitFor();
  await p.screenshot({ path: "/tmp/computer-workspace-after-delete.png" });
  assert.equal(await p.getByText("本机恢复指南", { exact: true }).count(), 0);
  console.log(
    "PASS cancelled delete preserves workspace; confirmed deletion receipt + rescan absent; no auto restart invoked",
  );
} finally {
  await b.close();
  await f.close();
}
