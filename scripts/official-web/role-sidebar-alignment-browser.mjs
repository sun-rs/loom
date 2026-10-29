// Isolated temporary Core; no paid model, product changes or broad page suite.
import assert from "node:assert/strict";
export async function verifyRoleSidebarAlignment({
  browser,
  origin,
  role,
  expectedRuntime = "Codex",
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
        hasTouch: width === 390,
        isMobile: width === 390,
      }),
      page = await context.newPage();
    try {
      await page.goto(origin + "/?view=agents");
      const row = page.locator(`[data-role-id="${role.roleId}"]`);
      await row.waitFor();
      const metrics = await page
        .getByTestId("agent-sidebar-root")
        .evaluate((root) => {
          const base = root.getBoundingClientRect().left,
            scroll = root.querySelector('[data-testid="loom-role-list"]'),
            row = root.querySelector("[data-role-id]"),
            header = root.querySelector('[data-slot="sidebar-section-header"]'),
            group = root.querySelector(
              '[data-testid^="sidebar-agent-machine-group-toggle-"]',
            );
          return {
            scrollInset: scroll.getBoundingClientRect().left - base,
            avatarInset:
              row
                .querySelector('[data-avatar-context="sidebar-list"]')
                .getBoundingClientRect().left - base,
            sectionInset:
              header.getBoundingClientRect().left -
              base +
              parseFloat(getComputedStyle(header).paddingLeft),
            groupInset:
              group.getBoundingClientRect().left -
              base +
              parseFloat(getComputedStyle(group).paddingLeft),
            runtime: row.querySelector('[data-testid="sidebar-agent-runtime"]')
              .textContent,
          };
        });
      await page.screenshot({
        path: `/tmp/loom-role-sidebar-${process.env.LOOM_ALIGNMENT_PHASE ?? "after"}-${width}.png`,
      });
      results.push({ width, ...metrics });
      console.log(JSON.stringify(results.at(-1)));
      assert.equal(
        metrics.scrollInset,
        0,
        "native list cells own horizontal inset",
      );
      assert.equal(
        metrics.avatarInset,
        20,
        "Web139 native list cell: 8px inset + 12px content padding",
      );
      assert.equal(
        metrics.sectionInset,
        20,
        "Web139 native section header px-5",
      );
      assert.equal(
        metrics.groupInset,
        20,
        "Web139 computer group mx-2 plus px-3",
      );
      assert.equal(metrics.runtime, expectedRuntime);
    } finally {
      await context.close();
    }
  }
  return results;
}
