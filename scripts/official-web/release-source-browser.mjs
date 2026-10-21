import assert from "node:assert/strict";
import { loomReleaseNotes } from "../../frontends/raft/loom/release-notes.ts";
export async function verifyReleaseSource({
  browser,
  origin,
  screenshotRoot = "/tmp/loom-release-source",
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      locale: "zh-CN",
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?view=settings&settings=release-notes");
      const cards = page.getByTestId("release-entry");
      await cards.first().waitFor();
      assert.equal(await cards.count(), loomReleaseNotes.length);
      for (let i = 0; i < loomReleaseNotes.length; i++) {
        const card = cards.nth(i),
          release = loomReleaseNotes[i];
        assert.ok((await card.innerText()).includes(release.date));
        const order = [
          "feature",
          "improvement",
          "fix",
          "breaking",
          "deprecated",
        ];
        assert.deepEqual(
          await card.locator("li").allTextContents(),
          order.flatMap((type) =>
            release.entries.filter((e) => e.type === type).map((e) => e.text),
          ),
        );
      }
      assert.equal(
        await cards
          .locator('[data-slot="badge"][data-variant="primary"]')
          .count(),
        1,
      );
      assert.equal(
        await cards.first().locator(".font-mono.text-mono-meta").count(),
        1,
      );
      await cards.last().scrollIntoViewIfNeeded();
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({ path: `${screenshotRoot}-${width}.png` });
      await page.reload();
      await cards.first().waitFor();
      assert.equal(await cards.count(), loomReleaseNotes.length);
      results.push({
        width,
        entries: loomReleaseNotes.length,
        officialCategoryOrder: true,
        singleCurrentBadge: true,
        reload: true,
        noOverflow: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
