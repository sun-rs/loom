import assert from "node:assert/strict";

// The URL query and interactive layout must commit together. A deferred route
// commit used to replace/move the all-results button between down and up.
export async function verifySearchTransition({ browser, origin, channels }) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    await page.goto(`${origin}/?room=${channels[0].roomId}`);
    await page.getByTestId("app-top-bar-search").click();
    const input = page.getByRole("textbox", { name: "搜索内容" });
    await input.waitFor();
    const committed = await input.evaluate((element) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(element, "fixture");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        query: new URLSearchParams(location.search).get("q"),
        filters: !!document.querySelector('[data-slot="search-shell-filters"]'),
        label: document.querySelector('[data-testid="search-view-all-results"]')
          ?.textContent,
      };
    });
    assert.equal(committed.query, "fixture");
    assert.equal(
      committed.filters,
      true,
      "query route must not precede clickable layout",
    );
    assert.match(committed.label, /fixture/);
    const button = page.getByTestId("search-view-all-results");
    const rect = await button.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page
      .getByTestId("desktop-search-overlay")
      .waitFor({ state: "hidden" });
    assert.equal(new URL(page.url()).searchParams.get("presentation"), "page");
    return { searchTransition: "passed", heldPointer: true };
  } finally {
    await page.close();
  }
}
