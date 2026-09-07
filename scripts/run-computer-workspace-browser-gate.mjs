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
const output = mkdtempSync(join(tmpdir(), "rah-computer-scan-"));
const options = { extraPaths: uiContractEvidenceInputPaths() };
const receipt = { inputs: snapshotUiEvidenceInputs(options), results: [] };
const results = receipt.results;
process.env.RAH_FIXTURE_WORKSPACE_FILES = "1";
try {
  for (const engine of process.env.RAH_UI_BROWSER
    ? [process.env.RAH_UI_BROWSER]
    : ["chrome", "firefox"]) {
    const fixture = await startShellFixture();
    const browser = await (engine === "chrome" ? chromium : firefox).launch({
      headless: true,
      ...(engine === "chrome"
        ? { executablePath: await findChromeExecutable() }
        : {}),
    });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        await page.goto(fixture.origin + "/?surface=computers");
        const agentSection = page.getByRole("region", {
          name: "这台 COMPUTER 上的 AGENT",
          exact: true,
        });
        await agentSection
          .getByRole("button", { name: "选择 Agent", exact: true })
          .click();
        await agentSection
          .getByRole("checkbox", { name: "全选 Agent", exact: true })
          .check();
        const mutationKeys = [];
        let invocation = 0;
        await page.route("**/v3/client/agents/manage", async (route) => {
          const data = route.request().postDataJSON();
          mutationKeys.push(data.idempotencyKey);
          invocation++;
          if (invocation === 2)
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "unavailable",
                  message: "Fixture second item failed",
                },
              }),
            });
          else await route.continue();
        });
        await agentSection
          .getByRole("button", { name: "停用所选", exact: true })
          .click();
        await agentSection.getByRole("alert").waitFor();
        await agentSection
          .getByRole("button", { name: "停用所选", exact: true })
          .click();
        await agentSection.getByText("已完成 2 项", { exact: true }).waitFor();
        assert.equal(mutationKeys.length, 3);
        assert.equal(mutationKeys[1], mutationKeys[2]);
        await page.unrouteAll();
        const workspaces = await (
          await page.request.post(
            fixture.origin + "/v3/client/workspaces/list",
            { data: {} },
          )
        ).json();
        async function assertStates(expected) {
          const response = await page.request.post(
            fixture.origin + "/v3/client/agents/list",
            { data: { controlRoomId: workspaces.workspaces[0].controlRoomId } },
          );
          assert.equal(response.status(), 200);
          assert.deepEqual(
            (await response.json()).agents.map((a) => a.definition.state),
            [expected, expected],
          );
        }
        await assertStates("disabled");
        await agentSection
          .getByRole("button", { name: "启用所选", exact: true })
          .click();
        await agentSection.getByText("已完成 2 项", { exact: true }).waitFor();
        await assertStates("enabled");
        await agentSection
          .getByRole("button", { name: "结束选择", exact: true })
          .click();
        const createAgent = page
          .getByRole("region", {
            name: "这台 COMPUTER 上的 AGENT",
            exact: true,
          })
          .getByRole("button", { name: "创建 Agent", exact: true });
        await createAgent.click();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(
          await createAgent.evaluate((el) => document.activeElement === el),
          true,
        );
        const scan = page.getByRole("button", {
          name: "扫描工作区",
          exact: true,
        });
        await scan.click();
        const region = page.getByRole("region", {
          name: "工作区扫描",
          exact: true,
        });
        await region
          .getByRole("button", { name: "重新扫描", exact: true })
          .waitFor();
        assert.equal(await region.getByRole("alert").count(), 0);
        assert.ok(
          (await region.getByText(/修改于/u).count()) > 0,
          "Workspace scan renders the returned modification time",
        );
        assert.ok(
          (await region.locator("[data-workspace-summary]").count()) > 0,
        );
        await page.route("**/v3/client/agents/workspace/summary", (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "unavailable",
                message: "Fixture scan unavailable",
              },
            }),
          }),
        );
        await region
          .getByRole("button", { name: "重新扫描", exact: true })
          .click();
        await region.getByRole("alert").first().waitFor();
        await page.unrouteAll();
        await region
          .getByRole("button", { name: "重新扫描", exact: true })
          .click();
        await region
          .getByRole("button", { name: "重新扫描", exact: true })
          .waitFor();
        assert.equal(await region.getByRole("alert").count(), 0);
        assert.ok((await region.innerText()).includes("个文件"));
        await page.screenshot({ path: join(output, `${engine}-${width}.png`) });
        results.push({ engine, width, status: "passed" });
      }
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
  console.log(JSON.stringify(results));
  console.log(output);
}
