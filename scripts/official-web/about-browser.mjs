import assert from "node:assert/strict";
export async function verifyAbout({ browser, origin }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?view=settings&settings=about");
      const section = page.getByTestId("loom-about-version");
      await section.waitFor({ timeout: 5000 });
      assert.ok((await section.innerText()).includes("Loom"));
      assert.equal(
        await section.locator(".text-subhead.font-semibold").count(),
        1,
      );
      assert.equal(
        await section.locator(".font-mono.text-mono-meta").count(),
        1,
      );
      assert.equal(
        await section.evaluate((el) => {
          const title = el.children[0].getBoundingClientRect();
          const card = el.children[1].getBoundingClientRect();
          return Math.round(card.top - title.bottom);
        }),
        12,
      );
      await page.screenshot({ path: `/tmp/loom-about-native-${width}.png` });
      const version = await page.evaluate(
        () =>
          JSON.parse(
            atob(
              document.querySelector('meta[name="rah-build-identity"]').content,
            ),
          ).version,
      );
      assert.ok((await section.innerText()).includes(version));
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      results.push({ width, versionMatches: true, officialVersionCard: true });
    } finally {
      await context.close();
    }
  }
  return results;
}
