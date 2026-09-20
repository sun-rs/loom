import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const evidenceOptions = { extraPaths: uiContractEvidenceInputPaths() };
const evidenceInputs = snapshotUiEvidenceInputs(evidenceOptions);
const output = mkdtempSync(join(tmpdir(), "rah-runtime-continuity-"));
process.env.RAH_FIXTURE_EXECUTION_PROBE_DIRECTORY = output;
const fixture = await startShellFixture();
delete process.env.RAH_FIXTURE_EXECUTION_PROBE_DIRECTORY;
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20000);
const post = async (path, data) => {
  const r = await page.request.post(fixture.origin + "/v3/client/" + path, {
    data,
  });
  assert.equal(r.status(), 200, await r.text());
  return r.json();
};
const observations = () =>
  readdirSync(output)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(join(output, n), "utf8")));
const waitFor = async (predicate) => {
  for (let i = 0; i < 400; i++) {
    const result = predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timed out waiting for actual child launch");
};
try {
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const agent = (
    await post("agents/list", { controlRoomId: workspace.controlRoomId })
  ).agents[0];
  const id = agent.definition.agentId;
  const participantId = agent.definition.participantId;
  const send = async (body) => {
    const sync = await post("rooms/sync", {
      roomId: fixture.roomId,
      consumerId: "runtime-continuity",
      bootstrap: "latest",
    });
    await post("messages/post", {
      roomId: fixture.roomId,
      basedOnRoomSeq: sync.latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
      body,
      recipients: [{ participantId, reason: "mention" }],
    });
  };
  await send("First explicit continuity probe");
  const first = await waitFor(() =>
    observations().find((o) => o.agent.participantId === participantId),
  );
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
  await page
    .locator('[role="menuitemradio"][aria-checked="false"]:not(:disabled)')
    .first()
    .click();
  await dialog.getByRole("button", { name: /^模型：/ }).click();
  await page
    .getByRole("menuitemradio", { name: "Fixture Beta", exact: true })
    .click();
  await dialog.getByRole("button", { name: /^推理强度：/ }).click();
  await page.getByRole("menuitemradio", { name: "High", exact: true }).click();
  await dialog
    .getByRole("button", { name: "保存运行时配置", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  const configured = await post("agents/get", { agentId: id });
  assert.notEqual(
    configured.agent.currentRevision.agentDefinitionRevisionId,
    first.agent.agentDefinitionRevision.agentDefinitionRevisionId,
  );
  assert.equal(
    observations().length,
    1,
    "configuration must not replace the active process",
  );
  writeFileSync(
    join(first.memoryDirectory, "notes", "runtime-continuity-probe.txt"),
    "isolated gate memory marker",
  );
  writeFileSync(join(output, "release"), "release");
  await waitFor(() =>
    existsSync(join(output, first.runAttemptId + ".continued")),
  );
  await send("Second explicit continuity probe");
  const second = await waitFor(() =>
    observations().find(
      (o) =>
        o.agent.participantId === participantId &&
        o.runAttemptId !== first.runAttemptId,
    ),
  );
  assert.equal(
    second.agent.agentDefinitionRevision.agentDefinitionRevisionId,
    configured.agent.currentRevision.agentDefinitionRevisionId,
  );
  assert.notEqual(first.profile, second.profile);
  assert.equal(second.cwd, first.cwd);
  assert.equal(second.memoryDirectory, first.memoryDirectory);
  assert.equal(second.probeNote, "isolated gate memory marker");
  assert.notEqual(second.memoryDirectory, second.cwd);
  assert.ok(second.argv.includes("fixture-beta"), JSON.stringify(second.argv));
  assert.ok(
    second.argv.some((a) => a.includes("high")),
    JSON.stringify(second.argv),
  );
  assert.deepEqual(
    observations().find((o) => o.runAttemptId === first.runAttemptId),
    first,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "编辑运行时配置", exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "configured.png") });
  assertUiEvidenceInputSnapshot(evidenceInputs, evidenceOptions);
  writeFileSync(
    join(output, "receipt.txt"),
    JSON.stringify(
      {
        evidenceInputs,
        first,
        second,
        configuredRevision:
          configured.agent.currentRevision.agentDefinitionRevisionId,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output,
      status: "passed",
      oldRunFrozen: true,
      nextRunConfigured: true,
    }),
  );
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png") });
  console.error(output);
  throw error;
} finally {
  writeFileSync(join(output, "release"), "release");
  await browser.close();
  await fixture.close();
}
