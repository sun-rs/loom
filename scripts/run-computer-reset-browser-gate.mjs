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
const options = { extraPaths: uiContractEvidenceInputPaths() };
const output = mkdtempSync(join(tmpdir(), "rah-computer-reset-"));
const receipt = { inputs: snapshotUiEvidenceInputs(options), results: [] };
process.env.RAH_FIXTURE_WORKSPACE_FILES = "1";
try {
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
      const post = async (path, data) => {
        const r = await page.request.post(
          fixture.origin + "/v3/client/" + path,
          { data },
        );
        assert.equal(r.status(), 200, await r.text());
        return r.json();
      };
      const workspace = (await post("workspaces/list", {})).workspaces[0];
      const before = (
        await post("agents/list", { controlRoomId: workspace.controlRoomId })
      ).agents;
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        await page.goto(fixture.origin + "/?surface=computers");
        const section = page.getByRole("region", {
          name: "这台 COMPUTER 上的 AGENT",
          exact: true,
        });
        const create = section.getByRole("button", {
          name: "创建 Agent",
          exact: true,
        });
        await create.waitFor();
        const sectionBox = await section.boundingBox(),
          createBox = await create.boundingBox();
        assert.ok(
          Math.abs(
            sectionBox.x +
              sectionBox.width -
              20 -
              (createBox.x + createBox.width),
          ) < 2,
          "Raft Computer actions align at the section's trailing content edge",
        );
        assert.equal(
          await create.evaluate((e) => getComputedStyle(e).backgroundColor),
          "rgb(254, 125, 168)",
        );
        assert.equal(await create.locator("svg use").count(), 1);
        await section
          .getByRole("button", { name: "选择 Agent", exact: true })
          .click();
        await section
          .getByRole("button", { name: "全选 Agent", exact: true })
          .click();
        for (const [mode, label] of [
          ["restart", "重新启动"],
          ["session", "重置会话并重启"],
          ["full", "完全重置并重启"],
        ]) {
          const summaries = await Promise.all(
            before.map((agent) =>
              post("agents/workspace/summary", {
                agentDefinitionId: agent.definition.agentDefinitionId,
              }),
            ),
          );
          const trigger = section.getByRole("button", {
            name: "重启 / 重置所选",
            exact: true,
          });
          await trigger.click();
          const dialog = page.getByRole("dialog", {
            name: "重新启动 所选 2 个 Agent",
            exact: true,
          });
          await dialog
            .getByRole("radio", { name: new RegExp("^" + label) })
            .locator("..")
            .click();
          const requests = [],
            responses = [];
          await page.route(
            "**/v3/client/agents/execution/reset",
            async (route) => {
              const request = route.request().postDataJSON();
              requests.push(request);
              const response = await route.fetch();
              const result = await response.json();
              assert.equal(response.status(), 200, JSON.stringify(result));
              responses.push(result);
              if (requests.length === 2)
                await route.fulfill({
                  status: 503,
                  contentType: "application/json",
                  body: JSON.stringify({
                    error: {
                      code: "unavailable",
                      message: "Fixture lost second accepted reset receipt",
                    },
                  }),
                });
              else await route.fulfill({ response });
            },
          );
          await dialog
            .getByRole("button", { name: label, exact: true })
            .click();
          await dialog.getByRole("alert").waitFor();
          await page.screenshot({
            path: join(output, `${engine}-${width}-${mode}-retry.png`),
          });
          assert.equal(
            await dialog.getByRole("radio").first().isDisabled(),
            true,
          );
          await dialog
            .getByRole("button", { name: label, exact: true })
            .click();
          await dialog.waitFor({ state: "hidden" });
          assert.equal(requests.length, 3);
          assert.equal(
            new Set(requests.map((r) => r.agentDefinitionId)).size,
            2,
          );
          assert.equal(requests[1].idempotencyKey, requests[2].idempotencyKey);
          assert.equal(responses[1].operationId, responses[2].operationId);
          assert.equal(responses[2].deduplicated, true);
          assert.ok(requests.every((r) => r.mode === mode));
          await page.unrouteAll();
          assert.equal(
            await trigger.evaluate((el) => document.activeElement === el),
            true,
          );
          const after = (
            await post("agents/list", {
              controlRoomId: workspace.controlRoomId,
            })
          ).agents;
          assert.deepEqual(
            after.map((a) => a.currentRevision),
            before.map((a) => a.currentRevision),
          );
          assert.deepEqual(
            after.map((a) => a.definition.participantId),
            before.map((a) => a.definition.participantId),
          );
          const afterSummaries = await Promise.all(
            before.map((agent) =>
              post("agents/workspace/summary", {
                agentDefinitionId: agent.definition.agentDefinitionId,
              }),
            ),
          );
          if (mode !== "full") assert.deepEqual(afterSummaries, summaries);
          else
            assert.ok(
              afterSummaries.every(
                (s) => s.state === "absent" || s.fileCount === 0,
              ),
              JSON.stringify(afterSummaries),
            );
          await page.screenshot({
            path: join(output, `${engine}-${width}-${mode}.png`),
          });
          receipt.results.push({
            engine,
            width,
            mode,
            status: "passed",
            deduplicated: true,
          });
        }
        await page.reload();
        await page
          .getByRole("region", {
            name: "这台 COMPUTER 上的 AGENT",
            exact: true,
          })
          .waitFor();
      }
    } catch (error) {
      if (page)
        await page.screenshot({ path: join(output, `${engine}-failure.png`) });
      throw error;
    } finally {
      await browser.close();
      await fixture.close();
    }
  }
  assertUiEvidenceInputSnapshot(receipt.inputs, options);
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(output);
  console.log(JSON.stringify(receipt.results));
}
