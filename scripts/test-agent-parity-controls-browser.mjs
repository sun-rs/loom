import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  page.on("pageerror", (e) => console.error(e.message));
  const failures = [];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const origin =
      server.resolvedUrls.local[0] + "test/agent-parity-controls.html";
    for (const mode of ["header", "create", "runtime"]) {
      try {
        await page.goto(origin + "?mode=" + mode);
        if (mode === "header") {
          const button = page.getByRole("button", {
            name: "给 Fixture Agent 发消息",
          });
          await button.waitFor({ state: "attached" });
          assert.equal(
            await button.isVisible(),
            true,
            "desktop header DM action visible",
          );
          await button.click();
          assert.equal(await page.locator("output").textContent(), "1");
        } else if (mode === "create") {
          await page.getByRole("dialog").waitFor();
          const labels = await page
            .locator(".rah-agent-create-dialog label")
            .evaluateAll((labels) =>
              labels
                .filter((l) => l.querySelector("em"))
                .map((l) => {
                  const em = l.querySelector("em");
                  const caption = em.parentElement;
                  return (
                    caption.tagName !== "LABEL" &&
                    Math.abs(
                      em.getBoundingClientRect().top -
                        caption.getBoundingClientRect().top,
                    ) < 4
                  );
                }),
            );
          assert.ok(
            labels.length >= 3 && labels.every(Boolean),
            "required markers share caption line",
          );
          const textarea = page.locator("textarea").first();
          await textarea.fill("abc");
          assert.equal(
            await page.getByText("3/3000", { exact: true }).count(),
            1,
            "live description count",
          );
        } else {
          await page.getByRole("dialog").waitFor();
          const effort = page.getByRole("button", { name: /^推理强度：/ });
          assert.equal(
            await effort.isVisible(),
            false,
            "advanced starts collapsed",
          );
          await page.getByRole("button", { name: "高级", exact: true }).click();
          assert.equal(
            await effort.isVisible(),
            true,
            "advanced reveals preserved effort control",
          );
          await page.keyboard.press("Escape");
          await page.getByText("Fixture closed").waitFor();
        }
        console.log({ width, mode, passed: true });
      } catch (error) {
        failures.push(`${width} ${mode}: ${error.message}`);
      }
    }
  }
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await server.close();
}
