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
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(server.resolvedUrls.local[0] + "test/message-avatar.html");
    await page.locator('[data-testid="human-message"] [role="img"]').waitFor();
    const sizes = await page.evaluate(() =>
      Object.fromEntries(
        ["human-message", "agent-message", "sidebar-human"].map((id) => {
          const r = document
            .querySelector(`[data-testid="${id}"] [role="img"]`)
            .getBoundingClientRect();
          return [id, [r.width, r.height]];
        }),
      ),
    );
    console.log({ width, sizes });
    assert.deepEqual(sizes["human-message"], [36, 36]);
    assert.deepEqual(sizes["agent-message"], [36, 36]);
    assert.deepEqual(sizes["sidebar-human"], [18, 18]);
  }
} finally {
  await browser.close();
  await server.close();
}
