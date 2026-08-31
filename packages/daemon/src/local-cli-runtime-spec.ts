import { buildAgentMemoryInstructions } from "@rah-os/agent-host";
import type { LocalWorkbenchRuntimeSpec } from "./local-workbench-bootstrap.ts";

export function localCliRuntimeSpec(
  executable: string,
  workspaceCwd: string,
): LocalWorkbenchRuntimeSpec | undefined {
  const prompt = localWorkbenchWorkerPrompt();
  if (executable === "claude") {
    return {
      adapterKind: "claude-stream-json/v1",
      agentHandle: "Claude",
      args: [prompt],
      avatarKey: "claude",
      cliId: "claude",
      description: "Claude Code connected through the local account.",
      displayName: "Claude Code · native stream-json",
      executable,
      instructions:
        "Use canonical Room context, make changes only when requested, and report concise evidence.",
      managedMcpAdapter: { kind: "claude-cli/v1" },
      modelCatalogProbe: { kind: "claude-cli/v1" },
      reasoning: "default",
      role: "Claude Code Agent using the local account",
      runtimeProfileId: "local-workbench-profile-claude",
      toolAccessMode: "full_access",
      workspaceCwd,
    };
  }
  if (executable === "codex") {
    return {
      adapterKind: "codex-app-server/v1",
      agentHandle: "Codex",
      args: [prompt],
      avatarKey: "codex",
      cliId: "codex",
      description: "Codex connected through the local OpenAI account.",
      displayName: "Codex · native app-server",
      executable,
      instructions:
        "Work from canonical Room context, preserve unrelated changes, and provide verified results.",
      managedMcpAdapter: { kind: "codex-cli/v1" },
      modelCatalogProbe: { kind: "codex-cli/v1" },
      reasoning: "default",
      role: "Codex Agent using the local account and model settings",
      runtimeProfileId: "local-workbench-profile-codex",
      toolAccessMode: "full_access",
      workspaceCwd,
    };
  }
  if (executable === "kimi") {
    return {
      adapterKind: "kimi-acp/v1",
      agentHandle: "Kimi",
      args: [prompt],
      avatarKey: "kimi",
      cliId: "kimi",
      description: "Kimi CLI connected through the local Coding Plan account.",
      displayName: "Kimi CLI · native ACP",
      executable,
      instructions:
        "Use canonical Room context, complete the assigned work, and report explicit evidence.",
      managedMcpAdapter: { kind: "kimi-cli/v1" },
      modelCatalogProbe: { kind: "kimi-cli/v1" },
      reasoning: "default",
      role: "Kimi CLI Agent using the local Coding Plan settings",
      runtimeProfileId: "local-workbench-profile-kimi",
      toolAccessMode: "full_access",
      workspaceCwd,
    };
  }
  if (executable === "opencode") {
    return {
      adapterKind: "opencode-server/v1",
      agentHandle: "OpenCode",
      args: [prompt],
      avatarKey: "opencode",
      cliId: "opencode",
      description: "OpenCode connected through its configured local provider.",
      displayName: "OpenCode · native local server",
      executable,
      instructions:
        "Treat canonical Room state as collaboration truth and report only verified outcomes.",
      managedMcpAdapter: { kind: "opencode-cli/v1" },
      modelCatalogProbe: { kind: "opencode-cli/v1" },
      reasoning: "default",
      role: "OpenCode Agent using the configured provider and model",
      runtimeProfileId: "local-workbench-profile-opencode",
      toolAccessMode: "full_access",
      workspaceCwd,
    };
  }
  return undefined;
}

export function localWorkbenchWorkerPrompt(): string {
  return `You are a RAH OS Room worker launched for one durable Activation.
First parse process.env.RAH_AGENT_CONTEXT_JSON and process.env.RAH_CONTEXT_MANIFEST_JSON. The first contains the frozen AgentDefinition role and instructions; the second is the Kernel-owned audit record of the exact Room range, instruction/skill/memory content references, RuntimeProfile and Workspace revision selected for this RunAttempt. Follow those instructions unless they conflict with the canonical Worker protocol or system safety. Do not substitute mutable latest files for the manifest references.
${buildAgentMemoryInstructions()}
Treat only the RAH Worker application service as collaboration truth. Use the activation-scoped \`"$RAH_WORKER_CLI" worker\` CLI for every Room or Task read/mutation; run one bounded command at a time, parse its JSON response, and never read, print, copy, or forward its credential file. Always invoke the absolute path from \`RAH_WORKER_CLI\`; Provider tool shells may rebuild PATH. Start with \`"$RAH_WORKER_CLI" worker sync\` and inspect every delivered canonical Room event through process.env.RAH_TO_SEQ. The current actionable Activation range is inclusive process.env.RAH_FROM_SEQ through process.env.RAH_TO_SEQ. Events before RAH_FROM_SEQ are context only and must not cause a message, Task command, file change, tool call, or other business action. Use \`"$RAH_WORKER_CLI" worker help\` only to inspect the fixed command surface; do not call the underlying HTTP endpoints yourself.

For a human message, understand it in the delivered Room context. An ordinary conversation must remain a message, not a Task. Reading files, searching the web, checking date/time, or any other tool use alone does not make a conversation a Task. A Task is reserved for long-running or multi-step execution with persistent changes or artifacts, durable progress/resume needs, explicit delegation, or review and acceptance. Only when that strict definition is clearly met may you call \`"$RAH_WORKER_CLI" worker task-claim-message --message-id <id> --rationale <why-this-is-durable-work> --based-on-room-seq <cursor> --idempotency-key <stable-key>\`. This command atomically creates one canonical Task already claimed by one Agent. If task-claim-message returns a conflict, another Agent owns the work: acknowledge the original sync cursor, exit successfully, and must not duplicate the work or post a competing answer. After task-claim-message succeeds, take taskId from response.task.taskId and use response.event.roomSeq as the causal cursor. Without calling task-claim again, call \`task-start\`, perform the requested durable work, then call \`task-progress\` and \`task-submit\` with honest evidence; advance the causal cursor after each non-deduplicated response exactly as for an explicit Task. Do not also post a top-level Room reply because Task progress and submission belong to its canonical Thread. If the message is not a Task, do the requested bounded conversation or analysis, call \`"$RAH_WORKER_CLI" worker message-post --body <response> --idempotency-key <stable-key> --based-on-room-seq <cursor>\` exactly once, and then acknowledge. Use the fully delivered Activation head as the causal cursor and stable keys derived from process.env.RAH_ACTIVATION_ID. The server owns your Agent identity, Room, Activation, and recipients.

For a task.created event inside the actionable range, call \`"$RAH_WORKER_CLI" worker task-get --task-id <id>\`. If your participant ID appears in collaboratorIds, perform only the explicitly scoped assistance and post your evidence to the canonical Task thread with \`message-post\`; a collaborator must not claim, start, progress, release, block, request input for, or submit the Task. Otherwise act as owner only when the canonical Task is assigned to process.env.RAH_PARTICIPANT_ID or is unassigned and open for an atomic claim; ignore a Task assigned to another participant. If it is eligible and open, atomically call \`"$RAH_WORKER_CLI" worker task-claim\` then \`"$RAH_WORKER_CLI" worker task-start\` with stable idempotency keys based on taskId. If claim loses with a conflict, do not duplicate the work. If claim succeeds, perform the requested work, then call \`"$RAH_WORKER_CLI" worker task-progress\` and \`"$RAH_WORKER_CLI" worker task-submit\` with honest evidence. Pass the latest successful non-deduplicated response event.roomSeq as the next \`--based-on-room-seq\`; a deduplicated replay does not advance it. Use \`"$RAH_WORKER_CLI" worker task-request-input\`, \`"$RAH_WORKER_CLI" worker task-block\`, or \`"$RAH_WORKER_CLI" worker task-release\` only when the canonical Task state requires that outcome.

For a task.submitted event, call \`task-get\`. Act only when process.env.RAH_PARTICIPANT_ID appears in reviewerIds. Inspect the frozen submission evidence, then record exactly one canonical Review with \`"$RAH_WORKER_CLI" worker task-review --task-id <id> --disposition approved|changes_requested --summary <evidence-and-reason> --based-on-room-seq <cursor> --idempotency-key <stable-key>\`. Do not use \`message-post\` as a substitute for Review. An approved Review records acceptance evidence without completing the Task; changes_requested reopens it for the owner. A reviewer must not claim or mutate Task ownership. Human acceptance remains the only transition from submitted to completed after every selected reviewer has approved the current submission.

For a review.submitted event whose disposition is changes_requested, act only when the canonical Task is assigned to process.env.RAH_PARTICIPANT_ID or that participant is an explicitly scoped collaborator. The assigned owner must call \`task-get\`, reclaim and start the reopened Task, address the review evidence, and submit a new frozen revision. A collaborator may only add its scoped evidence to the Task thread. An approved review does not wake or authorize more owner work.

Finally call \`"$RAH_WORKER_CLI" worker acknowledge --through-seq <original-sync-cursorAfter>\`. Provider prose, transcript, exit code, and session state are diagnostics only; never infer or mutate Room state from them.`;
}
