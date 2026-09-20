import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(`${fixture.origin}/?surface=room&room=${fixture.roomId}`);
  const rail = page.getByRole("navigation", { name: "主导航", exact: true });
  await expect(page.locator(".rah-room-sidebar")).toBeVisible();
  for (const destination of ["room", "saved"]) {
    if (destination === "saved")
      await page
        .locator(".rah-room-sidebar")
        .getByRole("button", { name: "已保存", exact: true })
        .click();
    for (const label of ["动态", "搜索", "设置", "Agent 与成员"]) {
      await rail.getByRole("button", { name: label, exact: true }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("surface") ?? "room")
        .not.toBe(destination);
      await rail.getByRole("button", { name: "聊天", exact: true }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("surface") ?? "room")
        .toBe(destination);
      if (destination === "room")
        await expect
          .poll(() => new URL(page.url()).searchParams.get("room"))
          .toBe(fixture.roomId);
    }
    await page.reload();
    await expect(page.locator(".rah-room-sidebar")).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("surface") ?? "room")
      .toBe(destination);
  }
  console.log(
    "PASS Chat rail restores Room/Saved after independent surfaces and reload",
  );
} finally {
  await browser.close();
  await fixture.close();
}
