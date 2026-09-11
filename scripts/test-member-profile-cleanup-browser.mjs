import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const evidencePrefix =
  process.env.RAH_PROFILE_EVIDENCE_PREFIX ??
  (process.env.RAH_PROFILE_FORMAL ? "/tmp/profile-formal" : undefined);
const f =
    process.env.RAH_PROFILE_FORMAL === "1"
      ? { origin: "http://127.0.0.1:4173", close: async () => {} }
      : await startShellFixture(),
  b = await chromium.launch({
    headless: true,
    executablePath: await findChromeExecutable(),
  });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${f.origin}/?surface=agents`);
  await p.getByRole("button", { name: /（你）/ }).click();
  await p.waitForTimeout(1000);
  await p.locator(".rah-profile-cards button").first().click();
  await p.locator(".rah-agent-peek").waitFor();
  assert.equal(new URL(p.url()).searchParams.get("memberView"), "human");
  assert.equal(
    (
      await p
        .locator(".rah-agent-directory-page:not(.rah-agent-peek)")
        .boundingBox()
    ).x,
    64,
    "Members must not reserve a second empty chat sidebar",
  );
  await p
    .locator(".rah-agent-peek")
    .getByRole("tab", { name: "资料", exact: true })
    .click();
  assert.equal(
    await p
      .locator(".rah-agent-peek")
      .getByText("管理 Agent", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await p
      .locator(".rah-agent-peek")
      .getByRole("tab", { name: "应用", exact: true })
      .count(),
    0,
  );
  if (evidencePrefix)
    await p.screenshot({ path: `${evidencePrefix}-panel.png` });
  await p.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  assert.equal(
    Math.round((await p.locator(".rah-agent-peek").boundingBox()).width),
    390,
  );
  if (evidencePrefix)
    await p.screenshot({ path: `${evidencePrefix}-mobile.png` });
  await p.setViewportSize({ width: 1440, height: 900 });

  await p
    .locator(".rah-agent-peek")
    .getByRole("button", { name: "编辑运行时配置", exact: true })
    .click();
  const dialog = p.getByRole("dialog", { name: "编辑运行时配置" });
  await dialog.getByRole("button", { name: /^推理强度：/ }).waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "高级", exact: true }).count(),
    0,
  );
  if (evidencePrefix)
    await p.screenshot({ path: `${evidencePrefix}-dialog.png` });
  const modelTrigger = dialog.getByRole("button", { name: /^模型：/ });
  await modelTrigger.hover();
  await p.waitForTimeout(200);
  assert.equal(
    await modelTrigger.evaluate((el) => getComputedStyle(el).transform),
    "matrix(1, 0, 0, 1, 0, -1)",
  );
  await dialog.getByRole("button", { name: /^模型：/ }).click();
  assert.equal(
    await p
      .getByRole("menu")
      .getByText("Runtime 默认", { exact: true })
      .count(),
    0,
  );
  await p.keyboard.press("Escape");
  await dialog.getByRole("button", { name: /^运行时：/ }).click();
  await p.getByRole("menu").locator('[role^="menuitem"]').last().click();
  assert.equal(
    await dialog
      .getByRole("button", { name: "模型：请选择", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await dialog
      .getByRole("button", { name: "保存运行时配置", exact: true })
      .isDisabled(),
    true,
  );
  await p.keyboard.press("Escape");
  await p.goto(f.origin + "/?surface=settings");
  assert.equal(
    await p.getByRole("button", { name: "反馈", exact: true }).count(),
    0,
  );
  assert.equal(
    await p.getByRole("button", { name: "局域网设备", exact: true }).count(),
    0,
  );
  await p.goto(f.origin + "/?surface=agents&memberView=relationship");
  const refresh = p.getByRole("button", { name: "刷新", exact: true });
  await refresh.hover();
  await p.waitForTimeout(200);
  assert.equal(
    await refresh.evaluate((el) => getComputedStyle(el).transform),
    "matrix(1, 0, 0, 1, 0, -1)",
  );
  console.log(
    "PASS Human remains in place, shared Agent drawer, simplified tabs/actions, permanent effort picker, explicit models, removed Settings entries",
  );
} finally {
  await b.close();
  await f.close();
}
