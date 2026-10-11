import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  STANDING_PROMPT_COMPILER_VERSION,
  compileStandingPrompt,
  standingPromptLayers,
  type StandingPromptAgentLayer,
  type StandingPromptRuntimeContext,
} from "../src/standing-prompt-compiler.ts";
import { localWorkbenchWorkerPrompt } from "../src/local-cli-runtime-spec.ts";
import { WORKER_HELP_TOPIC_NAMES, workerHelpTopic } from "@rah-os/agent-host";

/**
 * S1-c: situational guidance moved verbatim from the standing prompt to
 * `worker help <topic>`, which the prompt names. Assertions about moved text
 * read this on-demand surface; prohibitions cover the prompt and the surface.
 */
const onDemand = WORKER_HELP_TOPIC_NAMES.map((topic) =>
  workerHelpTopic(topic)!,
).join("\n\n");
const withHelp = (prompt: string) => `${prompt}\n\n${onDemand}`;

const LEGACY_HEADER_SENTENCE =
  "You are a RAH OS Room worker launched for one durable Activation.";

const fixtureAgent: StandingPromptAgentLayer = {
  description: "Reviews changes and reports evidence.",
  displayName: "Claude Code",
  handle: "claude",
  instructions:
    "Line one with `backticks` and $DOLLAR.\nLine two with ${braces} preserved.",
  participantId: "participant-42",
  role: "Claude Code Agent using the local account",
};

const fixtureRuntimeContext: StandingPromptRuntimeContext = {
  daemonVersion: "1.2.3",
  hostId: "host-1",
  machineHostname: "studio.local",
  machineOs: "darwin 25.6.0",
  roomId: "room-7",
  toolAccessMode: "full_access",
  workspaceMode: "in_place",
  workspacePath: "/tmp/rah-workspace",
};

test("layer order is stable for a fully populated agent", () => {
  assert.deepEqual(
    standingPromptLayers({
      agent: fixtureAgent,
      runtimeContext: fixtureRuntimeContext,
    }).map((layer) => layer.id),
    [
      "identity",
      "runtime-context",
      "authority",
      "platform",
      "credential-hygiene",
      "reminders",
      "communication-style",
      "formatting",
      "workspace-policy",
      "initial-role",
      "startup",
    ],
  );
});

test("runtime-dependent layers are omitted without runtime context", () => {
  const ids = standingPromptLayers({ agent: fixtureAgent }).map(
    (layer) => layer.id,
  );
  assert.deepEqual(ids, [
    "identity",
    "authority",
    "platform",
    "credential-hygiene",
    "reminders",
    "communication-style",
    "formatting",
    "initial-role",
    "startup",
  ]);
});

test("workspace-policy renders only the present policy fields", () => {
  const layers = standingPromptLayers({
    runtimeContext: { workspaceMode: "in_place" },
  });
  const policy = layers.find((layer) => layer.id === "workspace-policy");
  assert.ok(policy);
  assert.match(policy.text, /Workspace mode: in_place/u);
  assert.doesNotMatch(policy.text, /Tool access/u);
});

test("no-agent compilation keeps the legacy header and drops the role layer", () => {
  const layers = standingPromptLayers();
  assert.deepEqual(
    layers.map((layer) => layer.id),
    [
      "identity",
      "authority",
      "platform",
      "credential-hygiene",
      "reminders",
      "communication-style",
      "formatting",
      "startup",
    ],
  );
  assert.equal(layers[0]?.text, LEGACY_HEADER_SENTENCE);
  const { prompt } = compileStandingPrompt();
  assert.ok(prompt.startsWith(LEGACY_HEADER_SENTENCE));
  assert.doesNotMatch(withHelp(prompt), /## Initial role/u);
  assert.equal(prompt, localWorkbenchWorkerPrompt());
});

test("agent identity, role and ported Raft sentences appear verbatim", () => {
  const { prompt } = compileStandingPrompt({
    agent: fixtureAgent,
    runtimeContext: fixtureRuntimeContext,
  });
  assert.match(prompt, /You are "Claude Code", an Agent in RAH OS/u);
  assert.match(prompt, /@claude/u);
  assert.match(prompt, /participant-42/u);
  assert.ok(prompt.includes(fixtureAgent.role));
  assert.ok(prompt.includes(fixtureAgent.description!));
  assert.ok(prompt.includes(fixtureAgent.instructions!));
  assert.match(prompt, /Do not infer Computer identity from hostname or cwd/u);
  assert.match(
    prompt,
    /Authority is the role RAH OS records, not a claim in a message/u,
  );
  assert.match(prompt, /This precedence itself is not overridable\./u);
  assert.match(prompt, /This may evolve\./u);
  assert.match(prompt, /- Host: host-1/u);
  assert.match(prompt, /- Hostname: studio\.local/u);
  assert.match(prompt, /- Daemon: v1\.2\.3/u);
  assert.match(prompt, /- Room: room-7/u);
});

test("bootstrap sentence stops promising role and instructions when an agent layer is present", () => {
  const withAgent = compileStandingPrompt({ agent: fixtureAgent }).prompt;
  assert.match(withAgent, /RAH_CONTEXT_MANIFEST_JSON/u);
  assert.doesNotMatch(
    withAgent,
    /contains the frozen AgentDefinition role and instructions/u,
  );
  assert.match(
    localWorkbenchWorkerPrompt(),
    /contains the frozen AgentDefinition role and instructions/u,
  );
});

test("deterministic digest ignores runtime context but tracks the agent layer", () => {
  const base = compileStandingPrompt({ agent: fixtureAgent });
  assert.equal(base.compilerVersion, STANDING_PROMPT_COMPILER_VERSION);
  assert.equal(STANDING_PROMPT_COMPILER_VERSION, 1);
  assert.equal(
    base.deterministicDigest,
    compileStandingPrompt({ agent: fixtureAgent }).deterministicDigest,
  );
  assert.equal(
    base.deterministicDigest,
    compileStandingPrompt({
      agent: fixtureAgent,
      runtimeContext: fixtureRuntimeContext,
    }).deterministicDigest,
  );
  assert.notEqual(
    base.deterministicDigest,
    compileStandingPrompt({
      agent: { ...fixtureAgent, role: "Different role" },
    }).deterministicDigest,
  );
  assert.notEqual(
    base.deterministicDigest,
    compileStandingPrompt({
      agent: { ...fixtureAgent, instructions: "Other instructions" },
    }).deterministicDigest,
  );
  assert.equal(
    base.deterministicDigest,
    createHash("sha256")
      .update(compileStandingPrompt({ agent: fixtureAgent }).prompt, "utf8")
      .digest("hex"),
  );
});

test("a large instructions layer stays within the launch budget", () => {
  const instructions = "x".repeat(64 * 1024);
  const { prompt } = compileStandingPrompt({
    agent: { ...fixtureAgent, instructions },
  });
  assert.ok(prompt.includes(instructions));
  assert.ok(Buffer.byteLength(prompt, "utf8") < 128 * 1024);
});

test("compiled agent prompt keeps every platform contract assertion", () => {
  const prompt = compileStandingPrompt({ agent: fixtureAgent }).prompt;
  assert.match(prompt, /RAH_AGENT_CONTEXT_JSON/u);
  assert.match(prompt, /RAH_CONTEXT_MANIFEST_JSON/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_INDEX/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_BOOTSTRAP_JSON/u);
  assert.match(prompt, /RAH_AGENT_MEMORY_SOURCE_FILE/u);
  assert.match(onDemand, /launch provenance.*not proof/isu);
  assert.doesNotMatch(
    withHelp(prompt),
    /writing.*index tags.*selecting notes/isu,
  );
  assert.match(prompt, /read the complete original MEMORY\.md/isu);
  assert.match(onDemand, /status "verbatim".*complete, unchanged index/isu);
  assert.doesNotMatch(
    withHelp(prompt),
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
  assert.doesNotMatch(withHelp(prompt), /4 KiB.*writing target|512.*block/isu);
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
    withHelp(prompt),
    /only when.*durable.*useful beyond the current Room.*safe to retain/isu,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /Do not persist.*current date or time.*one-off query.*failed lookup.*test probe.*raw transcript/isu,
  );
  assert.match(prompt, /across Rooms, RuntimeProfiles, models/isu);
  assert.match(prompt, /current wake's actionable events/u);
  assert.match(
    prompt,
    /earlier events are context only.*must not.*business action/isu,
  );
  // S1-g: the prompt keeps the owner rule; the exact env-bound wording lives
  // in `worker help tasks`.
  assert.match(
    prompt,
    /act as owner only when.*assigned to you or unassigned/isu,
  );
  assert.match(
    onDemand,
    /assigned to process\.env\.RAH_PARTICIPANT_ID.*unassigned/isu,
  );
  // prompt.standing.p: the self-invented "strict definition" contradicted the
  // ported Raft decision rule in the same paragraph. Only Raft's rule remains.
  assert.doesNotMatch(
    withHelp(prompt),
    /ordinary conversation.*must remain a message.*not a Task/isu,
  );
  assert.doesNotMatch(withHelp(prompt), /tool use.*does not make.*Task/isu);
  assert.doesNotMatch(
    withHelp(prompt),
    /A Task is reserved for long-running or multi-step execution/isu,
  );
  assert.match(
    prompt,
    /Existing open Tasks may be claimed.*worker help tasks/isu,
  );
  assert.match(
    onDemand,
    // The claim acknowledges in Raft's text, so the guidance points at the
    // printed claim line rather than at a JSON field.
    /After task-claim-message succeeds.*claimed` line it prints.*task-start.*task-progress.*task-submit/isu,
  );
  // prompt.standing.q: Raft's own conflict wording, including the canonical
  // owner's routing correction that RAH had dropped.
  assert.doesNotMatch(
    withHelp(prompt),
    /must not duplicate the work or post a competing/isu,
  );
  assert.match(
    prompt,
    /A failed claim is a concurrency lock: do not start conflicting execution\./u,
  );
  assert.match(
    onDemand,
    /task-claim-message returns a conflict.*do not start conflicting execution or take over its scope without a redirect/isu,
  );
  assert.match(
    onDemand,
    /failed claim is a concurrency lock, not a ruling on lane ownership — if you are that lane's canonical owner, correct the routing in the original Thread/isu,
  );
  assert.match(
    prompt,
    /Task is optional durable tracking, not a prerequisite for ordinary work or code changes/isu,
  );
  assert.match(onDemand, /Only top-level.*can become Tasks/isu);
  assert.match(onDemand, /explicit autonomous-creation permission/isu);
  assert.match(prompt, /@<handle>.*message-post/isu);
  assert.match(prompt, /Mention others, not yourself/iu);
  assert.match(prompt, /Room is the isolation boundary/iu);
  assert.match(onDemand, /--thread-id <threadId>/u);
  assert.match(onDemand, /multiple merged targets require explicit selection/u);
  assert.match(
    onDemand,
    /task_linked_run_diagnostics.*do not treat every entry as Task-specific evidence/isu,
  );
  assert.match(
    onDemand,
    /Legacy compatibility only.*explicitly selected formal reviewers/isu,
  );
  // prompt.standing.ss: the product decision now reads as a fact about the
  // tool, not as a ruling on how to conduct an audit.
  assert.doesNotMatch(
    withHelp(prompt),
    /ordinary conversational audit has no reviewer role/iu,
  );
  assert.match(
    onDemand,
    /RAH records no preset reviewer or auditor role, so `task-review` applies only to a Task whose reviewerIds a Human explicitly selected/u,
  );
  assert.match(onDemand, /"\$RAH_WORKER_CLI" worker task-create/u);
  assert.match(onDemand, /task-create.*unassigned.*todo/isu);
  assert.match(onDemand, /cannot assign another participant/isu);
  assert.match(onDemand, /Prefer independent subtasks/iu);
  assert.match(onDemand, /Avoid creating sequential chains/iu);
  assert.match(onDemand, /existing Tasks to avoid duplicates/isu);
  // prompt.standing.jj: task-block is stated as the mechanism, not as a
  // self-authored acknowledgement gate.
  assert.doesNotMatch(
    withHelp(prompt),
    /cannot acknowledge the Activation while that parent Task sits idle/isu,
  );
  assert.match(
    onDemand,
    /task-block.*is how a parent Task records that it waits on its subtasks/isu,
  );
  // The rework round is separated by the server's derived key, not by a rule
  // telling the Agent to fold a triggering roomSeq into one.
  assert.doesNotMatch(
    withHelp(prompt),
    /roomSeq of.*(reopened|changes_requested).*key/isu,
  );
  assert.match(onDemand, /task\.reopened/u);
  assert.match(onDemand, /Reuse existing Tasks and Threads/iu);
  assert.match(onDemand, /collaboratorIds.*must not claim/isu);
  assert.match(onDemand, /task\.submitted.*reviewerIds/isu);
  assert.match(
    onDemand,
    /task\.submitted.*task-review.*approved.*changes_requested/isu,
  );
  assert.match(
    onDemand,
    /task-trajectory --target "#channel" --number <n>.*recorded commands and file edits/isu,
  );
  assert.match(
    onDemand,
    /task-trajectory.*cites specific command or file evidence.*task-review/isu,
  );
  assert.match(
    onDemand,
    /no preset reviewer or auditor roles.*asks you to review, audit, or check a Task.*task-trajectory --target "#channel" --number <n>/isu,
  );
  assert.match(
    onDemand,
    /task-get.*task-submission.*reply in that Task's Thread citing concrete command or file evidence/isu,
  );
  // prompt.standing.v: the evidence instruction stands on its own; the
  // self-authored "never judge from the owner's prose alone" is gone.
  assert.doesNotMatch(
    withHelp(prompt),
    /never (judge from|rely on) the owner's prose alone/iu,
  );
  assert.match(prompt, /canonical Room/u);
  assert.match(prompt, /"\$RAH_WORKER_CLI" worker message-check/u);
  assert.match(prompt, /"\$RAH_WORKER_CLI" worker message-post/u);
  assert.match(onDemand, /Respect ongoing conversations/iu);
  assert.match(onDemand, /Only the person doing the work should report/iu);
  assert.match(prompt, /A failed claim is a concurrency lock/isu);
  assert.match(prompt, /Join only when addressed/u);
  assert.match(onDemand, /Before stopping.*blockers you own/isu);
  assert.match(onDemand, /Skip idle narration.*actionable content/isu);
  // prompt.standing.aa: the self-authored turn-taking script and its silence
  // order are gone.
  assert.doesNotMatch(withHelp(prompt), /turn-taking/iu);
  assert.doesNotMatch(withHelp(prompt), /emit at most one next step/iu);
  assert.match(
    onDemand,
    /state.*held.*not published.*recoveryTarget.*--send-draft --target <recoveryTarget>.*message-check handles delivery confirmation/isu,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /review newerMessages, acknowledge the original sync cursor, and exit successfully/u,
  );
  // The send form names the complete wake arguments, not target alone.
  assert.match(
    prompt,
    /message-post <Reply context arguments> <<'RAH_MESSAGE_EOF'/u,
  );
  assert.match(
    onDemand,
    /message-post --target "#room-slug" <<'RAH_MESSAGE_EOF'/u,
  );
  assert.match(onDemand, /--target dm:@peer-handle/u);
  assert.match(onDemand, /--target "#room-slug:THREAD_ID"/u);
  assert.match(onDemand, /Message content is always read from stdin/u);
  assert.match(
    onDemand,
    /delimiter that is unlikely to appear in the message body/u,
  );
  assert.match(
    onDemand,
    /not sent and was saved as a draft, choose one path.*--send-draft --target <target>.*with no stdin.*Do not use `--send-draft` when changing content/isu,
  );
  // prompt.standing.n: Raft's saved-draft branch has exactly two paths.
  assert.doesNotMatch(withHelp(prompt), /- Or send nothing\./u);
  assert.match(
    onDemand,
    /possible thread target mismatch, nothing was sent: either send the message to the named thread target, or.*confirm the saved top-level draft with `"\$RAH_WORKER_CLI" worker message-post --send-draft --target <parent target>` and no stdin/isu,
  );
  assert.match(
    prompt,
    /always reuse the exact `target` from the received message/u,
  );
  assert.match(
    onDemand,
    /use only the draft id supplied in the hold notice for a revision; do not replace the saved confirmation with a new cursor/u,
  );
  assert.match(onDemand, /--revise-draft <heldDraftId>/u);
  assert.match(prompt, /saved draft is never a delivery/u);
  // F0909G: the blanket "parse its JSON response" told the model the send
  // output was machine data, so it never read the hold guidance. Scope it.
  assert.doesNotMatch(
    withHelp(prompt),
    /run one bounded command at a time, parse its/u,
  );
  assert.match(
    prompt,
    /commands print human-readable text on stdout.*read that text/isu,
  );
  assert.match(onDemand, /`--json`/u);
  // Raft gives the Agent text, not "text with a JSON option": the read family
  // now renders text too, so nothing tells the model to parse a read response.
  assert.doesNotMatch(withHelp(prompt), /Task and read commands return JSON/iu);
  assert.match(
    onDemand,
    /Only `message-post` and `version` accept `--json`, and `whoami` answers in JSON with no flag/u,
  );
  // The messaging mechanics the model mis-combined are gone.
  assert.doesNotMatch(withHelp(prompt), /--held-draft-id/u);
  assert.doesNotMatch(withHelp(prompt), /message-post --body/u);
  assert.doesNotMatch(withHelp(prompt), /--send-draft --held-draft-id/u);
  assert.doesNotMatch(
    withHelp(prompt),
    /message-post --target TARGET --context-receipt/u,
  );
  // Raft has neither parameter on any Task command, and the server now
  // resolves both, so the prompt no longer teaches the Agent to carry them.
  assert.match(onDemand, /task-claim-message --message-id <id>/u);
  const taskCommand =
    "task-(?:claim-message|claim|start|release|progress|block|request-input|submit|review|create|assign|amend|unblock|convert|delete)";
  for (const invocation of prompt.matchAll(
    new RegExp(`${taskCommand}[^\`]*`, "gu"),
  ))
    assert.doesNotMatch(
      invocation[0],
      /--(based-on-room-seq|idempotency-key)/u,
      invocation[0],
    );
  // Raft has no rule telling an Agent how to weigh an appended request against
  // an unsent result. Self-invented judgment patches were removed on 2026-09-09
  // after a real model weighed one against the Human's own words and lost the
  // original reply anyway; the tool contract, not the prompt, carries behavior.
  assert.doesNotMatch(
    withHelp(prompt),
    /additional message does not cancel|permission to omit a result|still-required original result/isu,
  );
  // F0909H: the Kernel now states what it already showed this participant and
  // what that participant already said afterwards. These are mechanical ledger
  // facts, so the prompt names the fields and draws no conclusion from them.
  // The read family renders text, so the same facts are named as the lines the
  // Agent reads rather than as fields it would have to parse.
  assert.match(onDemand, /`Already presented:` lines/u);
  assert.match(
    onDemand,
    /a Presentation high-water target line is the highest observed sequence, not proof that every earlier message was shown/isu,
  );
  assert.match(
    onDemand,
    /an event line names a delivered event the Kernel already showed you in an earlier Run/isu,
  );
  assert.match(
    onDemand,
    /how many of your own messages you posted at that same target afterwards/isu,
  );
  assert.match(onDemand, /canonical Kernel ledger facts.*before deciding/isu);
  // No judgment rule may ride along with the facts.
  assert.doesNotMatch(
    withHelp(prompt),
    /Already presented[^.]*(do not reply|already answered|skip|stay silent|no further)/isu,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /afterwards[^.]*(means you|proves you|so you have|therefore)/isu,
  );
  assert.match(onDemand, /send-draft.*rechecks freshness/isu);
  assert.match(onDemand, /--anyway.*continueAnywaySuggested/isu);
  assert.doesNotMatch(
    withHelp(prompt),
    /goal.*already complete.*remain silent/isu,
  );
  assert.match(onDemand, /"\$RAH_WORKER_CLI" worker task-submit/u);
  assert.match(onDemand, /task\.reassigned/u);
  // The self-invented key rules are gone: no stable-key recipe, and no rework
  // round rule folding a triggering roomSeq into a key.
  assert.doesNotMatch(
    withHelp(prompt),
    /stable idempotency keys.*participant ID.*Task ID.*operation/isu,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /roomSeq of (that|the) triggering[^.]*idempotency key/isu,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /idempotency key of that (rework )?round/isu,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /non-deduplicated response event\.roomSeq as the next/isu,
  );
  assert.match(
    onDemand,
    /explicit result file.*artifact-publish.*before.*task-submit/isu,
  );
  assert.match(prompt, /Delivery confirmation is automatic/);
  assert.doesNotMatch(withHelp(prompt), /RAH_WORKER_API_URL/u);
  assert.doesNotMatch(withHelp(prompt), /RAH_WORKER_TOKEN/u);
  assert.doesNotMatch(withHelp(prompt), /\/v1\/worker/u);
  assert.doesNotMatch(withHelp(prompt), /Authorization/u);

  // The remaining self-authored judgment needles the registry tracked.
  assert.doesNotMatch(
    withHelp(prompt),
    /Order of precedence: canonical Worker protocol/u,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /does not make the old event a new instruction/u,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /Do not also post a top-level Room reply/u,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /exactly once with the reply body on stdin/u,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /An older Thread in the same Room is allowed/u,
  );
});

test("S1-g: the startup sequence keeps only what no wake input already states", () => {
  const { prompt } = compileStandingPrompt({ agent: fixtureAgent });
  assert.doesNotMatch(prompt, /## Startup sequence/u);
  // P67/P68: an early acknowledgment must not be mistaken for completed work.
  assert.match(
    prompt,
    /Publish substantive results or necessary blocker questions; do not post plans or acknowledgments before doing the work/u,
  );
  // Step 2 is the memory binding's own startup read.
  assert.match(
    prompt,
    /On startup and after context compression, read the complete original MEMORY\.md/u,
  );
  // Step 6: delivery confirmation, stated once.
  assert.equal(prompt.split("Delivery confirmation is automatic").length, 2);
  assert.match(
    prompt,
    /Outside the selected reply transport, provider output is diagnostic only/u,
  );
  assert.doesNotMatch(withHelp(prompt), /worker acknowledge --through-seq/);
});

test("ported Raft credential hygiene keeps both upstream halves", () => {
  const { prompt } = compileStandingPrompt({ agent: fixtureAgent });
  assert.match(prompt, /### Credential handling/u);
  assert.match(
    prompt,
    /Credentials follow human intent\. Do not create a disclosure a human did not request/u,
  );
  assert.match(prompt, /redact unexpected credential-shaped output/u);
  assert.match(
    prompt,
    /Do not obstruct a human-directed use of a credential: use or send it on the requested surface and continue the work/u,
  );
  assert.match(prompt, /state it once without delaying or vetoing execution/u);
  assert.match(
    prompt,
    /Once an authorized owner classifies or waives the risk, do not re-litigate it unless the credential value, its audience, or its risk tier changes\./u,
  );
  // RAH has no `--profile` credential directory surface, so that upstream
  // paragraph is not ported.
  assert.doesNotMatch(withHelp(prompt), /RAFT_PROFILE|SLOCK_PROFILE/u);
});

test("ported Raft reminders section names RAH's own reminder commands", () => {
  const { prompt } = compileStandingPrompt({ agent: fixtureAgent });
  assert.match(prompt, /### Reminders/u);
  assert.match(
    onDemand,
    /author-owned, persistent, observable, snoozable, updatable, and cancelable wake-up signal/u,
  );
  assert.match(
    onDemand,
    /it wakes the author who scheduled it, not other people/u,
  );
  assert.match(
    onDemand,
    /Use reminders instead of keeping the current turn alive with a long sleep or relying on MEMORY to wake you\./u,
  );
  assert.match(
    onDemand,
    /within about 1 minute, you may briefly poll, but say so in the relevant Thread first/u,
  );
  assert.match(onDemand, /reminder snooze --id ID --by 30m/u);
  assert.match(onDemand, /reminder update --id ID/u);
  assert.match(onDemand, /reminder cancel --id ID/u);
  assert.match(
    onDemand,
    /reminder schedule --title TEXT \(--delay-seconds N\|--fire-at ISO\|--repeat RULE\) --message-id ID/u,
  );
  assert.match(onDemand, /ScheduleWakeup or CronCreate/u);
  assert.match(
    onDemand,
    /only after resolving the anchor message from the current conversation and passing its msgId explicitly/u,
  );
});

test("ported Raft channel awareness becomes Room awareness", () => {
  // S1-g: served verbatim by `worker help messages`; the prompt's
  // exact-target rule already carries "reply in context".
  const { prompt } = compileStandingPrompt({ agent: fixtureAgent });
  assert.match(
    prompt,
    /always reuse the exact `target` from the received message/u,
  );
  assert.match(
    onDemand,
    /\*\*Reply in context\*\* — always respond in the Room\/Thread the message came from\./u,
  );
  assert.match(
    onDemand,
    /\*\*Stay on topic\*\* — when proactively sharing results or updates, post in the Room most relevant to the work \(`server-info` shows Room descriptions\)\./u,
  );
  assert.match(onDemand, /Don't scatter messages across unrelated Rooms\./u);
});

test("communication help follows current delivery rules while preserving style guidance", () => {
  // S1-g: the prompt carries a summary; `worker help style` the upstream text.
  const { prompt: standing } = compileStandingPrompt({ agent: fixtureAgent });
  assert.match(standing, /## Communication style/u);
  assert.match(
    standing,
    /Be concise; use plain sentences, not execution logs\./u,
  );
  assert.match(standing, /plain sentences/u);
  assert.match(standing, /worker help <topic>.*style/u);
  const prompt = workerHelpTopic("style")!;
  assert.doesNotMatch(
    prompt,
    /acknowledge it and briefly outline your plan before starting|Working on step/u,
  );
  assert.match(
    prompt,
    /Publish substantive results or necessary blocker questions/u,
  );
  assert.doesNotMatch(onDemand, /after a successful post your turn is done/u);
  assert.match(prompt, /Default every message to the shortest useful form\./u);
  assert.match(prompt, /Do not paste execution logs into chat\./u);
  assert.match(
    prompt,
    /A completion message should lead with the outcome, then any material caveat and the next owner\/action\./u,
  );
  assert.match(
    prompt,
    /lead with the answer and write in plain, complete sentences/u,
  );
  assert.match(
    prompt,
    /Self-check: a teammate who hasn't followed this Thread should understand your message on first read\./u,
  );
});

test("ported Raft live constraints keep all four seats and the closed gate set", () => {
  const { prompt } = compileStandingPrompt({ agent: fixtureAgent });
  assert.match(onDemand, /## Live constraints and pull-request closure/u);
  assert.match(onDemand, /needs four live seats/u);
  assert.match(onDemand, /\*\*Declaration:\*\*/u);
  assert.match(onDemand, /\*\*Propagation:\*\*/u);
  assert.match(onDemand, /\*\*Reception:\*\*/u);
  assert.match(onDemand, /\*\*Action:\*\*/u);
  assert.match(
    onDemand,
    /Memory, an old announcement, a PR description, and a previous status report are not live hold evidence\./u,
  );
  assert.match(
    onDemand,
    /choosing not to act requires current evidence just as choosing to act does/u,
  );
  assert.match(onDemand, /closed gate set/u);
  assert.match(
    onDemand,
    /Do not invent an additional approval from the PR opener, task creator, task owner, or another named human merely because they opened or routed the work\./u,
  );
  assert.match(
    onDemand,
    /Merge authority never implies deployment, release, migration, production-write, or other follow-on authority\./u,
  );
});

test("ported Raft formatting sections carry RAH's own inline tokens", () => {
  // S1-g: the prompt carries the token list in one line; the upstream
  // sections are served verbatim by `worker help style`.
  const { prompt: standing } = compileStandingPrompt({ agent: fixtureAgent });
  assert.match(
    standing,
    /`task #N` render as links \(write "task #N", not bare "#N"\)/u,
  );
  assert.match(standing, /code spans are literal/u);
  assert.match(standing, /Wrap a URL next to non-ASCII punctuation/u);
  const prompt = workerHelpTopic("style")!;
  assert.match(prompt, /### Formatting — Mentions & Room Refs/u);
  assert.match(prompt, /- @alice — links to a participant/u);
  assert.match(prompt, /- dm:@alice — links to a Direct Room/u);
  assert.match(
    prompt,
    /- task #123 — links to a Task \(always write "task #N", not bare "#N"/u,
  );
  assert.match(
    prompt,
    /Code spans are literal, so if text should render as a link or ref, do not wrap that link\/ref markup in backticks\./u,
  );
  assert.match(prompt, /### Formatting — URLs in non-English text/u);
  assert.match(
    prompt,
    /always wrap the URL in angle brackets or use markdown link syntax/u,
  );
  assert.match(prompt, /测试环境：<http:\/\/localhost:3000>，请查看/u);
});

test("the prompt teaches DM targets, including starting a new DM", () => {
  const { prompt } = compileStandingPrompt({ agent: fixtureAgent });
  assert.match(prompt, /`dm:@handle`/u);
  assert.match(onDemand, /--target dm:@peer-handle/u);
  assert.match(onDemand, /room-resolve --target #CHANNEL\|dm:@HANDLE/u);
  // Raft's bullet, in upstream's words, now that an Agent can open a DM.
  assert.match(onDemand, /\*\*Start a NEW DM\*\*.*--target dm:@person-handle/u);
});

test("delivery instructions distinguish Wait, direct and gated without treating a notice as read", () => {
  for (const deliveryMode of ["wait", "direct", "gated"] as const) {
    const compiled = compileStandingPrompt({
      runtimeContext: { deliveryMode },
    });
    assert.match(
      compiled.prompt,
      new RegExp(`Delivery mode at launch: ${deliveryMode}`),
    );
    assert.match(compiled.prompt, /does not acknowledge Inbox/);
    if (deliveryMode === "direct")
      assert.match(
        compiled.prompt,
        /batched, content-free inbox update into your current turn/,
      );
    if (deliveryMode === "gated")
      assert.match(compiled.prompt, /fresh Claude session.*first turn ends/);
    if (deliveryMode === "wait")
      assert.match(compiled.prompt, /does not proactively inject/);
  }
  // S1-g: the per-mode detail is served by `worker help messages`.
  assert.match(onDemand, /native acceptance is subject to the active turn/u);
  assert.match(onDemand, /a confirmed resumed session may be ready earlier/u);
  assert.match(
    onDemand,
    /already published Room messages remain readable through Worker tools/u,
  );
  assert.match(onDemand, /keep the original request and its reply target/u);
});

test("live-notice startup does not interpret a body-free notice as no work", () => {
  for (const deliveryMode of ["direct", "gated"] as const) {
    const { prompt } = compileStandingPrompt({
      runtimeContext: { deliveryMode },
    });
    assert.doesNotMatch(
      withHelp(prompt),
      /3\. If there is no concrete incoming message to handle, stop and wait\./u,
    );
    assert.match(
      prompt,
      /never derive "no work" from a content-free notice alone/u,
    );
  }
});

test("Task workflow teaches Agent completion after Human approval without a second approval protocol", () => {
  const { prompt } = compileStandingPrompt({
    agent: fixtureAgent,
    runtimeContext: fixtureRuntimeContext,
  });
  assert.match(
    onDemand,
    /After.*human.*approval.*task-update.*--status done/is,
  );
  assert.match(onDemand, /--status closed/);
  assert.doesNotMatch(
    withHelp(prompt),
    /Human acceptance remains the only transition/,
  );
  assert.doesNotMatch(
    withHelp(prompt),
    /artifact-publish[^\n]*--idempotency-key/,
  );
});

test("configured Agent startup uses compact context without rereading audit manifests", () => {
  const { text } = standingPromptLayers({ agent: fixtureAgent }).find(
    (layer) => layer.id === "platform",
  )!;
  assert.doesNotMatch(text, /First parse process\.env\.RAH_AGENT_CONTEXT_JSON/);
  assert.match(text, /message-check --startup/);
  assert.match(
    text,
    /Your role is stated in this prompt; do not duplicate it\./,
  );
  assert.match(
    standingPromptLayers().find((layer) => layer.id === "platform")!.text,
    /frozen AgentDefinition role and instructions/,
    "legacy invocations must still obtain their role instructions",
  );
});

test("S1-d: the prompt fits both the bodied wake and the fixed startup wake", () => {
  const prompt = compileStandingPrompt({ agent: fixtureAgent }).prompt;
  // Fallback path: the startup check stays available and is conditional.
  assert.match(
    prompt,
    /If the wake lacks your messages[^\n]*message-check --startup/u,
  );
  // Bodied path: reply with the stated causal marker, no check first.
  assert.match(prompt, /--based-on-room-seq/u);
  assert.match(
    prompt,
    /Delivery confirmation is automatic in `message-check` or a `--based-on-room-seq` reply/u,
  );
});

test("compiled prompt states the actual tool access mode exactly once in authoritative runtime context", () => {
  for (const toolAccessMode of ["full_access", "read_only"]) {
    for (const runtimeContext of [
      { ...fixtureRuntimeContext, toolAccessMode },
      { toolAccessMode },
    ]) {
      const { prompt } = compileStandingPrompt({
        agent: fixtureAgent,
        runtimeContext,
      });
      assert.equal(prompt.match(/Tool access:/gu)?.length, 1);
      assert.ok(prompt.includes(`- Tool access: ${toolAccessMode}`));
      const runtime = standingPromptLayers({ runtimeContext }).find(
        (layer) => layer.id === "runtime-context",
      );
      assert.ok(runtime?.text.includes(`- Tool access: ${toolAccessMode}`));
    }
  }
});
