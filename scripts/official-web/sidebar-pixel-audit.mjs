// Read-only UI measurement on a disposable Core; reports differences, never certifies parity.
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { readSidebarSpacing } from "./sidebar-spacing-metrics.mjs";
export async function auditSidebarPixels({
  browser,
  origin,
  client,
  workspace,
  channels,
  role,
  head,
}) {
  const prefix = process.env.LOOM_PIXEL_AUDIT_PREFIX ?? "/tmp/loom-pixel-audit";
  const prefs = (
    await client.request("sidebar.get", { workspaceId: workspace.workspaceId })
  ).preferences;
  await client.request("sidebar.patch", {
    workspaceId: workspace.workspaceId,
    expectedVersion: prefs.version,
    idempotencyKey: "pixel-audit-pin",
    patch: { pinned: [`room:${channels[0].roomId}`] },
  });
  await client.request("role.create", {
    controlRoomId: workspace.controlRoomId,
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "pixel-second-role",
    configuration: {
      ...role.configuration,
      displayName: "FixtureSecond",
      handle: "FixtureSecond",
    },
  });
  await client.request("role.create", {
    controlRoomId: workspace.controlRoomId,
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "pixel-unbound-role",
    configuration: {
      ...role.configuration,
      displayName: "FixtureUnbound",
      handle: "FixtureUnbound",
      runtimeOfferId: "fixture-unknown-offer",
    },
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "zh-CN",
    }),
    page = await context.newPage();
  try {
    const spacing = {};
    await page.goto(origin + "/?view=agents");
    await page.locator(`[data-role-id="${role.roleId}"]`).waitFor();
    spacing.roles = await page
      .getByTestId("agent-sidebar-root")
      .evaluate(readSidebarSpacing);
    const roles = await page
      .getByTestId("agent-sidebar-root")
      .evaluate((root) => {
        const base = root.getBoundingClientRect(),
          rows = [...root.querySelectorAll("[data-role-id]")],
          r = rows[0].getBoundingClientRect(),
          h = root.querySelector('[data-slot="sidebar-section-header"]'),
          g = root.querySelector(
            '[data-testid^="sidebar-agent-machine-group-toggle-"]',
          ),
          avatar = rows[0].querySelector(
            '[data-avatar-context="sidebar-list"]',
          );
        const hs = getComputedStyle(h),
          pseudo = getComputedStyle(rows[0], "::before");
        return {
          avatarInset: avatar.getBoundingClientRect().left - base.left,
          headerInset:
            h.getBoundingClientRect().left -
            base.left +
            parseFloat(hs.paddingLeft),
          headerBottomPadding: parseFloat(hs.paddingBottom),
          rowHeight: r.height,
          rowGap: rows[1].getBoundingClientRect().top - r.bottom,
          groupInset:
            g.getBoundingClientRect().left -
            base.left +
            parseFloat(getComputedStyle(g).paddingLeft),
          groupToFirstRow: r.top - g.getBoundingClientRect().bottom,
          hoverInset: r.left - base.left + parseFloat(pseudo.left),
        };
      });
    await page.screenshot({ path: `${prefix}-roles.png` });
    await page.goto(origin + "/?view=channels");
    await page
      .locator(`[data-public-channel-id="${channels[0].roomId}"]`)
      .waitFor();
    const channelsMetrics = await page
      .getByTestId("public-server-channel-sidebar-root")
      .evaluate((root) => {
        const base = root.getBoundingClientRect(),
          pin = root.querySelector(
            '[data-testid="sidebar-section-block-pinned"]',
          ),
          section = root.querySelector(
            '[data-testid="sidebar-section-block-channels"]',
          ),
          h = section.querySelector('[data-slot="sidebar-section-header"]'),
          r = section.querySelector("[data-public-channel-id]"),
          last = pin.querySelector("[data-public-channel-id]"),
          b = r.getBoundingClientRect(),
          hb = h.getBoundingClientRect(),
          p = getComputedStyle(r, "::before");
        const rows = [...section.querySelectorAll("[data-public-channel-id]")];
        return {
          rowHeight: b.height,
          rowGap: rows[1].getBoundingClientRect().top - b.bottom,
          headerBottomPadding: parseFloat(getComputedStyle(h).paddingBottom),
          headerToHover: b.top - hb.bottom,
          hoverInset: b.left - base.left + parseFloat(p.left),
          lastPinnedRowToNextHeaderBox:
            hb.top - last.getBoundingClientRect().bottom,
          lastPinnedRowToNextHeaderContent:
            hb.top +
            parseFloat(getComputedStyle(h).paddingTop) -
            last.getBoundingClientRect().bottom,
          sectionMarginBottom: parseFloat(getComputedStyle(pin).marginBottom),
        };
      });
    await page.screenshot({ path: `${prefix}-channels.png` });
    spacing.chat = await page
      .getByTestId("public-server-channel-sidebar-root")
      .evaluate(readSidebarSpacing);
    await page.goto(origin + "/?view=computers");
    await page.getByTestId("computer-desktop-row").waitFor();
    const computers = await page
      .getByTestId("computer-desktop-row")
      .evaluate((r) => {
        const root = r.closest('[data-slot="sidebar-root"]'),
          base = root.getBoundingClientRect(),
          h = root.querySelector('[data-testid="computer-section-header"]'),
          b = r.getBoundingClientRect(),
          p = getComputedStyle(r, "::before"),
          hs = getComputedStyle(h);
        return {
          iconInset:
            r
              .querySelector('[data-slot="sidebar-item-icon"]')
              .getBoundingClientRect().left - base.left,
          headerInset:
            h.getBoundingClientRect().left -
            base.left +
            parseFloat(hs.paddingLeft),
          headerBottomPadding: parseFloat(hs.paddingBottom),
          headerToHover: b.top - h.getBoundingClientRect().bottom,
          hoverInset: b.left - base.left + parseFloat(p.left),
          rowHeight: b.height,
        };
      });
    await page.screenshot({ path: `${prefix}-computers.png` });
    spacing.computers = await page
      .getByTestId("computer-desktop-row")
      .first()
      .locator("xpath=ancestor::*[@data-slot='sidebar-root'][1]")
      .evaluate(readSidebarSpacing);
    await page.goto(origin + "/?view=settings");
    await page.getByTestId("settings-sidebar-root").waitFor();
    spacing.settings = await page
      .getByTestId("settings-sidebar-root")
      .evaluate(readSidebarSpacing);
    await page.screenshot({ path: `${prefix}-settings.png` });
    const interactions = {};
    if (process.env.LOOM_PIXEL_AUDIT_EXPECT === "139") {
      await page.goto(origin + "/?view=agents");
      const roleRows = page.locator("[data-role-id]");
      await roleRows.nth(1).hover();
      await page.waitForFunction(() => {
        const el = document.querySelectorAll("[data-role-id]")[1];
        return (
          getComputedStyle(el, "::before").backgroundColor !==
          "rgba(0, 0, 0, 0)"
        );
      });
      assert.equal(
        await roleRows
          .nth(1)
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgba(0, 0, 0, 0)",
        "hover paints only the inset pseudo frame",
      );
      const group = page.locator(
        '[data-testid^="sidebar-agent-machine-group-toggle-"]',
      );
      await group.click();
      assert.equal(await roleRows.count(), 0);
      await group.focus();
      await page.keyboard.press("Enter");
      await roleRows.nth(1).waitFor();
      await page.goto(origin + "/?view=channels");
      const beta = page.locator(
        `[data-public-channel-id="${channels[1].roomId}"]`,
      );
      await beta.click({ button: "right" });
      await page.getByRole("menuitem", { name: "置顶", exact: true }).waitFor();
      assert.equal(
        await beta.evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgba(0, 0, 0, 0)",
        "open context menu retains the native inset frame",
      );
      assert.match(
        await beta.getAttribute("class"),
        /before:bg-fill-cell-hover/,
      );
      await page.keyboard.press("Escape");
      const section = page.locator(
        '[data-testid="sidebar-section-block-channels"]',
      );
      const heading = section.locator("[data-section-handle]");
      await heading.click();
      assert.equal(await beta.isVisible(), false);
      assert.equal(
        await page
          .locator(`[data-public-channel-id="${channels[0].roomId}"]`)
          .isVisible(),
        true,
        "collapsing Channels retains Pinned",
      );
      await heading.click();
      const ids = () =>
        section
          .locator("[data-public-channel-id]")
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-public-channel-id")),
          );
      const before = await ids();
      const first = await beta.boundingBox(),
        last = await section
          .locator("[data-public-channel-id]")
          .last()
          .boundingBox();
      await page.mouse.move(
        first.x + first.width / 2,
        first.y + first.height / 2,
      );
      await page.mouse.down();
      const written = page.waitForResponse(
        (r) => r.url().endsWith("/sidebar/patch") && r.status() === 200,
      );
      await page.mouse.move(last.x + last.width / 2, last.y + last.height - 2, {
        steps: 12,
      });
      await page.mouse.up();
      await written;
      await page.waitForFunction(
        ({ id, original }) =>
          JSON.stringify(
            [
              ...document.querySelectorAll(
                `[data-testid="sidebar-section-block-${id}"] [data-public-channel-id]`,
              ),
            ].map((el) => el.getAttribute("data-public-channel-id")),
          ) !== JSON.stringify(original),
        { id: "channels", original: before },
      );
      const after = await ids();
      assert.deepEqual(
        after,
        [...before].reverse(),
        "native list wrapper keeps the existing sortable row contract",
      );
      await page.reload();
      await beta.waitFor();
      assert.deepEqual(await ids(), after, "dragged order remains durable");
      interactions.insetHoverAndMenu = true;
      interactions.collapseKeyboardAndIndependentSections = true;
      interactions.dragPersists = true;
      await page.goto(origin + "/?view=settings");
      const settings = page.getByTestId("settings-sidebar-list");
      await settings.waitFor();
      const gap = await settings.evaluate((root) => {
        const rows = root.querySelectorAll('[data-slot="sidebar-item"]');
        return (
          rows[1].getBoundingClientRect().top -
          rows[0].getBoundingClientRect().bottom
        );
      });
      assert.equal(gap, 2, "settings shares the acquired native list spacing");
      await page.screenshot({ path: `${prefix}-settings.png` });
      interactions.settingsNativeListGap = gap;
    }
    const result = {
      fixtureOnly: true,
      paidProviders: false,
      browser: browser.browserType().name(),
      viewport: { width: 1440, height: 1000, dpr: 1, zoom: 1 },
      roles,
      channels: channelsMetrics,
      computers,
      interactions,
      spacing,
    };
    if (process.env.LOOM_PIXEL_AUDIT_OUTPUT)
      await writeFile(
        process.env.LOOM_PIXEL_AUDIT_OUTPUT,
        JSON.stringify(result, null, 2) + "\n",
      );
    if (process.env.LOOM_PIXEL_AUDIT_EXPECT === "139") {
      assert.equal(roles.avatarInset, 20, "native Web139 Role content inset");
      assert.equal(roles.headerInset, 20);
      assert.equal(roles.groupInset, 20);
      assert.equal(roles.rowGap, 2);
      assert.equal(roles.groupToFirstRow, 8);
      assert.equal(roles.rowHeight, 38);
      assert.equal(roles.hoverInset, 8);
      assert.equal(channelsMetrics.rowGap, 2);
      assert.equal(channelsMetrics.rowHeight, 38);
      assert.equal(channelsMetrics.headerToHover, 8);
      assert.equal(channelsMetrics.hoverInset, 8);
      assert.equal(channelsMetrics.lastPinnedRowToNextHeaderBox, 8);
      assert.equal(channelsMetrics.lastPinnedRowToNextHeaderContent, 24);
      assert.equal(channelsMetrics.sectionMarginBottom, 0);
      assert.equal(computers.iconInset, 20);
      assert.equal(computers.headerInset, 20);
      assert.equal(computers.hoverInset, 8);
      assert.equal(computers.headerToHover, 8);
    }
    if (process.env.LOOM_PIXEL_AUDIT_EXPECT === "140") {
      assert.equal(channelsMetrics.rowGap, 2);
      assert.equal(channelsMetrics.rowHeight, 38);
      assert.equal(roles.rowHeight, 38);
      assert.equal(computers.rowHeight, 60);
      for (const [page, values] of Object.entries(spacing)) {
        assert.ok(values.headers.length, page + " has native group headers");
        assert.equal(
          values.headers[0].top,
          page === "chat" ? 54 : 0,
          page +
            " first group container offset (Role graph deliberately omitted)",
        );
        for (const header of values.headers)
          assert.equal(header.paddingTop, 16, page + " title inset");
        for (const gap of values.withinListGaps)
          assert.equal(gap, 2, page + " item spacing");
        for (const gap of values.titleToFirstRow)
          assert.equal(gap, 8, page + " title to first item");
        for (const gap of values.groupToFirstRow)
          assert.equal(gap, 8, page + " Computer group to first item");
        for (const gap of values.rowToFollowingHeader)
          assert.equal(gap, 24, page + " row to following group title");
      }
      assert.deepEqual(
        spacing.roles.betweenComputerGroups,
        [14],
        "multiple Computer groups keep native vertical rhythm",
      );
    }
    return result;
  } finally {
    await context.close();
  }
}
