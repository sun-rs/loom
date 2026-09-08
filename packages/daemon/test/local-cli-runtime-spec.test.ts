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
  assert.match(prompt, /RAH_CONTEXT_MANIFEST_JSON/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_INDEX/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_BOOTSTRAP_JSON/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_SOURCE_FILE/u);
  assert.match(prompt, /launch provenance.*not proof/isu);
  assert.doesNotMatch(prompt, /writing.*index tags.*selecting notes/isu);
  assert.match(prompt, /read the complete original MEMORY\.md/isu);
  assert.match(prompt, /status "verbatim".*complete, unchanged index/isu);
  assert.doesNotMatch(prompt, /Project hints are optional relevance clues/u);
  assert.match(prompt, /RAH_AGENT_APP_INBOX_JSON/u);
  assert.match(prompt, /typed Computer-local App Inbox.*not a Room Message/isu);
  assert.match(prompt, /MEMORY\.md.*self-sufficient as a recovery point/isu);
  assert.match(prompt, /notes\/.*relative to that memory directory/isu);
  assert.match(prompt, /only the additional notes needed for this turn/isu);
  assert.match(prompt, /64 KiB threshold.*not a target or token budget/isu);
  assert.doesNotMatch(prompt, /4 KiB.*writing target|512.*block/isu);
  assert.match(
    prompt,
    /After updating notes, update the index in MEMORY\.md/isu,
  );
  assert.match(
    prompt,
    /User preferences.*World\/project context.*Work history/isu,
  );
  assert.match(
    prompt,
    /canonical Room\/Task\/ACL state remains authoritative/isu,
  );
  assert.match(prompt, /Never copy credentials, access tokens, private keys/u);
  assert.match(prompt, /Before a long task.*Active Context/isu);
  assert.doesNotMatch(
    prompt,
    /only when.*durable.*useful beyond the current Room.*safe to retain/isu,
  );
  assert.doesNotMatch(
    prompt,
    /Do not persist.*current date or time.*one-off query.*failed lookup.*test probe.*raw transcript/isu,
  );
  assert.match(prompt, /across Rooms, RuntimeProfiles, models/isu);
  assert.match(prompt, /RAH_FROM_SEQ/u);
  assert.match(prompt, /RAH_TO_SEQ/u);
  assert.match(
    prompt,
    /before RAH_FROM_SEQ.*context only.*must not.*business action/isu,
  );
  assert.match(
    prompt,
    /assigned to process\.env\.RAH_PARTICIPANT_ID.*unassigned/isu,
  );
  assert.match(
    prompt,
    /ordinary conversation.*must remain a message.*not a Task/isu,
  );
  assert.match(prompt, /tool use.*does not make.*Task/isu);
  assert.match(prompt, /long-running.*persistent changes.*progress.*review/isu);
  assert.match(
    prompt,
    /After task-claim-message succeeds.*event\.roomSeq.*task-start.*task-progress.*task-submit/isu,
  );
  assert.match(
    prompt,
    /task-claim-message.*conflict.*acknowledge.*must not duplicate/isu,
  );
  assert.match(
    prompt,
    /requires you to take action beyond just replying.*claim/isu,
  );
  assert.match(prompt, /Only top-level.*can become Tasks/isu);
  assert.match(prompt, /from a Human or another Agent/isu);
  assert.match(prompt, /@<handle>.*message-post/isu);
  assert.match(prompt, /Mention others, not yourself/iu);
  assert.match(prompt, /Room is the isolation boundary/iu);
  assert.match(prompt, /RAH_WORKER_CLI.*worker task-create/u);
  assert.match(prompt, /task-create.*unassigned.*todo/isu);
  assert.match(prompt, /cannot assign another participant/isu);
  assert.match(prompt, /Prefer independent subtasks/iu);
  assert.match(prompt, /Avoid creating sequential chains/iu);
  assert.match(prompt, /existing Tasks to avoid duplicates/isu);
  assert.match(
    prompt,
    /task-block.*before acknowledging|cannot acknowledge.*idle/isu,
  );
  assert.match(prompt, /roomSeq of.*(reopened|changes_requested).*key/isu);
  assert.match(prompt, /task\.reopened/u);
  assert.match(prompt, /Reuse existing Tasks and Threads/iu);
  assert.match(prompt, /collaboratorIds.*must not claim/isu);
  assert.match(prompt, /task\.submitted.*reviewerIds/isu);
  assert.match(
    prompt,
    /task\.submitted.*task-review.*approved.*changes_requested/isu,
  );
  assert.match(prompt, /canonical Room/u);
  assert.match(prompt, /RAH_WORKER_CLI.*worker sync/u);
  assert.match(prompt, /RAH_WORKER_CLI.*worker message-post/u);
  assert.match(prompt, /Respect ongoing conversations/iu);
  assert.match(prompt, /Only the person doing the work should report/iu);
  assert.match(prompt, /Claim before you start.*concurrency lock/isu);
  assert.match(prompt, /Before stopping.*blockers you own/isu);
  assert.match(prompt, /Skip idle narration.*actionable content/isu);
  assert.match(prompt, /turn-taking.*newest committed message/isu);
  assert.match(
    prompt,
    /state.*held.*not published.*acknowledge.*follow-up Activation/isu,
  );
  assert.match(prompt, /### Sending messages/u);
  assert.match(
    prompt,
    /message-post --target "#room-slug" <<'RAH_MESSAGE_EOF'/u,
  );
  assert.match(prompt, /Message content is always read from stdin/u);
  assert.match(
    prompt,
    /--send-draft --target <target>.*with no stdin.*Do not use `--send-draft` when changing content/isu,
  );
  assert.match(
    prompt,
    /always reuse the exact `target` from the received message/u,
  );
  assert.doesNotMatch(prompt, /--held-draft-id/u);
  assert.doesNotMatch(prompt, /message-post --body/u);
  assert.match(prompt, /send-draft.*rechecks freshness/isu);
  assert.match(prompt, /--anyway.*continueAnywaySuggested/isu);
  assert.match(prompt, /goal.*already complete.*remain silent/isu);
  assert.match(prompt, /RAH_WORKER_CLI.*worker task-submit/u);
  assert.match(prompt, /task\.reassigned/u);
  assert.match(
    prompt,
    /stable idempotency keys.*participant ID.*Task ID.*operation/isu,
  );
  assert.match(
    prompt,
    /explicit result file.*artifact-publish.*before.*task-submit/isu,
  );
  assert.match(prompt, /RAH_WORKER_CLI.*worker acknowledge/u);
  assert.doesNotMatch(prompt, /RAH_WORKER_API_URL/u);
  assert.doesNotMatch(prompt, /RAH_WORKER_TOKEN/u);
  assert.doesNotMatch(prompt, /\/v1\/worker/u);
  assert.doesNotMatch(prompt, /Authorization/u);

  for (const executable of ["codex", "kimi", "opencode", "claude"]) {
    const spec = localCliRuntimeSpec(executable, workspaceCwd);
    assert.notEqual(spec, undefined);
    assert.equal(spec?.workspaceCwd, workspaceCwd);
    assert.equal(
      (spec as unknown as Record<string, unknown>).args,
      undefined,
      "no local CLI spec freezes launch arguments or a standing prompt",
    );
    assert.match(spec?.runtimeProfileId ?? "", /^local-workbench-profile-/u);
    assert.notEqual(spec?.instructions.trim(), "");
    assert.equal(
      spec?.reasoning,
      "default",
      "fixed CLI arguments must not claim an unprobed model binding",
    );
  }
  assert.equal(
    localCliRuntimeSpec("codex", workspaceCwd)?.modelCatalogProbe?.kind,
    "codex-cli/v1",
  );
  assert.equal(
    localCliRuntimeSpec("codex", workspaceCwd)?.adapterKind,
    "codex-app-server/v1",
  );
  assert.equal(
    localCliRuntimeSpec("kimi", workspaceCwd)?.modelCatalogProbe?.kind,
    "kimi-cli/v1",
  );
  assert.equal(
    localCliRuntimeSpec("kimi", workspaceCwd)?.adapterKind,
    "kimi-acp/v1",
  );
  assert.equal(
    localCliRuntimeSpec("opencode", workspaceCwd)?.modelCatalogProbe?.kind,
    "opencode-cli/v1",
  );
  assert.equal(
    localCliRuntimeSpec("opencode", workspaceCwd)?.adapterKind,
    "opencode-server/v1",
  );
  assert.equal(
    localCliRuntimeSpec("claude", workspaceCwd)?.modelCatalogProbe?.kind,
    "claude-cli/v1",
  );
  const claudeSpec = localCliRuntimeSpec("claude", workspaceCwd)!;
  assert.equal(claudeSpec.adapterKind, "claude-stream-json/v1");
  assert.doesNotMatch(claudeSpec.displayName, /Sonnet|low/u);
  for (const executable of ["claude", "codex", "kimi", "opencode"]) {
    assert.equal(
      localCliRuntimeSpec(executable, workspaceCwd)?.toolAccessMode,
      "full_access",
      `${executable} must use the Raft-compatible unattended default`,
    );
  }
  for (const executable of ["claude", "codex", "kimi", "opencode"])
    assert.equal(
      "managedMcpAdapter" in localCliRuntimeSpec(executable, workspaceCwd)!,
      false,
    );
  assert.equal(localCliRuntimeSpec("unknown", workspaceCwd), undefined);
});
