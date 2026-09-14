import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const f = await startShellFixture(),
  b = await (
    process.env.RAH_TEST_ENGINE === "firefox" ? firefox : chromium
  ).launch({
    headless: true,
    ...(process.env.RAH_TEST_ENGINE === "firefox"
      ? {}
      : { executablePath: await findChromeExecutable() }),
  });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(f.origin + "/?surface=computers");
  await p.getByRole("button", { name: "选择 Agent", exact: true }).click();
  assert.equal(
    await p.getByRole("button", { name: "创建 Agent", exact: true }).count(),
    0,
  );
  assert.equal(
    await p.locator(".rah-computer-bulk-actions").count(),
    0,
    "zero selection has no action strip",
  );
  await p.mouse.move(0, 0);
  await p.waitForTimeout(250);
  const all = p.getByRole("button", { name: "全选 Agent", exact: true });
  assert.equal(
    (await all.boundingBox()).y,
    (await p.getByRole("button", { name: "结束选择" }).boundingBox()).y,
  );
  const row = p.locator(".rah-computer-select-row").first();
  assert.equal(
    await row.locator("input").evaluate((e) => getComputedStyle(e).borderColor),
    "rgb(0, 0, 0)",
  );
  await row.locator("button").click();
  assert.equal(
    await row.locator("input").isChecked(),
    true,
    "card click must select instead of opening inspector",
  );
  assert.ok(
    (await row.locator("button").boundingBox()).height >= 54,
    "computer card height",
  );
  assert.equal(await row.getAttribute("data-selected"), "true");
  await p.mouse.move(0, 0);
  await p.waitForTimeout(250);
  assert.notEqual(
    await row
      .locator("button")
      .evaluate((el) => getComputedStyle(el).boxShadow),
    "none",
  );
  assert.equal(
    (
      await p
        .getByRole("button", { name: "重启 / 重置所选", exact: true })
        .boundingBox()
    ).height,
    28,
  );

  const cardBox = await row.boundingBox();
  for (const section of await p
    .locator(".rah-computer-agents-section ~ .rah-profile-section")
    .all()) {
    const box = await section.boundingBox();
    assert.equal(box.x, cardBox.x);
    assert.equal(box.width, cardBox.width);
  }
  const hint = p.locator(".rah-workspace-scan-hint");
  assert.equal(
    await hint.innerText(),
    "点击扫描，检查这台 Computer 上的工作区目录。",
  );
  assert.equal(
    await hint.evaluate((e) => getComputedStyle(e).fontSize),
    "12px",
  );
  await p.screenshot({ path: "/tmp/computer-controls-refined.png" });
  assert.equal(
    await p
      .locator(".rah-computer-start-icon")
      .evaluate((e) => getComputedStyle(e).fill),
    "none",
  );
  assert.notEqual(
    await p
      .locator(".rah-computer-start-icon")
      .evaluate((e) => getComputedStyle(e).stroke),
    "none",
    "outline must remain visible",
  );
  await p.getByRole("button", { name: "停止", exact: true }).click();
  const stop = p.getByRole("dialog", { name: "停止 Agent", exact: true });
  await stop.waitFor();
  assert.match(await stop.innerText(), /要停止选中的 1 个在线 Agent 吗/);
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.equal((await stop.boundingBox()).width, Math.min(384, width - 32));
    for (const label of ["取消", "停止 Agent"])
      assert.equal(
        (
          await stop
            .getByRole("button", { name: label, exact: true })
            .boundingBox()
        ).height,
        28,
      );
    assert.ok(
      (await stop.boundingBox()).height < 400,
      "confirmation remains content sized",
    );
    await p.screenshot({
      path:
        "/tmp/computer-stop-" +
        (process.env.RAH_TEST_ENGINE ?? "chrome") +
        "-" +
        width +
        ".png",
    });
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  await stop.getByRole("button", { name: "取消", exact: true }).click();
  await stop.waitFor({ state: "hidden" });
  assert.equal(
    await p.getByRole("button", { name: "停止", exact: true }).isEnabled(),
    true,
  );

  await p.getByRole("button", { name: "重启 / 重置所选", exact: true }).click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await dialog.locator("h2").innerText(), "重启 1 个 Agent");
  assert.doesNotMatch(await dialog.innerText(), /重新启动|所选|完全重置/);
  for (const name of ["取消", "重启"]) {
    const button = dialog.getByRole("button", { name, exact: true });
    assert.equal((await button.boundingBox()).width, name === "取消" ? 64 : 84);
    assert.deepEqual(
      await button.evaluate((e) => {
        const s = getComputedStyle(e);
        return {
          height: e.getBoundingClientRect().height,
          font: s.fontSize,
          line: s.lineHeight,
          padding: s.paddingLeft,
        };
      }),
      { height: 40, font: "14px", line: "20px", padding: "16px" },
    );
  }
  await p.screenshot({ path: "/tmp/computer-selection-dialog.png" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  let requests = 0;
  await p.route("**/v3/client/agents/manage", async (route) => {
    requests++;
    if (requests === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary stop failure" }),
      });
    else await route.continue();
  });
  await p.getByRole("button", { name: "停止", exact: true }).click();
  assert.equal(requests, 0, "opening confirmation does not stop Agents");
  await p.keyboard.press("Escape");
  await stop.waitFor({ state: "hidden" });
  assert.equal(requests, 0, "Escape does not stop Agents");
  await p.getByRole("button", { name: "停止", exact: true }).click();
  await stop.getByRole("button", { name: "停止 Agent", exact: true }).click();
  await stop.getByRole("alert").waitFor();
  assert.equal(requests, 1, "failure stays in the dialog");
  await stop.getByRole("button", { name: "停止 Agent", exact: true }).click();
  await stop.waitFor({ state: "hidden" });
  assert.equal(requests, 2, "explicit retry succeeds");
  assert.equal(
    await p.getByRole("button", { name: "停止", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await p.getByRole("button", { name: "启动", exact: true }).isEnabled(),
    true,
  );
  console.log(
    "PASS card selection, selected color hook, size and batch reset dialog",
  );
} finally {
  await b.close();
  await f.close();
}
