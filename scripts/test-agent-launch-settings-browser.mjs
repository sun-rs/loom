import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.setDefaultTimeout(10000);
  await p.goto(f.origin + "/?surface=agents");
  let globalSettings = await (
    await p.request.post(f.origin + "/v3/client/runtime-guide/read", {
      data: {},
    })
  ).json();
  for (const runtime of globalSettings.runtimes) {
    const response = await p.request.post(
      f.origin + "/v3/client/runtime-guide/update",
      {
        data: {
          runtimeId: runtime.runtimeId,
          expectedRevision: globalSettings.revision,
          environment: { LABEL: "global" },
          additionalArgs: ["--debug"],
        },
      },
    );
    assert.equal(response.status(), 409);
  }

  await p.locator(".rah-agent-member-row").first().click();
  const section = p.locator(".rah-agent-runtime-section");
  const heading = section.locator("h3").first();
  const edit = section.getByRole("button", {
    name: "编辑运行时配置",
    exact: true,
  });
  const distance = await heading.evaluate((el) => {
    const text = document.createRange();
    text.selectNodeContents(el.firstChild);
    return (
      el.querySelector("button").getBoundingClientRect().x -
      text.getBoundingClientRect().right
    );
  });
  assert.ok(distance <= 12, `edit gap ${distance}`);
  await edit.click();
  const dialog = p.getByRole("dialog", { name: "编辑运行时配置" });
  const refresh = dialog.getByRole("button", { name: "刷新模型", exact: true });
  assert.deepEqual(
    await refresh.evaluate((el) => ({
      border: getComputedStyle(el).borderTopWidth,
      icon: el.querySelector("svg").getBoundingClientRect().width,
    })),
    { border: "0px", icon: 12 },
  );
  assert.equal((await refresh.boundingBox()).width, 24);
  await dialog.getByRole("button", { name: /^模型：/ }).click();
  await p.locator('[role="menuitemradio"]:not(:disabled)').first().click();
  await dialog.getByText("更多", { exact: true }).click();
  const editor = dialog.locator(".rah-agent-launch-settings");
  await p.mouse.move(0, 0);
  assert.deepEqual(
    await editor.locator("summary").evaluate((el) => ({
      color: getComputedStyle(el).color,
      font: getComputedStyle(el).fontSize,
    })),
    { color: "rgba(0, 0, 0, 0.6)", font: "14px" },
  );
  const add = editor.getByRole("button", { name: "添加变量", exact: true });
  const idleBox = await add.boundingBox();
  await add.hover();
  await p.waitForTimeout(150);
  assert.deepEqual(
    await add.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.borderTopWidth, s.borderTopColor];
    }),
    ["oklch(0.9645 0.0002 25)", "2px", "oklch(0.18 0.006 25)"],
  );
  assert.deepEqual(await add.boundingBox(), idleBox);
  await p.screenshot({ path: "/tmp/rah-add-variable-hover.png" });
  await p.mouse.move(0, 0);
  await p.waitForTimeout(150);
  assert.equal(
    await add.evaluate((el) => getComputedStyle(el).borderTopColor),
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(
    await add.evaluate((el) => getComputedStyle(el).fontSize),
    "12px",
  );
  assert.ok(
    await add.evaluate(
      (el) =>
        parseFloat(getComputedStyle(el).fontSize) <
        parseFloat(
          getComputedStyle(el.parentElement.querySelector("strong")).fontSize,
        ),
    ),
  );

  await editor.getByRole("button", { name: "添加变量", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "环境变量名称 1", exact: true })
    .fill("LABEL");
  await editor
    .getByRole("textbox", { name: "环境变量值 1", exact: true })
    .fill("agent-only");
  assert.equal(
    await editor.getByRole("textbox", { name: /附加参数$/ }).count(),
    0,
  );
  assert.equal(
    await editor
      .getByRole("button", { name: "保存启动配置", exact: true })
      .count(),
    0,
  );
  await dialog
    .getByRole("button", { name: "保存运行时配置", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await section
    .getByText("LABEL=••••••••", { exact: true })
    .waitFor()
    .catch(async (e) => {
      await p.screenshot({ path: "/tmp/rah-runtime-summary-failure.png" });
      console.log(await section.innerText());
      throw e;
    });
  assert.equal(await section.locator('[title*="agent-only"]').count(), 0);
  assert.ok(!(await section.innerText()).includes("agent-only"));
  await p.screenshot({ path: "/tmp/rah-runtime-summary-saved.png" });
  await p.getByRole("button", { name: "编辑运行时配置", exact: true }).click();
  await dialog.getByText("更多", { exact: true }).click();
  assert.equal(
    await editor
      .getByRole("textbox", { name: "环境变量值 1", exact: true })
      .inputValue(),
    "agent-only",
  );
  await editor
    .getByRole("textbox", { name: "环境变量值 1", exact: true })
    .fill("second-save");
  await dialog
    .getByRole("button", { name: "保存运行时配置", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await edit.click();
  await dialog.getByText("更多", { exact: true }).click();
  assert.equal(
    await editor
      .getByRole("textbox", { name: "环境变量值 1", exact: true })
      .inputValue(),
    "second-save",
  );
  await editor.getByRole("button", { name: "添加变量", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "环境变量名称 2", exact: true })
    .fill("LABEL");
  assert.equal(
    await dialog
      .getByRole("button", { name: "保存运行时配置", exact: true })
      .isDisabled(),
    true,
  );
  await editor
    .getByRole("button", { name: "删除环境变量 2", exact: true })
    .click();
  const global = await p.request.post(
    f.origin + "/v3/client/runtime-guide/read",
    { data: {} },
  );
  const globals = await global.json();
  assert.ok(
    globals.runtimes.every(
      (row) =>
        Object.keys(row.environment).length === 0 &&
        row.additionalArgs.length === 0,
    ),
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: "/tmp/rah-agent-launch-editor-mobile.png" });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  console.log(
    "Agent-scoped environment saved/reloaded without changing global values; desktop/mobile passed",
  );
} finally {
  await b.close();
  await f.close();
}
