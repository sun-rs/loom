import { scrollTaskWindow } from "./task-window-browser-scroll.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { classifyFoundationBrowserRequest } from "./foundation-browser-request-policy.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
const output = mkdtempSync(join(tmpdir(), "rah-task-virtual-")),
  options = { extraPaths: uiContractEvidenceInputPaths() };
const receipt = {
  output,
  inputs: snapshotUiEvidenceInputs(options),
  results: [],
};
const scenario = async (id, run) => run();
try {
  await scenario("task-virtual-window", async () => {
    for (const engine of process.env.RAH_UI_BROWSER
      ? [process.env.RAH_UI_BROWSER]
      : ["chrome", "firefox"]) {
      const fixture = await startShellFixture(),
        browser =
          engine === "chrome"
            ? await chromium.launch({
                headless: true,
                executablePath: await findChromeExecutable(),
              })
            : await firefox.launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(30000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      try {
        await page.addInitScript(() =>
          localStorage.setItem("rah:web-push-desired:v1", "disabled"),
        );
        await page.route("**/*", async (route) => {
          const request = route.request(),
            decision = classifyFoundationBrowserRequest({
              fixtureOrigin: fixture.origin,
              harnessOrigin: fixture.origin,
              method: request.method(),
              url: request.url(),
            });
          if (decision.decision === "reject") {
            errors.push("Unexpected request " + decision.identity);
            await route.abort();
          } else await route.continue();
        });
        const post = async (path, data) => {
          const r = await page.request.post(
            fixture.origin + "/v3/client/" + path,
            { data },
          );
          assert.equal(r.status(), 200, await r.text());
          return r.json();
        };
        const room = (await post("rooms/list", {})).rooms.find(
          (r) => r.name === "Task Matrix",
        );
        const seed = (
          await post("tasks/list", { roomId: room.roomId, limit: 200 })
        ).tasks[0];
        assert.ok(seed);
        const requests = [];
        let removeFirst = false;
        const task = (n) => ({
          ...seed,
          dependencyTaskIds: [],
          taskId: "virtual-task-" + n,
          taskNumber: n,
          sourceMessageId: "virtual-message-" + n,
          threadId: "virtual-thread-" + n,
          state: "todo",
          workflowStatus: "todo",
          title: "Virtual Task " + n,
        });
        await page.route("**/v3/client/tasks/list", async (route) => {
          const data = route.request().postDataJSON();
          if (data.roomId !== room.roomId || !data.states)
            return route.continue();
          requests.push(data.beforeTaskNumber ?? "base");
          await route.fulfill({
            status: 200,
            json: data.beforeTaskNumber
              ? { tasks: Array.from({ length: 500 }, (_, i) => task(500 - i)) }
              : {
                  tasks: Array.from({ length: 500 }, (_, i) =>
                    task(1000 - i),
                  ).filter((task) => !removeFirst || task.taskNumber !== 1000),
                  nextBeforeTaskNumber: 501,
                },
          });
        });
        await page.goto(
          fixture.origin + "/?room=" + room.roomId + "&roomTab=tasks",
          { waitUntil: "load" },
        );
        await page.locator('[data-task-id="virtual-task-1000"]').waitFor();
        assert.ok(
          (await page.locator("[data-task-id]").count()) <= 80,
          "Task DOM must stay bounded while 500 canonical Tasks are loaded",
        );
        await page
          .getByRole("button", { name: "载入更早任务", exact: true })
          .click();
        await page.waitForFunction(() =>
          [...document.querySelectorAll("[data-total-count]")].some(
            (e) => Number(e.getAttribute("data-total-count")) >= 1000,
          ),
        );
        for (const view of ["看板", "列表"]) {
          await page.getByRole("radio", { name: view, exact: true }).click();
          for (const width of [1440, 390]) {
            await page.setViewportSize({
              width,
              height: width === 390 ? 844 : 900,
            });
            const board = page.locator(".rah-global-kanban");
            await scrollTaskWindow(page, "end");
            await page.locator('[data-task-id="virtual-task-1"]').waitFor();
            assert.ok((await page.locator("[data-task-id]").count()) <= 80);
            await page.screenshot({
              path: join(
                output,
                engine + "-tasks-" + view + "-" + width + ".png",
              ),
            });
            await scrollTaskWindow(page, "start");
            await page.locator('[data-task-id="virtual-task-1000"]').waitFor();
          }
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByRole("radio", { name: "看板", exact: true }).click();
        const board = page.locator(".rah-global-kanban");
        await scrollTaskWindow(page, 25000);
        await page.waitForFunction(
          () => document.querySelector(".rah-global-kanban").scrollTop > 10000,
        );
        const countBeforeRemoval = Number(
          await page
            .locator('[data-task-group="todo"] [data-total-count]')
            .getAttribute("data-total-count"),
        );
        const anchor = await page.evaluate(() => {
          const scroll = document
            .querySelector(".rah-global-kanban")
            .getBoundingClientRect();
          const row = [
            ...document.querySelectorAll("[data-task-virtual-key]"),
          ].find(
            (row) =>
              row.getBoundingClientRect().top >= scroll.top &&
              row.getBoundingClientRect().bottom <= scroll.bottom,
          );
          return {
            key: row.dataset.taskVirtualKey,
            top: row.getBoundingClientRect().top,
          };
        });
        removeFirst = true;
        await page.waitForFunction(
          (count) =>
            Number(
              document
                .querySelector('[data-task-group="todo"] [data-total-count]')
                ?.getAttribute("data-total-count"),
            ) ===
            count - 1,
          countBeforeRemoval,
        );
        await page.waitForFunction((anchor) => {
          const row = document.querySelector(
            `[data-task-virtual-key="${anchor.key}"]`,
          );
          return (
            row && Math.abs(row.getBoundingClientRect().top - anchor.top) < 2
          );
        }, anchor);
        removeFirst = false;
        await page.waitForFunction(
          (count) =>
            Number(
              document
                .querySelector('[data-task-group="todo"] [data-total-count]')
                ?.getAttribute("data-total-count"),
            ) === count,
          countBeforeRemoval,
        );
        await scrollTaskWindow(page, 30000);
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const boundary = await page.evaluate(() => {
          const rows = [
              ...document.querySelectorAll(
                '[data-task-group="todo"] [data-task-virtual-row-index]',
              ),
            ],
            row = rows.at(-1);
          const buttons = [...row.querySelectorAll("button:not([disabled])")];
          buttons.at(-1).focus({ preventScroll: true });
          return Number(row.dataset.taskVirtualRowIndex) + 1;
        });
        receipt.keyboard = { boundary };
        await page.keyboard.press("Tab");
        await page.waitForFunction(
          (index) =>
            document.activeElement
              ?.closest("[data-task-virtual-row-index]")
              ?.getAttribute("data-task-virtual-row-index") === String(index),
          boundary,
        );
        const backwards = await page.evaluate(() => {
          const row = document.querySelector(
            '[data-task-group="todo"] [data-task-virtual-row-index]',
          );
          row
            .querySelector("button:not([disabled])")
            .focus({ preventScroll: true });
          return Number(row.dataset.taskVirtualRowIndex) - 1;
        });
        assert.ok(backwards >= 0);
        await page.keyboard.press("Shift+Tab");
        await page.waitForFunction(
          (index) =>
            document.activeElement
              ?.closest("[data-task-virtual-row-index]")
              ?.getAttribute("data-task-virtual-row-index") === String(index),
          backwards,
        );
        assert.deepEqual(errors, []);
        receipt.results.push({
          engine,
          status: "passed",
          maxMounted: 80,
          requests,
        });
      } catch (error) {
        receipt.failure = {
          engine,
          errors,
          dom: await page
            .evaluate(() => ({
              scroll: [...document.querySelectorAll(".rah-global-kanban")].map(
                (e) => ({
                  top: e.scrollTop,
                  height: e.scrollHeight,
                  client: e.clientHeight,
                }),
              ),
              rows: [
                ...document.querySelectorAll("[data-task-virtual-row-index]"),
              ].map((e) => e.dataset.taskVirtualRowIndex),
            }))
            .catch(() => null),
        };
        await page
          .screenshot({ path: join(output, engine + "-failure.png") })
          .catch(() => {});
        throw error;
      } finally {
        await browser.close();
        await fixture.close();
      }
    }
  });
  assertUiEvidenceInputSnapshot(receipt.inputs, options);
} catch (e) {
  receipt.error = e.stack;
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(
    JSON.stringify({ output, results: receipt.results, error: receipt.error }),
  );
}
