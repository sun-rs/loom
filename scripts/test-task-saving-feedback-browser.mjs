import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
  await p.goto(f.origin + "/?surface=tasks");
  await p
    .locator(".rah-global-card-open")
    .filter({ hasText: "Keep the Room-first delivery contract" })
    .first()
    .click();
  const d = p.getByRole("dialog");
  await d.getByRole("button", { name: /任务 #\d+ 状态/ }).click();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await p.route("**/v3/client/tasks/workflow", async (r) => {
    await held;
    await r.abort();
  });
  await p.getByRole("menuitemradio", { name: "已关闭", exact: true }).click();
  try {
    await expect(
      d.getByRole("button", { name: /任务 #\d+ 状态/ }),
    ).toBeDisabled();
    await expect(p.getByText("正在保存任务…", { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  console.log("PASS pending task keeps disabled status without extra notice");
} finally {
  await b.close();
  await f.close();
}
