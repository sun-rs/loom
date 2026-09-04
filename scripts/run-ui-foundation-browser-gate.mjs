import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import {
  checkLibrary,
  libraryInputs,
  libraryPath,
} from "./ui-library-contract.mjs";
import {
  startShellFixture,
  verifyIntegratedShell,
} from "./ui-shell-browser-scenarios.mjs";
import {
  digest,
  registryPath,
  validateRegistry,
} from "./ui-behavior-registry.mjs";

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
checkLibrary();
assert.deepEqual(
  validateRegistry(registry, (path) => readFileSync(path)),
  [],
);

const output = mkdtempSync(join(tmpdir(), "rah-ui-foundations-"));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: new URL("../apps/web", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (data) => (logs += data));
server.stderr.on("data", (data) => (logs += data));
const receipt = {
  librarySha256: digest(readFileSync(libraryPath)),
  registrySha256: digest(readFileSync(registryPath)),
  startedAt: new Date().toISOString(),
  // Record exact production/test inputs so an unchanged registry cannot make
  // an old successful receipt look current after implementation changes.
  inputs: Object.fromEntries(
    [
      ...libraryInputs(),
      ...readdirSync("apps/web/src", { recursive: true })
        .map(String)
        .filter((p) => /\.(?:css|ts|tsx)$/.test(p))
        .map((p) => `apps/web/src/${p}`),
      "apps/web/test/ui-foundations.tsx",
      "apps/web/test/ui-foundations.html",
      "scripts/run-ui-foundation-browser-gate.mjs",
      "scripts/ui-shell-browser-scenarios.mjs",
      "package-lock.json",
    ]
      .sort()
      .map((path) => [path, digest(readFileSync(path))]),
  ),
  results: [],
  output,
};
let browser;
let shellFixture;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      if ((await fetch(`${origin}/test/ui-foundations.html`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  for (const engine of process.env.RAH_UI_BROWSER === "chrome"
    ? ["chrome"]
    : ["chrome", "firefox"]) {
    browser =
      engine === "chrome"
        ? await chromium.launch({
            executablePath: await findChromeExecutable(),
            headless: true,
          })
        : await firefox.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
    // Fixture may load modules/assets only; accidental production requests fail.
    await page.route(/\/v[13]\//, (route) => {
      errors.push(`unexpected API ${route.request().url()}`);
      return route.abort();
    });
    const scenario = async (id, run) => {
      await page.goto(`${origin}/test/ui-foundations.html`, {
        waitUntil: "networkidle",
      });
      await run();
      assert.deepEqual(errors, []);
      receipt.results.push({
        engine,
        version: browser.version(),
        id,
        status: "passed",
      });
    };
    await scenario("panel-header-geometry", async () => {
      await page.setViewportSize({ width: 1440, height: 598 });
      const room = await page.locator(".rah-conversation-head").boundingBox();
      const agent = await page.locator(".rah-agent-detail-head").boundingBox();
      assert.equal(
        room.height,
        48,
        "Room header must preserve the compact shell track",
      );
      assert.equal(
        agent.height,
        48,
        "Agent inspector must use the same compact header track",
      );
      assert.equal(
        room.y + room.height,
        agent.y + agent.height,
        "adjacent header dividers must align",
      );
    });
    await scenario("panel-tabs-keyboard", async () => {
      const list = page.getByRole("tablist", { name: "对话内容", exact: true });
      const chat = list.getByRole("tab", { name: "聊天", exact: true });
      await chat.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await list
          .getByRole("tab", { name: "文件", exact: true })
          .getAttribute("aria-selected"),
        "true",
        "Room Tabs must skip unavailable Tasks and select Files",
      );
      assert.equal(
        await list.locator('[role="tab"][tabindex="0"]').count(),
        1,
        "one tab stop per group",
      );
      await page.keyboard.press("Home");
      assert.equal(await chat.getAttribute("aria-selected"), "true");
      await page.keyboard.press("ArrowLeft");
      assert.equal(
        await list
          .getByRole("tab", { name: "文件", exact: true })
          .getAttribute("aria-selected"),
        "true",
        "wrap to last enabled item",
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(await chat.getAttribute("aria-selected"), "true");
      const agent = page.getByRole("tablist", { name: "Agent 详情" });
      assert.equal(
        await agent
          .getByRole("tab", { name: "动态", exact: true })
          .getAttribute("aria-selected"),
        "true",
        "selection is isolated per group",
      );
      const activity = agent.getByRole("tab", { name: "动态", exact: true });
      await activity.focus();
      await page.keyboard.press("End");
      const mcp = agent.getByRole("tab", { name: "MCP", exact: true });
      assert.equal(await mcp.getAttribute("aria-selected"), "true");
      assert.equal(
        await mcp.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const p = e.closest(".rah-panel-tabs").getBoundingClientRect();
          return (
            r.left >= p.left - 1 &&
            r.right <= p.right + 1 &&
            e.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            )
          );
        }),
        true,
        "MCP must become visible and clickable in a narrow inspector",
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(await activity.getAttribute("aria-selected"), "true");
      for (const label of ["全部禁用", "空数据"])
        assert.equal(
          await page
            .getByRole("tablist", { name: label, exact: true })
            .locator('[tabindex="0"]')
            .count(),
          0,
        );
      assert.equal(
        await page.locator("[data-clicks]").textContent(),
        "0",
        "disabled and empty groups do not issue callbacks",
      );
      assert.equal((await list.boundingBox()).height, 28);
      assert.equal(
        await list.evaluate(
          (e) => e.parentElement.getBoundingClientRect().height,
        ),
        30,
        "one 2px bottom divider below 28px tab track",
      );
    });
    await scenario("splitter-contract", async () => {
      await page.getByRole("separator").evaluateAll((elements) =>
        elements.forEach((element) =>
          element.addEventListener("pointerdown", (event) => {
            element.dataset.fixturePointer = String(event.pointerId);
          }),
        ),
      );
      const separator = page.getByRole("separator", {
        name: "调整聊天边栏宽度",
      });
      await separator.focus();
      await page.keyboard.press("End");
      assert.equal(await separator.getAttribute("aria-valuenow"), "320");
      await page.keyboard.press("Home");
      assert.equal(await separator.getAttribute("aria-valuenow"), "180");
      const before = JSON.parse(
        await page.locator('[data-fixture="0"] output').textContent(),
      ).commits.length;
      const box = await separator.boundingBox();
      await page.mouse.move(box.x + 4, box.y + 30);
      await page.mouse.down();
      await page.mouse.move(box.x + 44, box.y + 30);
      assert.equal(
        await separator.getAttribute("aria-valuenow"),
        "220",
        "pointer movement delivered to real handle",
      );
      // Native capture loss, not a simulated lostpointercapture callback.
      await separator.evaluate((element) => {
        const id = Number(element.dataset.fixturePointer);
        if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      });
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[aria-label="调整聊天边栏宽度"]')
            ?.classList.contains("is-dragging"),
      );
      const result = JSON.parse(
        await page.locator('[data-fixture="0"] output').textContent(),
      );
      assert.equal(
        result.commits.length,
        before + 1,
        "capture loss must commit once",
      );
      assert.equal(result.commits.at(-1), 220, "commit latest pointer width");
      for (const [index, label, initial, min, max] of [
        [1, "调整 Agent 资料面板宽度", 380, 300, 600],
        [2, "调整消息列宽度", 400, 360, 864],
      ]) {
        const handle = page.getByRole("separator", { name: label });
        await handle.focus();
        await page.keyboard.press("ArrowLeft");
        assert.equal(
          await handle.getAttribute("aria-valuenow"),
          String(initial + 8),
        );
        await page.keyboard.press("Home");
        assert.equal(await handle.getAttribute("aria-valuenow"), String(min));
        await page.keyboard.press("End");
        assert.equal(await handle.getAttribute("aria-valuenow"), String(max));
        const at = await handle.boundingBox();
        await page.mouse.move(at.x + 4, at.y + 20);
        if (index === 2)
          assert.equal(
            await handle.evaluate(
              (e) => getComputedStyle(e, "::after").backgroundColor,
            ),
            "rgba(0, 0, 0, 0)",
            "Thread already owns its divider; shared handle must not add a hover line",
          );
        await page.mouse.down();
        await page.mouse.move(at.x + 44, at.y + 20);
        assert.equal(
          await handle.getAttribute("aria-valuenow"),
          String(max - 40),
        );
        await page.mouse.up();
        await page.waitForFunction(
          (i) =>
            JSON.parse(
              document.querySelector(`[data-fixture="${i}"] output`)
                .textContent,
            ).commits.length === 4,
          index,
        );
        const row = JSON.parse(
          await page.locator(`[data-fixture="${index}"] output`).textContent(),
        );
        assert.equal(row.commits.at(-1), max - 40);
        await handle.press("Enter");
        assert.equal(
          JSON.parse(
            await page
              .locator(`[data-fixture="${index}"] output`)
              .textContent(),
          ).commits.length,
          4,
        );
        // Secondary button cannot start a drag.
        const bounds = await handle.boundingBox();
        await page.mouse.move(bounds.x + 4, bounds.y + 20);
        await page.mouse.down({ button: "right" });
        await page.mouse.up({ button: "right" });
        assert.equal(
          await handle.evaluate((e) => e.classList.contains("is-dragging")),
          false,
        );
        await page.mouse.down();
        await handle.dispatchEvent("pointercancel", {
          pointerId: Number(await handle.getAttribute("data-fixture-pointer")),
        });
        await page.mouse.up();
        await page.waitForFunction(
          (i) =>
            JSON.parse(
              document.querySelector(`[data-fixture="${i}"] output`)
                .textContent,
            ).commits.length === 5,
          index,
        );
        assert.equal(
          await handle.evaluate((e) => e.classList.contains("is-dragging")),
          false,
        );
      }
      await page.screenshot({ path: join(output, `${engine}-splitters.png`) });
    });
    await scenario("header-action-states", async () => {
      const action = page.getByRole("button", {
        name: "可用操作",
        exact: true,
      });
      const state = () =>
        action.evaluate((e) => {
          const s = getComputedStyle(e),
            icon = e.querySelector("svg").getBoundingClientRect();
          return {
            width: e.offsetWidth,
            height: e.offsetHeight,
            iconWidth: icon.width,
            iconHeight: icon.height,
            transform: s.transform,
            shadow: s.boxShadow,
            focus: e.matches(":focus-visible"),
          };
        });
      const rest = await state();
      assert.equal(rest.width, 28);
      assert.equal(rest.height, 28);
      assert.equal(rest.iconWidth, 14);
      assert.equal(rest.iconHeight, 14);
      await action.hover();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('[aria-label="可用操作"]'))
            .transform === "matrix(1, 0, 0, 1, 0, -1)",
      );
      assert.notEqual((await state()).shadow, rest.shadow);
      await page.mouse.down();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('[aria-label="可用操作"]'))
            .transform === "matrix(1, 0, 0, 1, 1, 1)",
      );
      await page.mouse.up();
      await page.waitForFunction(
        () => document.querySelector("[data-clicks]").textContent === "1",
      );
      await page.mouse.move(0, 0);
      // Actual keyboard navigation, not JS focus inheriting mouse modality
      // (Firefox intentionally does not show focus-visible for the latter).
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await action.evaluate((e) => document.activeElement === e),
        true,
      );
      await page.keyboard.press("Space");
      await page.waitForFunction(
        () => document.querySelector("[data-clicks]").textContent === "2",
      );
      assert.equal((await state()).focus, true);
      for (const name of ["权限不足", "正在加载"]) {
        const disabled = page.getByRole("button", { name, exact: true });
        assert.equal(await disabled.isDisabled(), true);
        await disabled.hover();
        await page.waitForFunction(
          (n) =>
            ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(
              getComputedStyle(document.querySelector(`[aria-label="${n}"]`))
                .transform,
            ),
          name,
        );
        const box = await disabled.boundingBox();
        await page.mouse.click(box.x + 14, box.y + 14);
        assert.equal(await page.locator("[data-clicks]").textContent(), "2");
      }
      assert.equal(
        await page
          .getByRole("button", { name: "正在加载", exact: true })
          .getAttribute("aria-busy"),
        "true",
      );
      await page.screenshot({
        path: join(output, `${engine}-action-states.png`),
      });
    });
    await scenario("foundation-combinations", async () => {
      for (const width of [
        390, 700, 701, 767, 768, 1023, 1024, 1279, 1280, 1440,
      ]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 598,
        });
        const close = page.getByRole("button", {
          name: "关闭 Agent 侧栏",
          exact: true,
        });
        const geometry = await close.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            x: r.x,
            right: r.right,
            hit: e.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            ),
          };
        });
        assert.equal(geometry.width, 28, `close width at ${width}`);
        assert.equal(geometry.height, 28);
        assert.ok(
          geometry.x >= 0 && geometry.right <= width && geometry.hit,
          `close hit target at ${width}: ${JSON.stringify(geometry)}`,
        );
        const title = page.locator(".rah-agent-detail-identity h2");
        assert.equal(
          await title.evaluate((e) => getComputedStyle(e).textOverflow),
          "ellipsis",
        );
        assert.ok(
          await page.getByText("选择一个 Room", { exact: true }).count(),
          "empty header retained",
        );
        if ([390, 767, 768, 1024, 1440].includes(width))
          await page.screenshot({
            path: join(output, `${engine}-combination-${width}.png`),
          });
      }
      await page
        .getByRole("button", { name: "关闭 Agent 侧栏", exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector("[data-inspector]"),
      );
      assert.equal(
        await page
          .getByRole("button", { name: "频道详情与设置", exact: true })
          .isVisible(),
        true,
      );
      await page
        .getByRole("button", { name: "频道详情与设置", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("[data-clicks]").textContent === "1",
      );
    });
    await scenario("integrated-shell-layout", async () => {
      shellFixture ??= await startShellFixture();
      await page.unroute(/\/v[13]\//);
      await verifyIntegratedShell(page, shellFixture.origin, output, engine);
    });
    await browser.close();
    browser = undefined;
  }
  for (const engine of new Set(receipt.results.map((row) => row.engine))) {
    assert.deepEqual(
      receipt.results
        .filter((row) => row.engine === engine)
        .map((row) => row.id)
        .sort(),
      registry.scenarios.map((row) => row.id).sort(),
      "every registered scenario must actually execute",
    );
  }
  for (const [path, hash] of Object.entries(receipt.inputs))
    assert.equal(
      digest(readFileSync(path)),
      hash,
      `source changed during test: ${path}`,
    );
  assert.equal(
    digest(readFileSync(registryPath)),
    receipt.registrySha256,
    "registry changed during test",
  );
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  await browser?.close();
  await shellFixture?.close();
  server.kill("SIGTERM");
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(`UI foundation receipt: ${output}`);
}
