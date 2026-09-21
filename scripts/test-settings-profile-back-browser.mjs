import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 844 });
    await p.goto(f.origin + "/?room=" + f.roomId);
    await p
      .getByRole("button", { name: "频道详情与设置", exact: true })
      .click();
    const drawer = p.locator(".rah-channel-settings-drawer");
    if (width === 1440) {
      await expect(
        drawer.getByRole("button", { name: "关闭频道设置", exact: true }),
      ).toBeHidden();
      await expect(drawer.getByRole("button", { name: /^返回/ })).toHaveCount(
        0,
      );
    }
    await drawer.getByRole("button", { name: "添加成员", exact: true }).click();
    await expect(
      drawer.getByRole("button", { name: "返回频道设置", exact: true }),
    ).toBeVisible();
    await expect(drawer.getByRole("button", { name: /^关闭/ })).toBeHidden();
    await drawer
      .getByRole("button", { name: "返回频道设置", exact: true })
      .click();

    await drawer.getByRole("button", { name: "管理成员", exact: true }).click();
    await expect(
      drawer.getByRole("button", { name: "返回频道设置", exact: true }),
    ).toBeVisible();
    await expect(drawer.getByRole("button", { name: /^关闭/ })).toBeHidden();
    const row = drawer.locator(".rah-member-row").first();
    await row.click();
    await expect(drawer.locator(".rah-agent-detail-head")).toBeVisible();
    await drawer.locator(".rah-agent-mobile-back").click();
    await expect(row).toBeVisible();
    await expect(drawer.locator(".rah-agent-detail-head")).toHaveCount(0);
    await row.click();
    await drawer
      .getByRole("button", { name: "返回成员管理", exact: true })
      .click();
    await expect(row).toBeVisible();
    await row.click();
    if (width === 1440) {
      await drawer
        .getByRole("button", { name: "关闭 Agent 侧栏", exact: true })
        .click();
      await expect(drawer).toHaveCount(0);
    } else {
      await drawer
        .getByRole("button", { name: "返回成员管理", exact: true })
        .click();
      await drawer
        .getByRole("button", { name: "返回频道设置", exact: true })
        .click();
      await expect(
        drawer.getByRole("button", { name: "管理成员", exact: true }),
      ).toBeVisible();
    }
  }
  console.log(
    "Settings Agent profile: back restores member layer, desktop X closes drawer; desktop/mobile passed",
  );
} finally {
  await b.close();
  await f.close();
}
