// Real Kernel/API/gateway with deterministic fixture messages; no paid CLI.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../../packages/application-service/src/index.ts";
import { LocalWorkbenchGateway } from "../../packages/daemon/src/local-workbench-gateway.ts";
import { roleInstanceFixture } from "../../packages/kernel/test/role-instance-fixture.ts";

import { HttpRahClient } from "@rah-os/client-sdk";
import { verifyActivityReturn } from "./activity-return-browser.mjs";
const f = roleInstanceFixture();
let service, gateway, browser;
try {
  const peer = f.kernel.provisionPrincipal({
    handle: "fixture-peer",
    kind: "human",
  });
  const actor = f.kernel.authenticateAccessToken(peer.accessToken);
  f.kernel.addMember(f.actor, {
    roomId: f.home.roomId,
    principalId: peer.principal.principalId,
  });
  f.kernel.postMessage(actor, {
    roomId: f.home.roomId,
    body: "FIXTURE settings/activity review",
    recipients: [],
    idempotencyKey: "fixture",
  });
  service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw Error("unused");
    },
  });
  await service.start();
  gateway = new LocalWorkbenchGateway({
    accessToken: f.owner.accessToken,
    daemonOrigin: service.origin,
    port: 0,
    sessionToken: "x".repeat(43),
    staticDirectory: resolve("frontends/raft/packages/web/dist-workbench"),
  });
  await gateway.start();
  browser = await chromium.launch({ headless: true });

  const client = new HttpRahClient({
    baseUrl: service.origin,
    accessToken: () => f.owner.accessToken,
  });
  const activity =
    process.env.LOOM_BROWSER_SLICE === "settings-resources"
      ? "not-run: settings-only slice"
      : await verifyActivityReturn({
          browser,
          origin: gateway.origin,
          client,
          workspace: f.workspace.workspace,
        });
  const settings = [];
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(gateway.origin + "/?view=settings&settings=release-notes");
    await page.getByTestId("release-entry").first().waitFor();
    assert.equal(await page.getByTestId("release-entry").count(), 3);
    assert.equal(
      await page
        .getByRole("heading", { name: "更新日志", exact: true })
        .count(),
      1,
    );
    await page.route("**/v3/client/push/configuration", (route) =>
      route.fulfill({
        json: {
          applicationServerKey: "test",
          subscriptionCount: 0,
          supported: true,
        },
      }),
    );
    let mutations = 0;
    page.on("request", (r) => {
      if (/push\/(subscribe|unsubscribe|test)$/.test(r.url())) mutations++;
    });
    await page.goto(gateway.origin + "/?view=settings&settings=notifications");
    await page.getByText("订阅尚未接入", { exact: true }).waitFor();
    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "订阅尚未接入" });
    assert.equal(await card.count(), 1);
    assert.equal(await card.locator(".text-subhead").count(), 1);
    assert.equal(
      await card
        .getByText("订阅尚未接入", { exact: true })
        .getAttribute("data-appearance"),
      "soft",
    );

    assert.equal(
      await page
        .getByRole("button", { name: "启用推送通知", exact: true })
        .count(),
      0,
    );
    await page.screenshot({
      path: `/tmp/loom-notification-settings-${width}.png`,
    });
    assert.equal(mutations, 0);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => "denied",
      });
    });
    await page.reload();
    await page.getByText("订阅尚未接入", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByText("订阅尚未接入", { exact: true })
        .getAttribute("data-variant"),
      "warning",
    );
    await page.unroute("**/v3/client/push/configuration");
    await page.route("**/v3/client/push/configuration", (route) =>
      route.abort(),
    );
    await page.reload();
    await page.getByText("状态未知", { exact: true }).waitFor();
    await page
      .getByRole("alert")
      .filter({ hasText: "无法读取通知服务状态" })
      .waitFor();
    assert.equal(
      await page.getByText("订阅尚未接入", { exact: true }).count(),
      0,
    );
    settings.push({ width, releaseNotes: true, notificationReadOnly: true });
    await ctx.close();
  }
  console.log(JSON.stringify({ activity, settings }, null, 2));
} finally {
  await browser?.close();
  await gateway?.stop();
  await service?.close();
  f.close();
}
