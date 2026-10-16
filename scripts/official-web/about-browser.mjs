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
