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
const output = mkdtempSync(join(tmpdir(), "rah-agent-configure-")),
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
    // Old shell seed predates required instructions. Establish the same explicit
    // instruction-bearing definition that production provisioning creates.
    const seed = await post("agents/get", { agentDefinitionId: id });
    const frontier = await post("rooms/sync", {
      roomId: workspace.controlRoomId,
      consumerId: "configure-gate",
      bootstrap: "latest",
    });
    await post("agents/manage", {
      action: "configure",
      agentDefinitionId: id,
      handle: seed.agent.handle,
      displayName: seed.agent.currentRevision.displayName ?? seed.agent.handle,
      role: seed.agent.currentRevision.role,
      instructions:
        "Keep this Agent instruction unchanged across runtime changes.",
      ...(seed.agent.currentRevision.avatarKey
        ? { avatarKey: seed.agent.currentRevision.avatarKey }
        : {}),
      ...(seed.agent.currentRevision.description
        ? { description: seed.agent.currentRevision.description }
        : {}),
      runtimeOfferId: seed.policy.required.allowedOfferIds[0],
      modelIntent: seed.policy.modelIntent,
      toolAccessMode: "full_access",
      basedOnRoomSeq: frontier.latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
    });

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const before = await post("agents/get", { agentDefinitionId: id });
      await page.goto(
        fixture.origin + `/?surface=agents&agent=${id}&agentTab=profile`,
      );
      await page
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "编辑运行时配置",
        exact: true,
      });
      await dialog.getByRole("button", { name: /^运行时：/ }).click();
      const alternative = page
        .locator('[role="menuitemradio"][aria-checked="false"]:not(:disabled)')
        .first();
      await alternative.click();
      const requests = [];
      let accepted;
      await page.route("**/v3/client/agents/manage", async (route) => {
        const input = route.request().postDataJSON();
        requests.push(input);
        const response = await route.fetch();
        assert.equal(response.status(), 200, await response.text());
        const result = await response.json();
        if (requests.length === 1) {
          accepted = result;
          await route.abort("failed");
        } else {
          assert.equal(result.deduplicated, true);
          await route.fulfill({ response });
        }
      });
      await dialog
        .getByRole("button", { name: "保存运行时配置", exact: true })
        .click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(
        accepted.agent.currentRevision.revision,
        before.agent.currentRevision.revision + 1,
      );
      await dialog
        .getByRole("button", { name: "保存运行时配置", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      await page.unroute("**/v3/client/agents/manage");
      await page.reload();
      await page
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .waitFor();
      const after = await post("agents/get", { agentDefinitionId: id });
      assert.equal(
        after.agent.currentRevision.revision,
        before.agent.currentRevision.revision + 1,
      );
      assert.equal(
        after.agent.definition.participantId,
        before.agent.definition.participantId,
      );
      for (const field of ["role", "instructions", "avatarKey", "description"])
        assert.deepEqual(
          after.agent.currentRevision[field],
          before.agent.currentRevision[field],
        );
      assert.deepEqual(after.policy.required.allowedOfferIds, [
        requests[0].runtimeOfferId,
      ]);
      await page.screenshot({ path: join(output, `${engine}-${width}.png`) });
      results.push({
        engine,
        width,
        status: "passed",
        exactRetry: true,
        revisionDelta: 1,
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
