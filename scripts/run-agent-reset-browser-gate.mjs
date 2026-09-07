import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
const options = { extraPaths: uiContractEvidenceInputPaths() },
  inputs = snapshotUiEvidenceInputs(options);
const output = mkdtempSync(join(tmpdir(), "rah-agent-reset-")),
  results = [];
for (const engine of ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  let page;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.addInitScript(() =>
      localStorage.setItem("rah:web-push-desired:v1", "disabled"),
    );
    const post = async (path, data) => {
      const r = await page.request.post(fixture.origin + "/v3/client/" + path, {
        data,
      });
      assert.equal(r.status(), 200, await r.text());
      return r.json();
    };
    const workspace = (await post("workspaces/list", {})).workspaces[0];
    const agent = (
      await post("agents/list", { controlRoomId: workspace.controlRoomId })
    ).agents[0];
    const id = agent.definition.agentDefinitionId;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const before = await post("agents/get", { agentDefinitionId: id });
      await page.goto(
        fixture.origin + `/?surface=agents&agent=${id}&agentTab=profile`,
      );
      await page
        .getByRole("button", { name: "重启 / 重置", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: /^重新启动/ });
      // Transport/denial states must not dispatch a replacement operation or
      // let Escape dismiss an in-flight reset. Host fencing is tested separately.
      for (const status of [503, 403]) {
        let finish;
        const held = new Promise((resolve) => {
          finish = resolve;
        });
        await page.route(
          "**/v3/client/agents/execution/reset",
          async (route) => {
            await held;
            await route.fulfill({
              status,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: status === 403 ? "forbidden" : "unavailable",
                  message: "Isolated reset failure gate",
                },
              }),
            });
          },
        );
        await dialog
          .getByRole("button", { name: "重新启动", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "重启中…", exact: true })
          .waitFor();
        assert.equal(
          await dialog
            .getByRole("button", { name: "取消", exact: true })
            .isDisabled(),
          true,
        );
        await page.keyboard.press("Escape");
        assert.equal(await dialog.isVisible(), true);
        finish();
        await dialog.getByRole("alert").waitFor();
        assert.equal(
          await dialog
            .getByRole("button", { name: "重新启动", exact: true })
            .isEnabled(),
          true,
        );
        await page.unroute("**/v3/client/agents/execution/reset");
      }
      const requests = [],
        receipts = [];
      await page.route("**/v3/client/agents/execution/reset", async (route) => {
        requests.push(route.request().postDataJSON());
        const response = await route.fetch();
        assert.equal(response.status(), 200, await response.text());
        receipts.push(await response.json());
        if (requests.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      });
      await dialog
        .getByRole("button", { name: "重新启动", exact: true })
        .click();
      await dialog.getByRole("alert").waitFor();
      for (const radio of await dialog.getByRole("radio").all())
        assert.equal(
          await radio.isDisabled(),
          true,
          "uncertain intent must keep its original reset mode",
        );
      await page.screenshot({
        path: join(output, `${engine}-${width}-retry.png`),
      });
      await dialog
        .getByRole("button", { name: "重新启动", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(requests.length, 2);
      assert.equal(
        requests[0].idempotencyKey,
        requests[1].idempotencyKey,
        "retry must recover the original reset, never create a second operation",
      );
      assert.equal(receipts[0].operationId, receipts[1].operationId);
      assert.equal(receipts[1].deduplicated, true);
      await page.unroute("**/v3/client/agents/execution/reset");
      await page.reload();
      await page
        .getByRole("button", { name: "重启 / 重置", exact: true })
        .waitFor();
      const after = await post("agents/get", { agentDefinitionId: id });
      assert.deepEqual(
        after.agent.currentRevision,
        before.agent.currentRevision,
      );
      assert.equal(
        after.agent.definition.participantId,
        before.agent.definition.participantId,
      );
      await page.screenshot({ path: join(output, `${engine}-${width}.png`) });
      results.push({
        engine,
        width,
        status: "passed",
        sameResetOperation: true,
        revisionDelta: 0,
      });
    }
  } catch (error) {
    if (page)
      await page.screenshot({ path: join(output, `${engine}-failure.png`) });
    console.error(output);
    throw error;
  } finally {
    await browser.close();
    await fixture.close();
  }
}
assertUiEvidenceInputSnapshot(inputs, options);
writeFileSync(
  join(output, "receipt.json"),
  JSON.stringify({ inputs, results }, null, 2),
);
console.log(JSON.stringify({ output, results }));
