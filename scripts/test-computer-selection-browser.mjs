import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({
    headless: true,
    executablePath: await findChromeExecutable(),
  });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(f.origin + "/?surface=computers");
  await p.getByRole("button", { name: "选择 Agent", exact: true }).click();
  assert.equal(
    await p.getByRole("button", { name: "创建 Agent", exact: true }).count(),
    0,
  );
  const all = p.getByRole("button", { name: "全选 Agent", exact: true });
  assert.equal(
    (await all.boundingBox()).y,
    (await p.getByRole("button", { name: "结束选择" }).boundingBox()).y,
  );
  const row = p.locator(".rah-computer-select-row").first();
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
  await p.screenshot({ path: "/tmp/computer-controls-refined.png" });
  await p.getByRole("button", { name: "重启 / 重置所选", exact: true }).click();
  await p.getByRole("dialog").waitFor();
  await p.screenshot({ path: "/tmp/computer-selection-dialog.png" });
  console.log(
    "PASS card selection, selected color hook, size and batch reset dialog",
  );
} finally {
  await b.close();
  await f.close();
}
