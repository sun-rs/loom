// Disposable real Core, fake catalogs, no paid runtime or formal data writes.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
export async function verifyUiStateRepair({
  browser,
  origin,
  role,
  client,
  workspace,
  head,
}) {
  await client.request("role.revise", {
    roleId: role.roleId,
    expectedRoleRevisionId: role.roleRevisionId,
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "ui-repair-reasoning-fixture",
    configuration: {
      ...role.configuration,
      modelIntent: { ...role.configuration.modelIntent, reasoning: "low" },
    },
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, effectiveType: "4g" },
    });
    window.__chromeTrace = [];
    new MutationObserver((records) => {
      const root = document.documentElement,
        meta = document.querySelector('meta[name="theme-color"]');
      if (!root || !meta) return;
      const style = getComputedStyle(root),
        frame = style.getPropertyValue("--layer-frame").trim(),
        canvas = style.getPropertyValue("--layer-canvas").trim();
      if (!frame || !canvas) return;
      for (const record of records)
        if (record.target === meta && record.attributeName === "content")
          window.__chromeTrace.push({
            at: performance.now(),
            before: record.oldValue,
            after: meta.content,
            frame,
            canvas,
          });
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["content"],
      attributeOldValue: true,
    });
  });
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  let imported;
  const requested = new Promise((r) => {
    imported = r;
  });
  await page.route(/\/assets\/TasksPage-[^/]+\.js/, async (route) => {
    imported();
    await gate;
    await route.continue();
  });
  const result = {};
  try {
    await page.goto(origin + "/?chat=list");
    await page.getByTestId("public-server-channel-sidebar-root").waitFor();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="loom-bootstrap-loading"]'),
    );
    await page.evaluate(() => {
      window.__retainedShell = document.querySelector(
        '[data-testid="loom-channel-app"]',
      );
      window.__retainedDocument = document.documentElement;
    });
    const task = page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "任务", exact: true });
    await task.click();
    await requested;
    await page.waitForURL((url) => url.searchParams.get("view") === "tasks");
    const cold = await page.evaluate(() => ({
      visibleHeaders: [
        ...document.querySelectorAll(
          '[data-loom-root-header],[data-slot="panel-header"]',
        ),
      ]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => el.textContent),
      shellSame:
        window.__retainedShell ===
        document.querySelector('[data-testid="loom-channel-app"]'),
      documentSame: window.__retainedDocument === document.documentElement,
    }));
    await page.screenshot({ path: "/tmp/loom-ui-state-tasks-pending.png" });
    release();
    await page.getByTestId("loom-tasks-page").waitFor();
    await page.screenshot({ path: "/tmp/loom-ui-state-tasks-ready.png" });
    result.coldTask = cold;
    result.themeTrace = await page.evaluate(() => window.__chromeTrace);
    result.themeCanvasWrites = result.themeTrace.filter(
      (row) =>
        row.frame !== row.canvas &&
        (row.before === row.canvas || row.after === row.canvas),
    );
    result.modeChrome = [];
    for (const mode of ["dark", "light"]) {
      await page.evaluate((mode) => {
        localStorage.setItem("loom-raft-mode-v3", mode);
        dispatchEvent(
          new StorageEvent("storage", {
            key: "loom-raft-mode-v3",
            newValue: mode,
          }),
        );
      }, mode);
      await page.waitForFunction(
        (mode) => document.documentElement.classList.contains(mode),
        mode,
      );
      result.modeChrome.push(
        await page.evaluate(() => ({
          mode: document.documentElement.className,
          meta: document.querySelector('meta[name="theme-color"]').content,
          frame: getComputedStyle(document.documentElement)
            .getPropertyValue("--layer-frame")
            .trim(),
        })),
      );
    }
    await page.goto(origin + "/?view=agents&role=" + role.roleId);
    const open = page.getByRole("button", {
      name: "编辑运行时配置",
      exact: true,
    });
    await open.click();
    const dialog = page.getByTestId("agent-runtime-config-dialog");
    await dialog
      .getByRole("checkbox", { name: "快速模式", exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "保存运行时配置", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "角色列表", exact: true }).click();
    result.discardAfterConfirmedSave = await page
      .getByRole("alertdialog")
      .isVisible();
    if (!result.discardAfterConfirmedSave) {
      await page.locator(`[data-role-id="${role.roleId}"]`).click();
      await open.click();
      await dialog
        .getByRole("checkbox", { name: "快速模式", exact: true })
        .uncheck();
      await page.route("**/v3/client/roles/revise", (route) =>
        route.fulfill({ status: 409, json: { error: "fixture rejected" } }),
      );
      const denied = page.waitForResponse(
        (r) => r.url().endsWith("/roles/revise") && r.status() === 409,
      );
      await dialog
        .getByRole("button", { name: "保存运行时配置", exact: true })
        .click();
      await denied;
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await page
        .getByRole("heading", { name: "尚未保存的修改", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "继续编辑", exact: true }).click();
      result.rejectedSaveRetainsDraft =
        (await dialog.isVisible()) &&
        !(await dialog
          .getByRole("checkbox", { name: "快速模式", exact: true })
          .isChecked());
    }
    result.errors = errors;
    await page.screenshot({ path: "/tmp/loom-ui-state-role-return.png" });
    await writeFile(
      process.env.LOOM_UI_REPAIR_REPORT ?? "/tmp/loom-ui-state-repair.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    if (process.env.LOOM_UI_REPAIR_ASSERT === "1") {
      assert.deepEqual(
        result.themeCanvasWrites,
        [],
        "only the frame owner may update browser chrome",
      );
      assert.ok(
        cold.visibleHeaders.some((text) => text.includes("任务")),
        "cold module loading must retain the official task header",
      );
      assert.equal(cold.shellSame, true);
      assert.equal(cold.documentSame, true);
      assert.equal(
        result.discardAfterConfirmedSave,
        false,
        "a confirmed save must leave no phantom draft",
      );
      assert.equal(result.rejectedSaveRetainsDraft, true);
      for (const mode of result.modeChrome)
        assert.equal(
          mode.meta,
          mode.frame,
          "chrome must follow the native provider's committed DOM mode",
        );
      assert.deepEqual(errors, []);
    }
    return result;
  } finally {
    release();
    await context.close();
  }
}
