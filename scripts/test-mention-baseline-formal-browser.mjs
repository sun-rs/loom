import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { chromium, webkit } from "playwright";
import {
  classifyFormalBrowserRequest,
  parseFormalBrowserTarget,
} from "./formal-browser-request-policy.mjs";

const { origin, databasePath } = parseFormalBrowserTarget(process.env);
const db = new DatabaseSync(databasePath, { readOnly: true });
const target = db
  .prepare(
    `SELECT m.room_id FROM messages m JOIN rooms r ON r.room_id=m.room_id
  WHERE r.archived_at IS NULL AND m.thread_id IS NULL AND EXISTS
  (SELECT 1 FROM principals p WHERE p.kind='human' AND
  (instr(m.body,'@'||p.handle)>0 OR instr(m.body,'@'||p.display_name)>0))
  ORDER BY m.created_at DESC LIMIT 1`,
  )
  .get();
assert.ok(target, "An existing Human mention is needed for formal acceptance");
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      for (const width of [1440, 390]) {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
          isMobile: width === 390,
          hasTouch: width === 390,
        });
        const errors = [],
          rejected = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/*", (route) => {
          const request = route.request();
          const decision = classifyFormalBrowserRequest({
            method: request.method(),
            url: request.url(),
            origin,
          });
          if (decision.decision === "reject") {
            rejected.push(decision.identity);
            return route.abort();
          }
          return route.continue();
        });
        await page.goto(
          `${origin}/?room=${encodeURIComponent(target.room_id)}`,
        );
        const mention = page.locator(".rah-rich-self-reference").first();
        await mention.waitFor();
        await page.evaluate(() => document.fonts.ready);
        for (const reference of await page
          .locator(".rah-rich-reference")
          .all()) {
          assert.equal(
            await reference.evaluate((e) => getComputedStyle(e).verticalAlign),
            "baseline",
          );
          assert.equal(
            await reference.locator(".rah-reference-label").count(),
            1,
          );
        }
        assert.equal(
          await mention.evaluate((e) => getComputedStyle(e).verticalAlign),
          "baseline",
        );
        assert.equal(await mention.locator(".rah-reference-label").count(), 1);
        await mention.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/rah-mention-formal-${engine.name()}-${width}.png`,
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(rejected, []);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  console.log(
    "Existing formal Human mentions use baseline layout in desktop/mobile Chromium and WebKit; no mutation requests allowed.",
  );
} finally {
  db.close();
}
