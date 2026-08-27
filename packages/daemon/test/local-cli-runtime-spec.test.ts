import assert from "node:assert/strict";
import test from "node:test";

import {
  localCliRuntimeSpec,
  localWorkbenchWorkerPrompt,
} from "../src/local-cli-runtime-spec.ts";

test("known local CLI specs share the frozen Agent and canonical Worker contract", () => {
  const workspaceCwd = "/tmp/rah-workspace";
  const prompt = localWorkbenchWorkerPrompt();
  assert.match(prompt, /RAH_AGENT_CONTEXT_JSON/u);
  assert.match(prompt, /RAH_WORKER_API_URL/u);
  assert.match(prompt, /canonical Room/u);

  for (const executable of ["codex", "kimi", "opencode", "claude"]) {
    const spec = localCliRuntimeSpec(executable, workspaceCwd);
    assert.notEqual(spec, undefined);
    assert.equal(spec?.workspaceCwd, workspaceCwd);
    assert.ok(spec?.args.includes(prompt));
    assert.match(spec?.runtimeProfileId ?? "", /^local-workbench-profile-/u);
    assert.notEqual(spec?.instructions.trim(), "");
    assert.equal(
      spec?.reasoning,
      "default",
      "fixed CLI arguments must not claim an unprobed model binding",
    );
  }
  assert.equal(localCliRuntimeSpec("unknown", workspaceCwd), undefined);
});
