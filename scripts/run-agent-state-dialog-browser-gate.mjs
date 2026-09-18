import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

// Local regression: an accepted mutation survives navigation, but its obsolete
// dialog callback must not close or change a later dialog. No official parity claim.
const output =
  process.env.RAH_AGENT_DIALOG_OUTPUT ??
  mkdtempSync(join(tmpdir(), "rah-agent-dialog-"));
mkdirSync(output, { recursive: true });
const engines = (
  process.env.RAH_AGENT_DIALOG_ENGINES ?? "chrome,firefox"
).split(",");
const outcomes = (
  process.env.RAH_AGENT_DIALOG_OUTCOMES ?? "success,error"
).split(",");
const widths = (process.env.RAH_AGENT_DIALOG_WIDTHS ?? "1440,390")
  .split(",")
  .map(Number);
const results = [];
for (const engine of engines)
  for (const outcome of outcomes)
    for (const width of widths) {
      assert.ok(["chrome", "firefox"].includes(engine));
      assert.ok(["success", "error"].includes(outcome));
      assert.ok([1440, 390].includes(width));
      const label = `${engine}-${outcome}-${width}`;
      const fixture = await startShellFixture();
      let browser;
      let release = () => {};
      try {
        browser = await (engine === "chrome" ? chromium : firefox).launch({
          headless: true,
          ...(engine === "chrome"
            ? { executablePath: await findChromeExecutable() }
            : {}),
        });
        const page = await browser.newPage({
          viewport: { width: 1440, height: 900 },
          serviceWorkers: "block",
        });
        page.setDefaultTimeout(12000);
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.addInitScript(() =>
          localStorage.setItem("rah:web-push-desired:v1", "disabled"),
        );
        const post = async (path, data) => {
          const response = await page.request.post(
            `${fixture.origin}/v3/client/${path}`,
            { data },
          );
          assert.equal(response.status(), 200, await response.text());
          return response.json();
        };
        const workspace = (await post("workspaces/list", {})).workspaces[0];
        const agents = (
          await post("agents/list", { controlRoomId: workspace.controlRoomId })
        ).agents;
        assert.ok(agents.length >= 2);
        const [a, b] = agents;
        const aId = a.definition.agentDefinitionId,
          bId = b.definition.agentDefinitionId;
        const name = (agent) =>
          agent.currentRevision.displayName ?? agent.handle;
        const header = page.locator(".rah-agent-detail-head");
        const dialog = () =>
          page.getByRole("dialog", { name: "停止 Agent", exact: true });
        async function openStopConfirmation() {
          const more = header.getByRole("button", {
            name: "更多操作",
            exact: true,
          });
          if (await more.isVisible()) {
            await more.press("Enter");
            await page
              .getByRole("menuitem", { name: "停止 Agent", exact: true })
              .press("Enter");
          } else {
            await header
              .getByRole("button", { name: "停止 Agent", exact: true })
              .press("Enter");
          }
        }
        await page.goto(
          `${fixture.origin}/?surface=agents&agent=${bId}&agentTab=profile`,
        );
        await header.waitFor();
        await page
          .locator(".rah-agent-directory-list button.rah-agent-member-row")
          .filter({ hasText: name(a) })
          .click();
        await page.waitForURL((url) => url.searchParams.get("agent") === aId);
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        const received = Promise.withResolvers(),
          delayed = Promise.withResolvers();
        release = () => delayed.resolve();
        const requests = [];
        await page.route("**/v3/client/agents/manage", async (route) => {
          const body = route.request().postDataJSON();
          requests.push(body);
          if (body.agentDefinitionId !== aId || body.action !== "set_state")
            return route.continue();
          if (outcome === "success") {
            const response = await route.fetch();
            received.resolve({
              status: response.status(),
              body: await response.json(),
            });
            await delayed.promise;
            await route.fulfill({ response });
          } else {
            received.resolve({ status: 503 });
            await delayed.promise;
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "unavailable",
                  message: "Isolated obsolete Agent A failure",
                },
              }),
            });
          }
        });
        // This gate isolates keyboard intent and stale-response ownership.
        // Right-click pointer/geometry coverage lives in test-member-context-browser.
        await openStopConfirmation();
        await dialog()
          .getByRole("button", { name: "停止 Agent", exact: true })
          .click();
        const accepted = await received.promise;
        assert.equal(
          accepted.status,
          outcome === "success" ? 200 : 503,
          JSON.stringify(accepted),
        );
        assert.equal(
          await dialog()
            .getByRole("button", { name: /停止中…$/ })
            .isDisabled(),
          true,
        );
        await page.goBack();
        await page.waitForURL((url) => url.searchParams.get("agent") === bId);
        await dialog().waitFor({ state: "hidden" });
        // This gate isolates keyboard intent and stale-response ownership.
        // Right-click pointer/geometry coverage lives in test-member-context-browser.
        await openStopConfirmation();
        await dialog().waitFor();
        await page.screenshot({ path: join(output, `${label}-before.png`) });
        const completed = page.waitForResponse(
          (response) =>
            response.url().endsWith("/v3/client/agents/manage") &&
            response.request().postDataJSON().agentDefinitionId === aId,
        );
        release();
        await (await completed).finished();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const visible = await dialog().isVisible();
        await page.screenshot({ path: join(output, `${label}-after.png`) });
        writeFileSync(
          join(output, `${label}-result.json`),
          JSON.stringify(
            {
              engine,
              outcome,
              width,
              visible,
              activeAgent: new URL(page.url()).searchParams.get("agent"),
              requests,
            },
            null,
            2,
          ),
        );
        assert.equal(
          visible,
          true,
          "A completion must not close newly opened B confirmation after browser Back",
        );
        assert.equal(new URL(page.url()).searchParams.get("agent"), bId);
        assert.match(await dialog().innerText(), new RegExp(name(b)));
        assert.equal(
          await dialog().getByRole("alert").count(),
          0,
          "A failure must not appear in B confirmation",
        );
        assert.equal(
          await dialog()
            .getByRole("button", { name: "停止 Agent", exact: true })
            .isEnabled(),
          true,
        );
        assert.equal(
          await dialog().evaluate((element) =>
            element.contains(document.activeElement),
          ),
          true,
          "late completion must preserve focus in B",
        );
        assert.equal(
          (await post("agents/get", { agentDefinitionId: aId })).agent
            .definition.state,
          outcome === "success" ? "disabled" : "enabled",
        );
        assert.equal(
          (await post("agents/get", { agentDefinitionId: bId })).agent
            .definition.state,
          "enabled",
        );
        await dialog()
          .getByRole("button", { name: "停止 Agent", exact: true })
          .click();
        await dialog().waitFor({ state: "hidden" });
        assert.equal(
          (await post("agents/get", { agentDefinitionId: bId })).agent
            .definition.state,
          "disabled",
        );
        assert.equal(
          requests.filter((request) => request.agentDefinitionId === aId)
            .length,
          1,
        );
        assert.equal(
          requests.filter((request) => request.agentDefinitionId === bId)
            .length,
          1,
        );
        assert.notEqual(
          requests[0].idempotencyKey,
          requests.at(-1).idempotencyKey,
        );
        await page.reload();
        await header.waitFor();
        const more = header.getByRole("button", {
          name: "更多操作",
          exact: true,
        });
        if (await more.isVisible()) {
          await more.press("Enter");
          await page
            .getByRole("menuitem", { name: "启动 Agent", exact: true })
            .waitFor();
          await page.keyboard.press("Escape");
        } else {
          await header
            .getByRole("button", { name: "启动 Agent", exact: true })
            .waitFor();
        }
        assert.deepEqual(pageErrors, []);
        results.push({
          engine,
          outcome,
          width,
          obsoleteResponseIgnored: true,
          newActionCompleted: true,
          reloadPersisted: true,
        });
        console.log(JSON.stringify(results.at(-1)));
      } finally {
        release();
        await browser?.close();
        await fixture.close();
      }
    }
writeFileSync(
  join(output, "result.json"),
  JSON.stringify({ output, results }, null, 2),
);
console.log(JSON.stringify({ output, results }));
