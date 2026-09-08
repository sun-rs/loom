import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const output = process.env.RAH_SEARCH_COUNT_EVIDENCE;
if (!output) throw new Error("RAH_SEARCH_COUNT_EVIDENCE required");
mkdirSync(output, { recursive: true });
const results = [];
for (const engine of ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const post = async (path, data) => {
      const response = await page.request.post(
        `${fixture.origin}/v3/client/${path}`,
        { data },
      );
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const workspace = (await post("workspaces/list", {})).workspaces[0];
    const directory = await post("search", {
      workspaceId: workspace.workspaceId,
      query: "",
    });
    const room = directory.rooms.find((item) => item.roomId === fixture.roomId);
    assert.ok(room, "isolated fixture exposes its real canonical Room");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const query of [room.name, "no-match-search-count-4b6c1"]) {
        await page.goto(
          `${fixture.origin}/?surface=search&q=${encodeURIComponent(query)}`,
        );
        const count = page.locator(".rah-search-count");
        await count.waitFor();
        await page.waitForFunction(() => {
          const visible = document.querySelectorAll(
            ".rah-search-destination, .rah-search-hit",
          ).length;
          return (
            document.querySelector(".rah-search-count")?.textContent ===
            `${visible} 条结果`
          );
        });
        if (query === room.name) {
          assert.ok(await page.locator(".rah-search-destination").count());
          assert.notEqual(await count.textContent(), "0 条结果");
        } else {
          assert.equal(await count.textContent(), "0 条结果");
          await page
            .getByText(`没有找到“${query}”的结果`, { exact: true })
            .waitFor();
        }
        await page.reload();
        await count.waitFor();
        await page.screenshot({
          path: join(
            output,
            `${engine}-${width}-${query === room.name ? "entity" : "empty"}.png`,
          ),
        });
        results.push({
          engine,
          width,
          query,
          count: await count.textContent(),
        });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
console.log(
  JSON.stringify({ output, status: "passed", scenarios: results.length }),
);
