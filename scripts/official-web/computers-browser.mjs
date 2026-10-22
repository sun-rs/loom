import { verifyRoleCreation } from "./role-create-browser.mjs";
import assert from "node:assert/strict";
export async function verifyComputers({ browser, origin }) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    let mode = "fresh";
    // Presentation fixture: nine instances without creating or starting sessions.
    for (const [endpoint, key] of [
      ["roles", "instances"],
      ["agents", "agents"],
    ]) {
      await page.route(`**/v3/client/${endpoint}/list`, async (route) => {
        const response = await route.fetch(),
          body = await response.json(),
          original = body[key][0];
        if (original)
          body[key] = Array.from({ length: 9 }, (_, i) =>
            endpoint === "roles"
              ? {
                  ...original,
                  instanceId: `fixture-instance-${i}`,
                  agentId: `fixture-agent-${i}`,
                }
              : {
                  ...original,
                  definition: {
                    ...original.definition,
                    agentId: `fixture-agent-${i}`,
                    participantId: `fixture-instance-${i}`,
                  },
                  handle: `Fixture-${i}`,
                  currentRevision: {
                    ...original.currentRevision,
                    displayName: `Fixture-${i}`,
                  },
                  modelBindingId: "fixture-model",
                },
          );
        await route.fulfill({ response, json: body });
      });
    }
    await page.route("**/v1/local/runtimes/list", async (route) => {
      if (mode === "error")
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture unavailable" }),
        });
      const response = await route.fetch();
      const body = await response.json();
      for (let i = 0; i < body.runtimes.length; i++) {
        body.runtimes[i].agentBindings =
          i === 0
            ? Array.from({ length: 9 }, (_, n) => ({
                agentId: `fixture-agent-${n}`,
                participantId: `fixture-instance-${n}`,
                handle: `Fixture-${n}`,
              }))
            : [];
      }
      body.computer = {
        displayName: "Fixture computer",
        hostname: "fixture-host",
        os: "fixture-os",
        status: "online",
        observedAt: new Date(mode === "stale" ? 0 : Date.now()).toISOString(),
        staleAfterMs: 30000,
      };
      await route.fulfill({ response, json: body });
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/?view=settings`);
    await page.getByTestId("settings-sidebar-list").waitFor();
    if (viewport.width >= 768) {
      assert.equal(
        await page
          .getByTestId("settings-sidebar-list")
          .getByRole("button", { name: "计算机", exact: true })
          .count(),
        0,
      );
      await page.getByTestId("left-rail-tab-computers").click();
    } else
      await page
        .getByTestId("settings-sidebar-list")
        .getByRole("button", { name: "计算机", exact: true })
        .click();
    const row = page.getByTestId(
      viewport.width >= 768 ? "computer-desktop-row" : "computer-mobile-row",
    );
    await row.waitFor();
    if (viewport.width < 768) {
      const bounds = await row.boundingBox();
      assert.ok(
        bounds &&
          bounds.height >= 44 &&
          bounds.x >= 0 &&
          bounds.x + bounds.width <= viewport.width,
      );
    }
    await row.click();
    await page.getByTestId("computer-detail").waitFor();
    if (viewport.width >= 768) {
      const handle = await page
        .getByTestId("computer-sidebar-resize")
        .boundingBox();
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(handle.x + 1000, handle.y + handle.height / 2);
      await page.mouse.up();
      assert.equal(
        await page
          .getByTestId("loom-computers-page")
          .locator('[data-slot="app-shell-sidebar-slot"]')
          .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
        400,
      );
      await page.setViewportSize({ width: 780, height: 1000 });
      const section = page.getByTestId("computer-instances");
      const title = await section
        .getByText("在这台计算机上的实例", { exact: false })
        .first()
        .boundingBox();
      const create = await section
        .getByRole("button", { name: "新建角色", exact: true })
        .boundingBox();
      assert.ok(
        create.y > title.y + title.height,
        "native actions wrap below heading in narrow detail",
      );
      await page.setViewportSize(viewport);
    }

    const list = page.getByTestId("computer-instances"),
      rows = list.getByTestId("computer-instance-row");
    await rows.nth(5).waitFor();
    assert.equal(await rows.count(), 6);
    assert.match(await rows.first().innerText(), /fixture-model/);
    const beforeWidth = await page
      .getByTestId("machine-detected-runtimes")
      .boundingBox();
    await list
      .getByRole("button", { name: "展开全部 9 个实例", exact: true })
      .click();
    assert.equal(await rows.count(), 9);
    const afterWidth = await page
      .getByTestId("machine-detected-runtimes")
      .boundingBox();
    assert.ok(
      Math.abs(beforeWidth.width - afterWidth.width) <= 16,
      "Only a native scrollbar may change width",
    );
    assert.equal(beforeWidth.height, afterWidth.height);
    assert.equal(
      await page
        .getByTestId("machine-detected-runtimes")
        .getByText(/ · 可用/)
        .count(),
      0,
    );
    await list.getByRole("button", { name: "收起", exact: true }).click();
    assert.equal(await rows.count(), 6);
    await list.getByRole("button", { name: "选择", exact: true }).click();
    await list.getByRole("button", { name: "全选", exact: true }).click();
    await list.getByText("已选择 9 个实例", { exact: true }).waitFor();
    await list.getByRole("button", { name: "停止", exact: true }).click();
    await page
      .getByRole("heading", { name: "停止所选实例", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "取消", exact: true })
      .last()
      .click();
    await list.getByRole("button", { name: "重启／重置", exact: true }).click();
    const reset = page.getByRole("dialog");
    await reset
      .getByRole("heading", { name: "重启／重置所选实例", exact: true })
      .waitFor();
    assert.equal(
      await reset.getByRole("combobox", { name: "重启配置" }).count(),
      0,
    );
    const cancelReset = reset.getByRole("button", {
      name: "取消",
      exact: true,
    });
    const target = await cancelReset.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        after = getComputedStyle(el, "::after");
      const y = r.y + r.height / 2;
      const x = r.x + r.width / 2;
      return {
        x,
        y,
        hit: el.contains(document.elementFromPoint(x, y)),
        height:
          r.height -
          parseFloat(after.top || "0") -
          parseFloat(after.bottom || "0"),
        native: el.classList.contains("h-control"),
      };
    });
    assert.ok(target.native && target.hit, JSON.stringify(target));
    await page.mouse.click(target.x, target.y);
    await reset.waitFor({ state: "hidden" });
    await list.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await list.locator("[data-selected]").count(), 0);
    await page.screenshot({
      path: `/tmp/loom-computer-instances-${viewport.width}.png`,
    });
    const id = new URL(page.url()).searchParams.get("computer");
    assert.ok(id);
    await page.reload();
    await page.getByTestId("computer-detail").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("computer"), id);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const facts = page.getByTestId("computer-detail");
    await facts.getByText("fixture-os", { exact: true }).waitFor();
    assert.equal(
      await facts
        .getByText("fixture-os", { exact: true })
        .evaluate((el) => getComputedStyle(el).fontFamily.includes("Mono")),
      true,
    );
    const instanceRows = page
      .getByTestId("computer-instances")
      .getByTestId("computer-instance-row");
    await instanceRows.first().waitFor();
    const hit = await instanceRows.first().boundingBox();
    assert.ok(
      hit &&
        hit.height >= 44 &&
        hit.x >= 0 &&
        hit.x + hit.width <= viewport.width,
    );
    await instanceRows.first().focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("loom-role-profile").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("view"), "agents");
    await page.goBack();
    await page.getByTestId("computer-detail").waitFor();
    if (viewport.width < 768) {
      await page
        .getByRole("button", { name: "计算机列表", exact: true })
        .click();
      await row.waitFor();
      await page.getByRole("button", { name: "设置列表", exact: true }).click();
      await page.getByTestId("settings-sidebar-list").waitFor();
    }
    mode = "stale";
    await page.goto(
      `${origin}/?view=computers&computer=${encodeURIComponent(id)}`,
    );
    await page
      .getByTestId("machine-connection-status")
      .filter({ hasText: "状态未知" })
      .waitFor();
    mode = "error";
    await page.reload();
    await page.getByRole("alert").filter({ visible: true }).first().waitFor();
    assert.equal(
      await page.getByTestId("machine-connection-status").count(),
      0,
    );
    mode = "fresh";
    await page
      .getByRole("button", { name: "重试", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page
      .getByTestId("machine-connection-status")
      .filter({ hasText: "在线" })
      .waitFor();
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      selectionReloadBack: "passed",
      modelAndSixRowDisclosure: "passed",
      batchSelectionConfirmCancel: "passed",
      horizontalOverflow: false,
      officialRowKeyboardNavigation: "passed",
      monoFactsAndPointerTargets: "passed",
    });
    await context.close();
  }
  return {
    fixture: true,
    computers: results,
    creation: await verifyRoleCreation({ browser, origin }),
  };
}
