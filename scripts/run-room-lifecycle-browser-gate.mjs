import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { classifyFoundationBrowserRequest } from "./foundation-browser-request-policy.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
const output = mkdtempSync(join(tmpdir(), "rah-room-lifecycle-"));
const options = { extraPaths: uiContractEvidenceInputPaths() };
const receipt = {
  output,
  inputs: snapshotUiEvidenceInputs(options),
  results: [],
};
const scenario = async (id, run) => {
  await run();
};
try {
  await scenario("room-lifecycle-navigation", async () => {
    for (const engine of process.env.RAH_UI_BROWSER
      ? [process.env.RAH_UI_BROWSER]
      : ["chrome", "firefox"]) {
      const fixture = await startShellFixture({ humanMatrix: true });
      const browser =
        engine === "chrome"
          ? await chromium.launch({
              headless: true,
              executablePath: await findChromeExecutable(),
            })
          : await firefox.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 900 },
        });
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.addInitScript(() =>
          localStorage.setItem("rah:web-push-desired:v1", "disabled"),
        );
        const origin = fixture.origin;
        await page.route("**/*", async (route) => {
          const r = route.request(),
            d = classifyFoundationBrowserRequest({
              fixtureOrigin: origin,
              harnessOrigin: origin,
              method: r.method(),
              url: r.url(),
            });
          const lifecycle =
            r.method() === "POST" &&
            ["leave", "delete", "archive", "unarchive"].some(
              (a) => r.url() === `${origin}/v3/client/rooms/${a}`,
            );
          if (d.decision === "reject" && !lifecycle) {
            errors.push("Unexpected request " + d.identity);
            await route.abort();
          } else await route.continue();
        });
        const post = async (path, data, status = 200) => {
          const r = await page.request.post(origin + "/v3/client/" + path, {
            data,
          });
          assert.equal(r.status(), status, await r.text());
          return r.json();
        };
        const workspace = (await post("workspaces/list", {})).workspaces[0];
        const humans = (
          await post("workspaces/humans", {
            workspaceId: workspace.workspaceId,
          })
        ).humans;
        const coowner = humans.find(
          (x) => x.principal.handle === "fixture-coowner",
        ).principal.principalId;
        const sync = async (roomId) =>
          (
            await post("rooms/sync", {
              roomId,
              consumerId: "lifecycle-" + engine,
              limit: 500,
            })
          ).latestRoomSeq;
        for (const { operation, width, lost } of [1440, 390].flatMap((width) =>
          ["leave", "delete"].flatMap((operation) =>
            [false, true].map((lost) => ({ operation, width, lost })),
          ),
        )) {
          await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 900,
          });
          const name = `Lifecycle ${operation} ${engine} ${width} ${lost}`;
          const created = await post("rooms/create", {
            basedOnControlRoomSeq: await sync(workspace.controlRoomId),
            idempotencyKey: crypto.randomUUID(),
            kind: "channel",
            name,
            slug: `lifecycle-${operation}-${engine}-${width}-${lost}`,
            workspaceId: workspace.workspaceId,
          });
          const roomId = created.room.roomId;
          if (operation === "leave")
            await post("rooms/members/add", {
              roomId,
              principalId: coowner,
              role: "owner",
              basedOnRoomSeq: await sync(roomId),
              idempotencyKey: crypto.randomUUID(),
            });
          await page.goto(origin + "/?surface=search", { waitUntil: "load" });
          await page
            .getByRole("textbox", { name: "搜索频道、私信、消息" })
            .fill(name);
          await page
            .locator(".rah-search-destination")
            .filter({ hasText: name })
            .click();
          await page
            .locator('textarea[aria-label="消息输入框"]:not(:disabled)')
            .waitFor();
          assert.equal(new URL(page.url()).searchParams.get("room"), roomId);
          await page
            .getByRole("button", { name: "频道详情与设置", exact: true })
            .click();
          await page
            .getByRole("button", {
              name: operation === "leave" ? "退出频道" : "删除频道",
              exact: true,
            })
            .click();
          const dialog = page.getByRole("dialog", {
            name: operation === "leave" ? "退出频道" : "删除频道",
            exact: true,
          });
          const url = origin + "/v3/client/rooms/" + operation;
          const deny = (route) =>
            route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "fixture_unavailable",
                  message: "Temporary lifecycle failure",
                },
              }),
            });
          await page.route(url, deny);
          await dialog
            .getByRole("button", {
              name: operation === "leave" ? "离开" : "永久删除",
              exact: true,
            })
            .click();
          await dialog
            .getByRole("alert")
            .filter({ hasText: "Temporary lifecycle failure" })
            .waitFor();
          assert.equal(
            (await post("rooms/list", {})).rooms.some(
              (r) => r.roomId === roomId,
            ),
            true,
            "a failed request cannot remove membership",
          );
          await page.unroute(url, deny);
          let release, accepted;
          const held = new Promise((r) => {
            release = r;
          });
          const reached = new Promise((r) => {
            accepted = r;
          });
          const delayed = async (route) => {
            const response = await route.fetch();
            assert.equal(response.status(), 200);
            accepted();
            await held;
            await route.fulfill(
              lost
                ? {
                    status: 503,
                    contentType: "application/json",
                    body: JSON.stringify({
                      error: {
                        code: "fixture_lost_receipt",
                        message: "Old Room receipt lost",
                      },
                    }),
                  }
                : { response },
            );
          };
          await page.route(url, delayed);
          await dialog
            .getByRole("button", {
              name: operation === "leave" ? "离开" : "永久删除",
              exact: true,
            })
            .click();
          let timer;
          try {
            await Promise.race([
              reached,
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(Error("lifecycle acceptance timeout")),
                  15000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          await page.goBack();
          await page
            .getByRole("textbox", { name: "搜索频道、私信、消息" })
            .waitFor();
          const target = page.url();
          const returned = page.waitForResponse((r) => r.url() === url);
          release();
          await returned;
          await page.waitForTimeout(500);
          assert.equal(
            page.url(),
            target,
            "accepted old Room action must not steal newer browser navigation",
          );
          assert.equal(
            await page.locator(".rah-channel-settings-drawer").count(),
            0,
            "Back closes the old Room drawer",
          );
          assert.deepEqual(
            errors,
            [],
            "late failures must be handled in their original scope",
          );
          assert.equal(
            await page
              .getByRole("textbox", { name: "搜索频道、私信、消息" })
              .isVisible(),
            true,
          );
          const rooms = (await post("rooms/list", {})).rooms;
          assert.equal(
            rooms.some((r) => r.roomId === roomId),
            false,
            "canonical removal is real",
          );
          await page.screenshot({
            path: join(output, `${engine}-${operation}-${width}-${lost}.png`),
          });
          await page.unroute(url, delayed);
          await page.reload({ waitUntil: "load" });
          await page
            .getByRole("textbox", { name: "搜索频道、私信、消息" })
            .waitFor();
          assert.equal(
            new URL(page.url()).searchParams.get("surface"),
            "search",
          );
          receipt.results.push({
            engine,
            operation,
            width,
            lost,
            status: "passed",
          });
          console.log(`Passed ${engine} ${operation} ${width} lost=${lost}`);
        }
        assert.deepEqual(errors, []);
      } catch (e) {
        throw e;
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
