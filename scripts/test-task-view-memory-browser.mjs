import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const selected = async (name) =>
    expect(page.getByRole("radio", { name, exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  await page.goto(`${fixture.origin}/?surface=tasks`);
  await selected("看板");
  await page.getByRole("radio", { name: "列表", exact: true }).click();
  const rail = page.getByRole("navigation", { name: "主导航", exact: true });
  await rail.getByRole("button", { name: "聊天", exact: true }).click();
  await rail.getByRole("button", { name: "任务", exact: true }).click();
  await selected("列表");
  await page.goto(`${fixture.origin}/?surface=room`);
  await page.goto(`${fixture.origin}/?surface=tasks`);
  await selected("列表");
  await page.reload();
  await selected("列表");
  await page.getByRole("radio", { name: "看板", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await selected("看板");
  await page.reload();
  await selected("看板");
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${fixture.origin}/?surface=tasks`);
  await selected("列表");
  await page.setViewportSize({ width: 1440, height: 900 });
  await selected("看板");
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", { value: true }),
  );
  await page.reload();
  await selected("列表");
  await page.getByRole("radio", { name: "看板", exact: true }).click();
  await page.goto(`${fixture.origin}/?surface=tasks`);
  await selected("看板");
  await page.screenshot({ path: "/tmp/rah-task-view-memory.png" });
  console.log(
    "PASS task view memory, responsive defaults, PWA default and override",
  );
} finally {
  await browser.close();
  await fixture.close();
}
