import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await (
    process.env.RAH_MOBILE_ENGINE === "webkit" ? webkit : chromium
  ).launch();
try {
  const p = await b.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await p.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", { value: true }),
  );
  await p.goto(f.origin + "/?surface=agents");
  const list = p.getByRole("complementary", { name: "Agent 列表" }),
    nav = p.getByRole("navigation", { name: "移动端主导航" });
  await expect(list).toBeVisible();
  await expect(list.locator(".rah-agent-member-row").first()).toBeVisible();
  await p.waitForTimeout(500);
  await expect(list.locator(".rah-agent-member-row.is-selected")).toHaveCount(
    0,
  );
  await list.locator(".rah-agent-member-row").first().click();
  await expect(list).toBeHidden();
  const explicit = p.url();
  assert.ok(new URL(explicit).searchParams.get("agent"));
  await p.locator(".rah-agent-mobile-back").click();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await nav.getByRole("button", { name: "成员", exact: true }).click();
  await expect(list).toBeVisible();
  await list.locator(".rah-agent-member-row").first().click();
  await expect(list).toBeHidden();
  await p.locator(".rah-agent-mobile-back").click();
  await nav.getByRole("button", { name: "成员", exact: true }).click();
  await expect(list).toBeVisible();
  await p.reload();
  await expect(list).toBeVisible();
  await p.goto(explicit);
  await expect(list).toBeHidden();
  await p.locator(".rah-agent-mobile-back").click();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  const index = p.locator(".rah-settings-mobile-index");
  await expect(index).toBeVisible();
  await index.getByRole("button").first().click();
  await expect(index).toBeHidden();
  await p.getByRole("button", { name: "返回设置", exact: true }).click();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await expect(index).toBeVisible();
  await p.goto(explicit);
  await p.setViewportSize({ width: 1440, height: 900 });
  await expect(list).toBeVisible();
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(list).toBeHidden();
  await p.goto(f.origin + "/?surface=computers");
  await expect(p.locator(".rah-computer-directory")).toHaveClass(/is-list/);
  await expect(p.locator(".rah-computer-sidebar")).toBeVisible();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(f.origin + "/?surface=agents");
  await expect(list.locator(".rah-agent-member-row").first()).toHaveAttribute(
    "aria-current",
    "page",
  );
  console.log(
    "PASS mobile/PWA root entry is list, explicit links and selected desktop resize retain detail",
  );
} finally {
  await b.close();
  await f.close();
}
