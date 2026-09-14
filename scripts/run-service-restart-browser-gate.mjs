import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium, firefox } from "playwright";
import { startRestartableLocalCoreWorkbench } from "@rah-os/daemon/local-workbench";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const output = mkdtempSync(join(tmpdir(), "rah-service-restart-fixture-"));
const bin = join(output, "bin");
mkdirSync(bin);
mkdirSync(join(output, "workspace"));
writeFileSync(
  join(bin, "codex"),
  `#!${process.execPath}
const args = process.argv.slice(2).join(" ");
if (args === "--version") process.stdout.write("FIXTURE codex restart acceptance\\n");
else if (args === "debug models --bundled") process.stdout.write(JSON.stringify({models:[{slug:"fixture-model",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"}],service_tiers:[]}]}));
else process.exitCode = 2;
`,
  { mode: 0o700 },
);
const running = await startRestartableLocalCoreWorkbench({
  environment: { ...process.env, PATH: bin },
  mode: { kind: "loopback", port: 0 },
  staticDirectory: resolve("apps/web/dist-workbench"),
  workbenchHome: join(output, "home"),
  workspaceCwd: join(output, "workspace"),
});
const results = [];
function durableSnapshot() {
  const db = new DatabaseSync(
    join(running.descriptor.stateDirectory, "room.db"),
    { readOnly: true },
  );
  try {
    return Object.fromEntries(
      ["rooms", "messages", "tasks", "room_events", "principals"].map(
        (table) => [
          table,
          db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ],
      ),
    );
  } finally {
    db.close();
  }
}
try {
  const baseline = durableSnapshot();
  for (const engine of ["chrome", "firefox"]) {
    const browser = await (engine === "chrome" ? chromium : firefox).launch({
      headless: true,
      ...(engine === "chrome"
        ? { executablePath: await findChromeExecutable() }
        : {}),
    });
    try {
      const page = await browser.newPage({ serviceWorkers: "block" });
      await page.addInitScript(() =>
        localStorage.setItem("rah:web-push-desired:v1", "disabled"),
      );
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        let unavailable = true;
        await page.route("**/_rah/service", async (route) =>
          unavailable
            ? route.fulfill({
                status: 503,
                contentType: "application/json",
                body: '{"error":"temporary"}',
              })
            : route.continue(),
        );
        await page.goto(running.descriptor.webOrigin + "/?surface=computers");
        const button = page.getByRole("button", {
          name: "重启服务",
          exact: true,
        });
        await button.waitFor();
        await page
          .getByText("暂时无法读取服务状态，请重试。", { exact: true })
          .waitFor({ timeout: 10_000 })
          .catch(async (error) => {
            await page.screenshot({
              path: join(output, `${engine}-${width}-status-failure.png`),
            });
            console.log(
              JSON.stringify({
                output,
                body: await page.locator("body").innerText(),
              }),
            );
            throw error;
          });
        assert.equal(await button.isDisabled(), true);
        assert.equal(
          await page
            .getByText("当前连接未提供服务重启能力。", { exact: true })
            .count(),
          0,
        );
        unavailable = false;
        await page
          .getByRole("button", { name: "重试连接", exact: true })
          .click();
        await page.waitForFunction(() =>
          [...document.querySelectorAll("button")].some(
            (button) =>
              button.textContent.includes("重启服务") && !button.disabled,
          ),
        );
        if (engine === "chrome" && width === 1440) {
          await page.route(
            "**/_rah/service/restart",
            async (route) => {
              await route.fetch().catch(() => undefined);
              await route.abort();
            },
            { times: 1 },
          );
        }
        const before = await page.evaluate(async () =>
          (await fetch("/_rah/service")).json(),
        );
        const stalePage = await browser.newPage({
          serviceWorkers: "block",
          viewport: { width, height: width === 390 ? 844 : 900 },
        });
        await stalePage.goto(
          running.descriptor.webOrigin + "/?surface=computers",
        );
        const staleButton = stalePage.getByRole("button", {
          name: "重启服务",
          exact: true,
        });
        await stalePage.waitForFunction(() =>
          [...document.querySelectorAll("button")].some(
            (button) =>
              button.textContent.includes("重启服务") && !button.disabled,
          ),
        );
        if (width === 390) {
          await button.focus();
          await page.keyboard.press("Enter");
        } else await button.click();
        const confirmation = page.getByRole("dialog", {
          name: "重启服务",
          exact: true,
        });
        await confirmation.waitFor();
        const beforeConfirm = await page.evaluate(async () =>
          (await fetch("/_rah/service")).json(),
        );
        assert.equal(
          beforeConfirm.generation,
          before.generation,
          "opening confirmation must not restart",
        );
        await confirmation
          .getByRole("button", { name: "重启服务", exact: true })
          .click();
        await page
          .getByText("服务已重启，连接已恢复", { exact: true })
          .waitFor({ timeout: 90_000 });
        const after = await page.evaluate(async () =>
          (await fetch("/_rah/service")).json(),
        );
        assert.notEqual(before.generation, after.generation);
        await staleButton.click();
        await stalePage
          .getByRole("dialog", { name: "重启服务", exact: true })
          .getByRole("button", { name: "重启服务", exact: true })
          .click();
        await stalePage
          .getByText("服务已由其他请求重启，已刷新连接状态。", { exact: true })
          .waitFor();
        assert.equal(
          await stalePage
            .getByText("服务已重启，连接已恢复", { exact: true })
            .count(),
          0,
        );
        const afterStale = await stalePage.evaluate(async () =>
          (await fetch("/_rah/service")).json(),
        );
        assert.equal(
          afterStale.generation,
          after.generation,
          "a stale page must not trigger another restart",
        );
        await stalePage.close();
        assert.equal(new URL(page.url()).search, "?surface=computers");
        assert.deepEqual(durableSnapshot(), baseline);
        await page.screenshot({
          path: join(output, `${engine}-${width}-restarted.png`),
        });
        await page.reload();
        await button.waitFor();
        assert.equal(
          await page
            .getByText("服务已重启，连接已恢复", { exact: true })
            .count(),
          0,
        );
        results.push({
          engine,
          width,
          before,
          after,
          durableStatePreserved: true,
          transientStatusRecovered: true,
          stalePageReconciledWithoutRestart: true,
        });
        await page.unroute("**/_rah/service");
      }
    } finally {
      await browser.close();
    }
  }
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, results }));
} finally {
  await running.stop();
}
