import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_WORKSPACE_FILES = "1";
const f = await startShellFixture(),
  b = await chromium.launch();
const results = [];
try {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const markers = [
    [
      "components/settings-surface.tsx",
      "const [mobileIndex, setMobileIndex] = useState(",
      "settings",
    ],
    [
      "components/agent-workspace-browser.tsx",
      'const rootId = "agent-workspace";',
      "files",
    ],
    ["App.tsx", "useDefaultWebPush(client);", "workspace"],
    [
      "components/global-discovery.tsx",
      'const filters = useFilters("tasks", taskFilterMemory, workspaceId);',
      "tasks",
    ],
    [
      "components/agent-directory-pane.tsx",
      "const mobile = useMobileLayout();",
      "agents",
    ],
    [
      "components/workspace-catalog-panes.tsx",
      "const mobile = useMobileLayout();",
      "computers",
    ],
  ];
  for (const [file, marker, key] of markers)
    await p.route("**/src/" + file, async (route) => {
      const response = await route.fetch(),
        body = await response.text();
      assert.ok(body.includes(marker), file);
      await route.fulfill({
        response,
        body: body.replace(
          marker,
          `window.__renders ??= {}; window.__renders.${key} = (window.__renders.${key} || 0) + 1; ${marker}`,
        ),
      });
    });
  const c = await p.context().newCDPSession(p);
  await c.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await c.send("Performance.getMetrics")).metrics.map((x) => [
        x.name,
        x.value,
      ]),
    );
  for (const surface of ["tasks", "agents", "computers", "files", "settings"]) {
    await p.setViewportSize({ width: 1600, height: 900 });
    let url = f.origin + "/?surface=" + surface;
    if (surface === "files") {
      const w = await (
        await p.request.post(f.origin + "/v3/client/workspaces/list", {
          data: {},
        })
      ).json();
      const a = await (
        await p.request.post(f.origin + "/v3/client/agents/list", {
          data: { controlRoomId: w.workspaces[0].controlRoomId },
        })
      ).json();
      url =
        f.origin +
        "/?surface=agents&agent=" +
        a.agents[0].definition.agentId +
        "&agentTab=workspace";
    }
    await p.goto(url);
    if (surface === "tasks")
      await expect(p.locator(".rah-global-task-card").first()).toBeVisible();
    if (surface === "files") {
      const file = p.getByRole("treeitem", { name: "MEMORY.md", exact: true });
      await expect(file).toBeVisible();
      await file.click();
    }
    await expect
      .poll(() => p.evaluate((key) => window.__renders?.[key] ?? 0, surface))
      .toBeGreaterThan(0);
    await p.waitForTimeout(1000);
    const snapshot = () => p.evaluate(() => window.__renders);
    const before = await snapshot(),
      start = await metrics();
    for (let i = 0; i < 40; i++)
      await p.setViewportSize({ width: 1600 - i * 4, height: 900 });
    const end = await metrics(),
      after = await snapshot();
    const row = {
      surface,
      resizeRenders: after[surface] - before[surface],
      resizeScriptMs: (end.ScriptDuration - start.ScriptDuration) * 1000,
    };
    if (surface !== "tasks" && surface !== "settings") {
      const r = p.getByRole("separator", {
        name:
          surface === "agents"
            ? "调整成员边栏宽度"
            : surface === "files"
              ? "调整文件树宽度"
              : "调整计算机边栏宽度",
      });
      await expect(r).toBeVisible();
      const rect = await r.boundingBox(),
        start = await snapshot(),
        metricsBefore = await metrics();
      await p.mouse.move(rect.x + rect.width / 2, rect.y + 140);
      await p.mouse.down();
      await p.mouse.move(rect.x + 65, rect.y + 140, { steps: 40 });
      await p.mouse.up();
      row.dragRenders = (await snapshot())[surface] - start[surface];
      row.dragScriptMs =
        ((await metrics()).ScriptDuration - metricsBefore.ScriptDuration) *
        1000;
      await expect
        .poll(async () => Number(await r.getAttribute("aria-valuenow")))
        .toBeGreaterThan(290);
    }
    if (surface !== "tasks" && surface !== "settings") {
      const r = p.getByRole("separator", {
        name:
          surface === "agents"
            ? "调整成员边栏宽度"
            : surface === "files"
              ? "调整文件树宽度"
              : "调整计算机边栏宽度",
      });
      await r.press("Home");
      await expect(r).toHaveAttribute(
        "aria-valuenow",
        surface === "files" ? "160" : "180",
      );
      await r.press("Shift+ArrowRight");
      await expect(r).toHaveAttribute(
        "aria-valuenow",
        surface === "agents" ? "212" : surface === "files" ? "176" : "188",
      );
      await r.press("End");
      await expect(r).toHaveAttribute(
        "aria-valuenow",
        surface === "files" ? "600" : "320",
      );
      if (surface === "computers") {
        await p.reload();
        await expect(r).toHaveAttribute("aria-valuenow", "320");
      }
      // Captured drag cancellation must stop later pointer movement.
      await r.press("Home");
      const box = await r.boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + 120);
      await p.mouse.down();
      await p.mouse.move(box.x + 35, box.y + 120, { steps: 4 });
      await r.evaluate((el) => {
        const id = 1;
        el.dispatchEvent(
          new PointerEvent("pointercancel", { bubbles: true, pointerId: id }),
        );
      });
      const cancelled = await r.getAttribute("aria-valuenow");
      await p.mouse.move(box.x + 100, box.y + 120, { steps: 4 });
      await p.mouse.up();
      await expect(r).toHaveAttribute("aria-valuenow", cancelled);
    }
    await p.setViewportSize({ width: 390, height: 844 });
    await p.setViewportSize({ width: 1600, height: 900 });
    if (surface === "tasks")
      await expect(p.locator(".rah-global-task-card").first()).toBeVisible();
    if (surface === "files")
      await expect(
        p.getByRole("treeitem", { name: "MEMORY.md", exact: true }),
      ).toBeVisible();
    results.push(row);
    console.log(JSON.stringify(row));
  }
  if (!process.env.RAH_MEASURE_ONLY)
    for (const row of results) {
      assert.ok(row.resizeRenders <= 8, JSON.stringify(row));
      if (row.dragRenders !== undefined)
        assert.ok(row.dragRenders <= 8, JSON.stringify(row));
    }
} finally {
  await b.close();
  await f.close();
}
