import assert from "node:assert/strict";
import test from "node:test";

import { WORKER_HELP_TOPIC_NAMES, workerHelpTopic } from "@rah-os/agent-host";

import {
  localCliRuntimeSpec,
  localWorkbenchWorkerPrompt,
} from "../src/local-cli-runtime-spec.ts";

test("known local CLI specs share the frozen Agent and canonical Worker contract", () => {
  const workspaceCwd = "/tmp/rah-workspace";
  const prompt = localWorkbenchWorkerPrompt();
  // S1-c: situational guidance moved to `worker help <topic>`, which the
  // prompt names. Moved assertions read that surface; prohibitions cover both.
  assert.match(prompt, /worker help <topic>/u);
  const onDemand = WORKER_HELP_TOPIC_NAMES.map((topic) =>
    workerHelpTopic(topic)!,
  ).join("\n\n");
  const everything = `${prompt}\n\n${onDemand}`;
  assert.match(prompt, /RAH_AGENT_CONTEXT_JSON/u);
  assert.match(prompt, /RAH_CONTEXT_MANIFEST_JSON/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_INDEX/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_BOOTSTRAP_JSON/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_SOURCE_FILE/u);
  assert.match(onDemand, /launch provenance.*not proof/isu);
  assert.doesNotMatch(everything, /writing.*index tags.*selecting notes/isu);
  assert.match(prompt, /read the complete original MEMORY\.md/isu);
  assert.match(onDemand, /status "verbatim".*complete, unchanged index/isu);
  assert.doesNotMatch(
    everything,
    /Project hints are optional relevance clues/u,
  );
  assert.match(prompt, /RAH_AGENT_APP_INBOX_JSON/u);
  assert.match(
    onDemand,
    /typed Computer-local App Inbox.*not a Room Message/isu,
  );
  assert.match(prompt, /MEMORY\.md.*self-sufficient as a recovery point/isu);
  assert.match(prompt, /notes\/.*relative to that memory directory/isu);
  assert.match(prompt, /only the additional notes needed for this turn/isu);
  assert.match(onDemand, /64 KiB threshold.*not a target or token budget/isu);
  assert.doesNotMatch(everything, /4 KiB.*writing target|512.*block/isu);
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
    everything,
    /only when.*durable.*useful beyond the current Room.*safe to retain/isu,
  );
  assert.doesNotMatch(
    everything,
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
  assert.doesNotMatch(
    everything,
    /ordinary conversation.*must remain a message.*not a Task/isu,
  );
  assert.doesNotMatch(everything, /tool use.*does not make.*Task/isu);
  assert.doesNotMatch(
    everything,
    /A Task is reserved for long-running or multi-step execution/isu,
  );
  assert.match(
    prompt,
    // The claim acknowledges in Raft's text, so the prompt points at the
    // printed claim line rather than at a JSON field.
    /After task-claim-message succeeds.*claimed` line it prints.*task-start.*task-progress.*task-submit/isu,
  );
  assert.doesNotMatch(
    everything,
    /must not duplicate the work or post a competing/isu,
  );
  assert.match(
    prompt,
    /task-claim-message returns a conflict.*do not start conflicting execution or take over its scope without a redirect/isu,
  );
  assert.match(
    prompt,
    /requires you to take action beyond just replying.*claim/isu,
  );
  assert.match(prompt, /Only top-level.*can become Tasks/isu);
  assert.match(onDemand, /from a Human or another Agent/isu);
  assert.match(prompt, /@<handle>.*message-post/isu);
  assert.match(prompt, /Mention others, not yourself/iu);
  assert.match(prompt, /Room is the isolation boundary/iu);
  assert.match(onDemand, /RAH_WORKER_CLI.*worker task-create/u);
  assert.match(onDemand, /task-create.*unassigned.*todo/isu);
  assert.match(onDemand, /cannot assign another participant/isu);
  assert.match(onDemand, /Prefer independent subtasks/iu);
  assert.match(onDemand, /Avoid creating sequential chains/iu);
  assert.match(onDemand, /existing Tasks to avoid duplicates/isu);
  assert.match(
    onDemand,
    /task-block.*is how a parent Task records that it waits on its subtasks/isu,
  );
  // The rework round is separated by the server-derived key, not by a prompt
  // rule telling the Agent to fold a triggering roomSeq into one.
  assert.doesNotMatch(
    everything,
    /roomSeq of.*(reopened|changes_requested).*key/isu,
  );
  assert.match(onDemand, /task\.reopened/u);
  assert.match(onDemand, /Reuse existing Tasks and Threads/iu);
  assert.match(prompt, /collaboratorIds.*must not claim/isu);
  assert.match(onDemand, /task\.submitted.*reviewerIds/isu);
  assert.match(
    onDemand,
    /task\.submitted.*task-review.*approved.*changes_requested/isu,
  );
  assert.match(prompt, /canonical Room/u);
  assert.match(prompt, /RAH_WORKER_CLI.*worker message-check/u);
  assert.match(prompt, /RAH_WORKER_CLI.*worker message-post/u);
  assert.match(prompt, /Respect ongoing conversations/iu);
  assert.match(prompt, /Only the person doing the work should report/iu);
  assert.match(prompt, /Claim before you start.*concurrency lock/isu);
  assert.match(prompt, /Before stopping.*blockers you own/isu);
  assert.match(prompt, /Skip idle narration.*actionable content/isu);
  assert.doesNotMatch(everything, /turn-taking/iu);
  assert.match(
    onDemand,
    /state.*held.*not published.*delivery confirmation.*follow-up Activation/isu,
  );
  assert.match(prompt, /### Sending messages/u);
  assert.match(
    prompt,
    /message-post --target "#room-slug" <<'RAH_MESSAGE_EOF'/u,
  );
  assert.match(prompt, /Message content is always read from stdin/u);
  assert.match(
    onDemand,
    /--send-draft --target <target>.*with no stdin.*Do not use `--send-draft` when changing content/isu,
  );
  assert.match(
    prompt,
    /always reuse the exact `target` from the received message/u,
  );
  assert.doesNotMatch(everything, /--held-draft-id/u);
  assert.doesNotMatch(everything, /message-post --body/u);
  assert.match(onDemand, /send-draft.*rechecks freshness/isu);
  assert.match(onDemand, /--anyway.*continueAnywaySuggested/isu);
  assert.doesNotMatch(everything, /goal.*already complete.*remain silent/isu);
  assert.match(prompt, /RAH_WORKER_CLI.*worker task-submit/u);
  assert.match(onDemand, /task\.reassigned/u);
  // Raft has no such recipe, and the server now derives the key itself.
  assert.doesNotMatch(
    everything,
    /stable idempotency keys.*participant ID.*Task ID.*operation/isu,
  );
  assert.match(
    onDemand,
    /explicit result file.*artifact-publish.*before.*task-submit/isu,
  );
  assert.match(
    prompt,
    /Delivery confirmation is automatic in `message-check`/u,
  );
  assert.doesNotMatch(everything, /worker acknowledge --through-seq/u);
  assert.doesNotMatch(everything, /RAH_WORKER_API_URL/u);
  assert.doesNotMatch(everything, /RAH_WORKER_TOKEN/u);
  assert.doesNotMatch(everything, /\/v1\/worker/u);
  assert.doesNotMatch(everything, /Authorization/u);
  // The ported Raft sections reach the local workbench prompt too.
  assert.match(prompt, /## Startup sequence/u);
  assert.match(prompt, /### Credential handling/u);
  assert.match(prompt, /### Reminders/u);
  assert.match(prompt, /### Room awareness/u);
  assert.match(prompt, /## Communication style/u);
  assert.match(onDemand, /## Live constraints and pull-request closure/u);
  assert.match(prompt, /### Formatting — Mentions & Room Refs/u);
  assert.match(prompt, /### Formatting — URLs in non-English text/u);

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

test("built-in CLI names expose products without transport descriptions", () => {
  for (const [cli, label] of [
    ["codex", "Codex CLI"],
    ["claude", "Claude Code"],
    ["kimi", "Kimi Code"],
    ["opencode", "OpenCode"],
  ]) {
    assert.equal(
      localCliRuntimeSpec(cli!, "/tmp/rah-label-test")?.displayName,
      label,
    );
  }
});
