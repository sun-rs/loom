// Read-only UI measurement on a disposable Core; reports differences, never certifies parity.
import { writeFile } from "node:fs/promises";
export async function auditSidebarPixels({
  browser,
  origin,
  client,
  workspace,
  channels,
  role,
  head,
}) {
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
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "zh-CN",
    }),
    page = await context.newPage();
  try {
    await page.goto(origin + "/?view=agents");
    await page.locator(`[data-role-id="${role.roleId}"]`).waitFor();
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
    await page.screenshot({ path: "/tmp/loom-pixel-audit-roles.png" });
    await page.goto(origin + "/?view=channels");
    await page
      .locator(`[data-public-channel-id="${channels[0].roomId}"]`)
      .waitFor();
    const channelsMetrics = await page
      .getByTestId("public-server-channel-sidebar-root")
      .evaluate((root) => {
        const base = root.getBoundingClientRect(),
          pin = root.querySelector('[data-sidebar-section="pinned"]'),
          section = root.querySelector('[data-sidebar-section="channels"]'),
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
    await page.screenshot({ path: "/tmp/loom-pixel-audit-channels.png" });
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
    await page.screenshot({ path: "/tmp/loom-pixel-audit-computers.png" });
    const result = {
      fixtureOnly: true,
      paidProviders: false,
      viewport: { width: 1440, height: 1000, dpr: 1, zoom: 1 },
      roles,
      channels: channelsMetrics,
      computers,
    };
    if (process.env.LOOM_PIXEL_AUDIT_OUTPUT)
      await writeFile(
        process.env.LOOM_PIXEL_AUDIT_OUTPUT,
        JSON.stringify(result, null, 2) + "\n",
      );
    return result;
  } finally {
    await context.close();
  }
}
