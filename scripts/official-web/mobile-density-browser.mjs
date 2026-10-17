// Temporary Core/Fake CLI only. Layout assertions never submit provider work.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
export async function verifyMobileDensity({ browser, origin, channels }) {
  const results = [];
  const output = process.env.LOOM_MOBILE_EVIDENCE;
  if (output) await mkdir(output, { recursive: true });
  for (const preset of ["brutal", "elegant-light"]) {
    for (const [width, height] of [
      [390, 844],
      [360, 640],
      [390, 560],
      [1440, 1000],
    ]) {
      const mobile = width < 768;
      console.log(
        JSON.stringify({
          engine: process.env.LOOM_BROWSER_ENGINE ?? "chromium",
          preset,
          width,
          height,
          stage: "density",
        }),
      );
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        hasTouch: mobile,
        isMobile: mobile,
      });
      await context.addInitScript(
        (p) => localStorage.setItem("slock-theme-preset", p),
        preset,
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(origin + "/?room=" + channels[0].roomId);
        const input = page.getByTestId("composer-textarea");
        await input.waitFor();
        await page.getByTestId("loom-message-timeline").waitFor();
        const shell = page.getByTestId("chat-composer-shell");
        const readHeight = (await shell.boundingBox()).height;
        const headerHeight = await page
          .locator('[data-slot="panel-header"]')
          .filter({ visible: true })
          .last()
          .evaluate((e) => e.getBoundingClientRect().height);
        if (output)
          await page.screenshot({
            path: `${output}/${preset}-${width}-${height}-reading.png`,
          });
        if (mobile) {
          assert.ok(
            readHeight <= 60,
            `reading composer ${preset}/${width}: ${readHeight} exceeds 60`,
          );
          assert.ok(
            headerHeight <= 48,
            `mobile header ${headerHeight} exceeds 48`,
          );
          const plus = shell.getByRole("button", {
            name: "引用计算机文件或文件夹",
          });
          const hit = await plus.boundingBox();
          assert.ok(
            hit.width >= 40 && hit.height >= 40,
            "file control keeps a touch target",
          );
          await plus.click();
          await page.getByRole("dialog").waitFor();
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          // The file window returns focus on the next animation frame. Do not
          // race WebKit fill against that documented focus return.
          await page.waitForFunction(
            () =>
              document.activeElement?.getAttribute("aria-label") ===
              "引用计算机文件或文件夹",
          );
        }
        async function checkFilePosition() {
          const plus = shell.getByRole("button", {
            name: "引用计算机文件或文件夹",
          });
          const box = await plus.boundingBox();
          const toolbar = shell.locator('[data-slot="composer-toolbar"]');
          const bounds = await toolbar.boundingBox();
          const rightPadding = await toolbar.evaluate((el) =>
            parseFloat(getComputedStyle(el).paddingRight),
          );
          assert.ok(
            Math.abs(
              box.x + box.width - bounds.x - bounds.width + rightPadding,
            ) <= 2,
            "plus stays at toolbar content right edge",
          );
          const task = page.getByTestId("composer-as-task-toggle");
          if (await task.isVisible()) {
            const t = await task.boundingBox();
            assert.ok(
              t.x + t.width <= box.x,
              "task control does not overlap plus",
            );
            assert.ok(
              await task.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return el.contains(
                  document.elementFromPoint(
                    r.x + r.width / 2,
                    r.y + r.height / 2,
                  ),
                );
              }),
              "task control remains clickable",
            );
          }
          return box.x;
        }
        const idlePlusX = await checkFilePosition();
        await input.focus();
        assert.ok(
          Math.abs((await checkFilePosition()) - idlePlusX) <= 2,
          "focus does not move plus sideways",
        );
        await input.fill("FIXTURE 草稿\n第二行");
        await input.blur();
        await checkFilePosition();
        const draftHeight = (await shell.boundingBox()).height;
        if (output && width === 390 && height === 844)
          await page.screenshot({ path: `${output}/${preset}-draft.png` });
        if (mobile)
          assert.ok(
            draftHeight > readHeight,
            "draft keeps expanded composer even after blur",
          );
        assert.equal(await input.inputValue(), "FIXTURE 草稿\n第二行");
        if (mobile) {
          await page.evaluate(() =>
            document.documentElement.style.setProperty("--vv-height", "440px"),
          );
          const bounds = await input.boundingBox();
          assert.ok(
            bounds.y + bounds.height <= 440,
            "composer remains inside keyboard-reduced visual viewport",
          );
          await page.evaluate(() =>
            document.documentElement.style.removeProperty("--vv-height"),
          );
        }
        await input.fill("");
        await input.blur();
        assert.equal(
          Math.round((await shell.boundingBox()).height),
          Math.round(readHeight),
          "empty blur restores reading layout",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        if (mobile) {
          await input.focus();
          const task = page.getByTestId("composer-as-task-toggle");
          await task.click();
          await input.blur();
          await task.blur();
          assert.equal(
            await task.isVisible(),
            true,
            "selected task mode remains visible even with an empty draft",
          );
          assert.ok((await shell.boundingBox()).height > readHeight);
          await task.click();
          await task.blur();
          await input.blur();
        }
        const bodyHeight = (
          await page.getByTestId("loom-message-timeline").boundingBox()
        ).height;
        if (mobile)
          assert.ok(
            bodyHeight / height >= 0.72,
            "short viewport retains at least 72% message area without keyboard",
          );
        await page.goto(origin + "/?chat=list");
        if (mobile) {
          const nav = page.getByRole("navigation", { name: "主导航" });
          await nav.waitFor();
          assert.ok(
            (await nav.boundingBox()).height <= 50,
            "icon navigation remains compact",
          );
          await nav.getByRole("button", { name: "设置", exact: true }).click();
          await page.getByTestId("settings-sidebar-header").waitFor();
        }
        assert.deepEqual(errors, []);
        results.push({
          preset,
          width,
          height,
          readHeight,
          draftHeight,
          headerHeight,
          bodyHeight,
        });
      } finally {
        await context.close();
      }
    }
  }
  return results;
}
