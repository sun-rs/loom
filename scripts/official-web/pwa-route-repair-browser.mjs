// Disposable Core + browser diagnostics, never native OS status-bar acceptance.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
export async function verifyPwaRoutes({
  browser,
  origin,
  client,
  workspace,
  role,
  head,
  channel,
}) {
  const result = { routes: [], requests: [], navigations: [], errors: [] };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
    colorScheme: "light",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, effectiveType: "4g" },
    });
    window.__pwaDocumentToken = Math.random();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) result.navigations.push({ url: f.url() });
  });
  page.on("request", (r) => {
    if (
      r.isNavigationRequest() ||
      ["script", "stylesheet"].includes(r.resourceType())
    )
      result.requests.push({ type: r.resourceType(), url: r.url() });
  });
  const snapshot = async (name) => {
    const value = await page.evaluate(() => {
      const color = (raw) => {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const ctx = c.getContext("2d");
        ctx.fillStyle = raw;
        ctx.fillRect(0, 0, 1, 1);
        return (
          "#" +
          [...ctx.getImageData(0, 0, 1, 1).data]
            .slice(0, 3)
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("")
        );
      };
      const root = document.documentElement,
        frame = getComputedStyle(root).getPropertyValue("--layer-frame").trim();
      const input = document.querySelector(
        '[data-testid="message-search-input"]',
      );
      const header = input?.closest(
        '[data-slot="panel-header"],[data-loom-root-header]',
      );
      const ancestry = [];
      for (let el = input; el && ancestry.length < 7; el = el.parentElement)
        ancestry.push({
          tag: el.tagName,
          slot: el.getAttribute("data-slot"),
          class: el.className,
          background: getComputedStyle(el).backgroundColor,
        });
      const shell = document.querySelector('[data-testid="loom-channel-app"]');
      const surface = document.querySelector(
        '[data-testid="pwa-status-bar-surface"]',
      );
      const surfaceStyle = getComputedStyle(surface);
      const surfaceRect = surface.getBoundingClientRect();
      const nav = [
        ...document.querySelectorAll(
          '[role="navigation"][aria-label="主导航"]',
        ),
      ].find((el) => el.getBoundingClientRect().height > 0);
      return {
        token: window.__pwaDocumentToken,
        meta: document.querySelector('meta[name="theme-color"]').content,
        frame,
        frameHex: color(frame),
        searchInputTop: input?.getBoundingClientRect().top,
        statusSurface: {
          same:
            !window.__pwaStatusSurface || window.__pwaStatusSurface === surface,
          height: surfaceRect.height,
          top: surfaceRect.top,
          position: surfaceStyle.position,
          background: color(surfaceStyle.backgroundColor),
          pointerEvents: surfaceStyle.pointerEvents,
        },
        headerColor: header
          ? color(getComputedStyle(header).backgroundColor)
          : null,
        headerAncestors: ancestry,
        shellSame: !window.__pwaShell || window.__pwaShell === shell,
        shellBox: shell
          ? {
              x: shell.getBoundingClientRect().x,
              y: shell.getBoundingClientRect().y,
              w: shell.getBoundingClientRect().width,
              h: shell.getBoundingClientRect().height,
            }
          : null,
        navBox: nav
          ? {
              y: nav.getBoundingClientRect().y,
              h: nav.getBoundingClientRect().height,
            }
          : null,
        bootstrap: !!document.querySelector(
          '[data-testid="loom-bootstrap-loading"]',
        ),
        bodyOverflow: getComputedStyle(document.body).overflow,
        standalone: matchMedia("(display-mode:standalone)").matches,
        visibleHeaders: [
          ...document.querySelectorAll(
            '[data-slot="panel-header"],[data-loom-root-header]',
          ),
        ]
          .filter((x) => x.getBoundingClientRect().width > 0)
          .map((x) => ({
            text: x.textContent,
            bg: getComputedStyle(x).backgroundColor,
            h: x.getBoundingClientRect().height,
          })),
      };
    });
    result.routes.push({ name, ...value });
    await page.screenshot({
      path: `/tmp/loom-pwa-${name}.png`,
      animations: "disabled",
    });
    return value;
  };
  try {
    await page.goto(origin + "/?chat=list");
    await page.getByTestId("public-server-channel-sidebar-root").waitFor();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="loom-bootstrap-loading"]'),
    );
    await page.evaluate(() => {
      window.__pwaShell = document.querySelector(
        '[data-testid="loom-channel-app"]',
      );
      window.__pwaStatusSurface = document.querySelector(
        '[data-testid="pwa-status-bar-surface"]',
      );
    });
    result.fullscreenMedia = await page.evaluate(async () => {
      try {
        await document.documentElement.requestFullscreen();
      } catch {}
      return matchMedia("(display-mode:fullscreen)").matches;
    });
    await snapshot("home");
    const nav = page.getByRole("navigation", { name: "主导航" });
    await nav.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByTestId("message-search-input").waitFor();
    await snapshot("search");
    await nav.getByRole("button", { name: "动态", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("view") === "activity");
    await page.getByTestId("message-search-input").waitFor({ state: "hidden" });
    await snapshot("activity");
    let imported, release;
    const requested = new Promise((r) => (imported = r)),
      gate = new Promise((r) => (release = r));
    await page.route(/\/assets\/TasksPage-[^/]+\.js/, async (route) => {
      imported();
      await gate;
      await route.continue();
    });
    let releaseData,
      releaseWarm,
      holdWarm = false;
    const dataGate = new Promise((r) => (releaseData = r)),
      warmGate = new Promise((r) => (releaseWarm = r));
    await page.route("**/v3/client/tasks/global", async (route) => {
      await dataGate;
      if (holdWarm) await warmGate;
      await route.continue();
    });
    await nav.getByRole("button", { name: "任务", exact: true }).click();
    await requested;
    await page.getByTestId("tasks-page-loading").waitFor();
    await snapshot("tasks-module-loading");
    release();
    await page.getByTestId("loom-tasks-page").waitFor();
    await snapshot("tasks-data-loading");
    releaseData();
    await page.getByTestId("tasks-empty").waitFor();
    await snapshot("tasks-ready");
    await page.evaluate(
      () =>
        (window.__pwaTasks = document.querySelector(
          '[data-testid="loom-tasks-page"]',
        )),
    );
    await nav.getByRole("button", { name: "首页", exact: true }).click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="tasks-route-slot"]');
      return el?.hidden && el.inert;
    });
    result.hiddenTasksInert = await page
      .getByTestId("tasks-route-slot")
      .evaluate((el) => el.hidden && el.inert);
    holdWarm = true;
    await nav.getByRole("button", { name: "任务", exact: true }).click();
    await page.getByTestId("loom-tasks-page").waitFor();
    result.retainedTasksOnReturn = await page
      .getByTestId("loom-tasks-page")
      .evaluate((el) => el === window.__pwaTasks);
    result.returnHasInitialLoader =
      (await page
        .getByRole("status", { name: "正在读取任务", exact: true })
        .count()) > 0;
    await snapshot("tasks-refresh-pending");
    releaseWarm();
    await page.getByTestId("tasks-empty").waitFor();
    await snapshot("tasks-warm");
    result.documentRequests = result.requests.filter(
      (r) => r.type === "document",
    ).length;
    result.sameDocumentAcrossRootSwitches = result.routes.every(
      (r) => r.token === result.routes[0].token,
    );
    result.sameShellAcrossRootSwitches = result.routes.every(
      (r) => r.shellSame,
    );
    if (process.env.LOOM_PWA_ASSERT === "1") {
      for (const r of result.routes) {
        assert.match(r.meta, /^#[a-f0-9]{6}$/i);
        assert.equal(r.meta.toLowerCase(), r.frameHex);
        assert.equal(r.bootstrap, false);
        assert.equal(r.statusSurface.same, true);
        if (result.fullscreenMedia) {
          assert.equal(r.statusSurface.top, 0);
          assert.ok(
            r.statusSurface.height >= 5,
            "WebKit samples four CSS pixels inside the viewport; zero-inset PWA needs a covering safe edge",
          );
          assert.equal(r.statusSurface.background, r.frameHex);
          assert.equal(r.statusSurface.position, "fixed");
          assert.equal(r.statusSurface.pointerEvents, "none");
        }
      }
      const s = result.routes.find((r) => r.name === "search");
      assert.equal(s.headerColor, s.frameHex);
      if (result.fullscreenMedia)
        assert.ok(
          s.searchInputTop >= s.statusSurface.height,
          "the status tint edge must not cover the search input",
        );
      assert.equal(result.sameDocumentAcrossRootSwitches, true);
      assert.equal(result.sameShellAcrossRootSwitches, true);
      assert.equal(result.documentRequests, 1);
      assert.equal(result.hiddenTasksInert, true);
      assert.equal(result.retainedTasksOnReturn, true);
      assert.equal(result.returnHasInitialLoader, false);
      assert.deepEqual(result.errors, []);
    }
    const roles = (
      await client.request("role.list", {
        controlRoomId: workspace.controlRoomId,
      })
    ).roles;
    const current = roles.find((r) => r.roleId === role.roleId);
    await client.request("role.revise", {
      roleId: role.roleId,
      expectedRoleRevisionId: current.roleRevisionId,
      basedOnRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "pwa-avatar-fixture",
      configuration: {
        ...current.configuration,
        avatarKey: "pixel:pokemon-025",
      },
    });
    result.candidateAvatars = [];
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
        isMobile: width === 390,
        hasTouch: width === 390,
      });
      const p = await ctx.newPage();
      try {
        await p.goto(origin + "/?room=" + channel.roomId);
        const trigger = p.getByTestId("loom-channel-control-trigger");
        await trigger.waitFor();
        let controlHit;
        if (width === 390) {
          controlHit = await trigger.evaluate((el) => {
            const r = el.getBoundingClientRect(),
              s = getComputedStyle(el),
              a = getComputedStyle(el, "::after");
            return {
              boxHeight: r.height,
              hitHeight: parseFloat(a.height),
              hitWidth: parseFloat(a.width),
              x: r.left + r.width / 2,
              y:
                r.top +
                parseFloat(s.borderTopWidth) +
                parseFloat(a.top) +
                parseFloat(a.height) -
                0.5,
            };
          });
          assert.ok(controlHit.hitHeight >= 44);
          assert.ok(controlHit.hitWidth >= 44);
          await p.mouse.click(controlHit.x, controlHit.y);
        } else await trigger.click();
        const sheet = p.getByTestId("loom-channel-control-sheet");
        await sheet.getByTestId("channel-overflow-members-entry").click();
        await sheet.getByTestId("member-page-add").click();
        const candidate = sheet.getByTestId(
            "add-candidate-agent-" + role.roleId,
          ),
          img = candidate.locator("img");
        await img.waitFor();
        await img.scrollIntoViewIfNeeded();
        await p.waitForFunction(
          (src) =>
            [...document.images].some(
              (i) =>
                i.getAttribute("src") === src &&
                i.complete &&
                i.naturalWidth === 512,
            ),
          await img.getAttribute("src"),
        );
        assert.match(
          await img.getAttribute("src"),
          /\/avatars\/pokemon\/pokemon-025-/,
        );
        await p.screenshot({
          path: `/tmp/loom-member-avatar-${width}.png`,
          animations: "disabled",
        });
        result.candidateAvatars.push({
          width,
          src: await img.getAttribute("src"),
          naturalWidth: await img.evaluate((i) => i.naturalWidth),
          controlHit,
        });
      } finally {
        await ctx.close();
      }
    }
    return result;
  } finally {
    writeFileSync(
      process.env.LOOM_PWA_REPORT ?? "/tmp/loom-pwa-routes.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    await context.close();
  }
}
