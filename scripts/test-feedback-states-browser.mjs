import { createServer } from "vite";
import { chromium, expect } from "playwright/test";
import { mkdirSync } from "node:fs";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch();
mkdirSync("/tmp/rah-feedback-states", { recursive: true });
try {
  const p = await browser.newPage({
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: 2,
  });
  const go = (mode) =>
    p.goto(
      server.resolvedUrls.local[0] +
        "test/feedback-states-fixture.html?mode=" +
        mode,
    );
  await go("success");
  await p.getByRole("button", { name: /定位第/ }).click();
  await expect(p.locator(".rah-anchor-flash")).toHaveCount(1);
  await expect(p.getByText("已定位评论位置", { exact: true })).toHaveCount(0);
  await p
    .locator("main")
    .screenshot({ path: "/tmp/rah-feedback-states/anchor.png" });
  await go("failed");
  await p.getByRole("button", { name: /定位第/ }).click();
  await expect(p.getByRole("status")).toHaveText(
    "此位置不在当前可呈现的预览范围内",
  );
  await p
    .getByRole("textbox", { name: "附件评论", exact: true })
    .fill("测试评论");
  const beforeComposer = await p.locator(".composer-box").boundingBox();
  await p.getByRole("button", { name: "发送评论", exact: true }).click();
  await expect(p.locator(".composer-box").getByRole("alert")).toHaveText(
    "发送失败",
  );
  expect(await p.locator(".composer-box").boundingBox()).toEqual(
    beforeComposer,
  );
  await p
    .locator("main")
    .screenshot({ path: "/tmp/rah-feedback-states/comment-error.png" });
  await go("profile");
  await p.getByRole("button", { name: "编辑显示名称" }).click();
  await p.getByRole("textbox").fill("修改后的测试 Agent");
  await p.getByRole("button", { name: "保存", exact: true }).click();
  await expect(p.getByRole("alert")).toContainText("保存失败");
  await p
    .locator("main")
    .screenshot({ path: "/tmp/rah-feedback-states/profile-error.png" });
  await p.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw Error("Fixture denied");
        },
      },
    });
  });
  await go("copy");
  await p.getByRole("button", { name: "复制路径" }).click();
  await expect(p.getByRole("status")).toHaveText("无法复制路径");
  await p
    .locator("main")
    .screenshot({ path: "/tmp/rah-feedback-states/copy-error.png" });
  await p.route("**/_rah/service", (r) =>
    r.fulfill({
      json: { available: true, state: "online", generation: "fixture" },
    }),
  );
  await p.route("**/_rah/service/restart", (r) =>
    r.fulfill({ status: 202, json: {} }),
  );
  await go("restart");
  await p.getByRole("button", { name: "重启服务", exact: true }).click();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "重启服务", exact: true })
    .click();
  await expect(
    p.getByRole("button", { name: "正在重启服务…", exact: true }),
  ).toBeDisabled();
  await expect(p.getByRole("status")).toHaveCount(0);
  await expect(p.locator(".rah-computer-service-restart button svg")).toHaveCSS(
    "animation-name",
    "rah-service-restart-spin",
  );
  await p
    .locator("main")
    .screenshot({ path: "/tmp/rah-feedback-states/restart-wait.png" });
  console.log("PASS anchor feedback and failure/wait screenshots");
} finally {
  await browser.close();
  await server.close();
}
