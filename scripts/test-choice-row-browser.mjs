import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, firefox } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
const evidence = mkdtempSync(`${tmpdir()}/rah-choice-state-`);
const server = await createServer({
  root: "apps/web",
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const origin = server.resolvedUrls.local[0];
const color = (row) =>
  row.evaluate((el) => {
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
async function scenario(id, run) {
  await run();
  console.log(JSON.stringify({ scenario: id, passed: true, evidence }));
}
try {
  await scenario("choice-state-profiles", async () => {
    for (const [name, engine] of [
      ["chromium", chromium],
      ["firefox", firefox],
    ]) {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage();
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 844 });
          await page.goto(`${origin}test/choice-row-fixture.html`);
          for (const section of await page.locator("section").all()) {
            const row = section.getByRole("button", {
              name: "成员选择",
              exact: true,
            });
            await row.hover();
            assert.deepEqual(await color(row), [255, 212, 64, 255]);
            await row.click();
            const selected = section.getByRole("button", {
              name: "成员选择 ✓",
              exact: true,
            });
            assert.deepEqual(await color(selected), [255, 229, 238, 255]);
            await page.mouse.move(1, 1);
            assert.deepEqual(await color(selected), [255, 229, 238, 255]);
            for (const label of ["成员浏览", "负责人 ✓"]) {
              const option = section.getByText(label, { exact: true });
              await option.hover();
              assert.deepEqual(await color(option), [255, 242, 197, 255]);
            }
            const disabledMember = section.getByRole("button", {
              name: "语义禁用成员",
              exact: true,
            });
            await disabledMember.hover();
            assert.deepEqual(await color(disabledMember), [255, 255, 255, 255]);
            const box = await disabledMember.boundingBox();
            await page.mouse.click(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            assert.equal(
              await section.getByLabel("禁用激活次数").textContent(),
              "0",
            );
            await disabledMember.evaluate((el) => el.focus());
            await page.keyboard.press("Enter");
            assert.equal(
              await section.getByLabel("禁用激活次数").textContent(),
              "0",
            );
            const auto = section.getByRole("button", {
              name: "自动补全",
              exact: true,
            });
            await auto.hover();
            assert.deepEqual(await color(auto), [255, 233, 159, 255]);
            await auto.focus();
            await page.keyboard.press("ArrowDown");
            assert.deepEqual(await color(auto), [255, 212, 64, 255]);
            await page.mouse.move(1, 1);
            assert.deepEqual(await color(auto), [255, 212, 64, 255]);
            await page.keyboard.press("Escape");
            assert.deepEqual(await color(auto), [255, 255, 255, 255]);
            for (const label of ["禁用成员", "禁用当前候选"]) {
              const disabled = section.getByRole("button", {
                name: label,
                exact: true,
              });
              await disabled.hover();
              assert.deepEqual(await color(disabled), [255, 255, 255, 255]);
            }
          }
          await page.getByRole("button", { name: /负责人/ }).click();
          const a = page.getByRole("menuitemradio", {
            name: "Agent A",
            exact: true,
          });
          await a.hover();
          assert.deepEqual(await color(a), [255, 242, 197, 255]);
          assert.equal(await a.getAttribute("aria-checked"), "true");
          await page.screenshot({ path: `${evidence}/${name}-${width}.png` });
          await page.keyboard.press("Escape");
          await page.reload();
          await page.getByText("隔离颜色验收，无真实 Agent").waitFor();
          await page.goto(`${origin}test/choice-row-fixture.html?mention`);
          const composer = page.getByRole("textbox", { name: "提及输入" });
          await composer.fill("@");
          const choices = page
            .getByRole("listbox", { name: "提及 Agent" })
            .getByRole("option");
          await choices.nth(1).hover();
          assert.deepEqual(await color(choices.nth(1)), [255, 233, 159, 255]);
          assert.deepEqual(await color(choices.nth(0)), [255, 212, 64, 255]);
          await page.keyboard.press("ArrowDown");
          assert.deepEqual(await color(choices.nth(1)), [255, 212, 64, 255]);
          await page.screenshot({
            path: `${evidence}/${name}-${width}-mention.png`,
          });
          await page.keyboard.press("Enter");
          assert.equal(await composer.inputValue(), "@agent-b ");
          assert.equal(await choices.count(), 0);
        }
      } finally {
        await browser.close();
      }
    }
  });
} finally {
  await server.close();
}
