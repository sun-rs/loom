import type { LocalWorkbenchRuntimeSpec } from "./local-workbench-bootstrap.ts";

export function localCliRuntimeSpec(
  executable: string,
  workspaceCwd: string,
): LocalWorkbenchRuntimeSpec | undefined {
  const prompt = localWorkbenchWorkerPrompt();
  if (executable === "claude") {
    return {
      agentHandle: "Claude",
      args: [
        "--print",
        "--safe-mode",
        "--no-session-persistence",
        "--dangerously-skip-permissions",
        "--model",
        "claude-sonnet-5",
        "--effort",
        "low",
        prompt,
      ],
      avatarKey: "claude",
      cliId: "claude",
      description: "Claude Code connected through the local account.",
      displayName: "Claude Code · Sonnet 5 / low",
      executable,
      instructions:
        "Use canonical Room context, make changes only when requested, and report concise evidence.",
      reasoning: "default",
      role: "Claude Code Agent using the local account",
      runtimeProfileId: "local-workbench-profile-claude",
      workspaceCwd,
    };
  }
  if (executable === "codex") {
    return {
      agentHandle: "Codex",
      args: [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "danger-full-access",
        "--cd",
        workspaceCwd,
        prompt,
      ],
      avatarKey: "codex",
      cliId: "codex",
      description: "Codex connected through the local OpenAI account.",
      displayName: "Codex · local account default",
      executable,
      instructions:
        "Work from canonical Room context, preserve unrelated changes, and provide verified results.",
      modelCatalogProbe: { kind: "codex-cli/v1" },
      reasoning: "default",
      role: "Codex Agent using the local account and model settings",
      runtimeProfileId: "local-workbench-profile-codex",
      workspaceCwd,
    };
  }
  if (executable === "kimi") {
    return {
      agentHandle: "Kimi",
      args: ["--output-format", "text", "--prompt", prompt],
      avatarKey: "kimi",
      cliId: "kimi",
      description: "Kimi CLI connected through the local Coding Plan account.",
      displayName: "Kimi CLI · local account default",
      executable,
      instructions:
        "Use canonical Room context, complete the assigned work, and report explicit evidence.",
      modelCatalogProbe: { kind: "kimi-cli/v1" },
      reasoning: "default",
      role: "Kimi CLI Agent using the local Coding Plan settings",
      runtimeProfileId: "local-workbench-profile-kimi",
      workspaceCwd,
    };
  }
  if (executable === "opencode") {
    return {
      agentHandle: "OpenCode",
      args: ["run", "--auto", "--pure", "--dir", workspaceCwd, prompt],
      avatarKey: "opencode",
      cliId: "opencode",
      description: "OpenCode connected through its configured local provider.",
      displayName: "OpenCode · configured provider/model",
      executable,
      instructions:
        "Treat canonical Room state as collaboration truth and report only verified outcomes.",
      modelCatalogProbe: { kind: "opencode-cli/v1" },
      reasoning: "default",
      role: "OpenCode Agent using the configured provider and model",
      runtimeProfileId: "local-workbench-profile-opencode",
      workspaceCwd,
    };
  }
  return undefined;
}

export function localWorkbenchWorkerPrompt(): string {
  return `You are a RAH OS Room worker launched for one durable Activation.
First parse process.env.RAH_AGENT_CONTEXT_JSON. Its frozen agentDefinitionRevision role, instructions, instructionRefs, skillRefs, and memoryPolicyRef define this Agent for the current RunAttempt. Follow those instructions unless they conflict with the canonical Worker protocol or system safety.
Treat only the RAH Worker API as collaboration truth. Never expose its bearer token.
First use a local shell command with Node.js built-in fetch to POST {} to process.env.RAH_WORKER_API_URL + "/v1/worker/sync" with Authorization "Bearer " + process.env.RAH_WORKER_TOKEN and Content-Type application/json. Parse and inspect every delivered canonical Room event through process.env.RAH_TO_SEQ.

For a human message, understand it in the delivered Room context, do the requested coding or analysis work in the current workspace when appropriate, then POST one concise useful response to "/v1/worker/messages/post" using {body,idempotencyKey:"reply:"+process.env.RAH_ACTIVATION_ID,basedOnRoomSeq}. The server owns your Agent identity, Room, Activation, and recipients.

For a task.created event, query "/v1/worker/tasks/get" with {taskId}. If it is open, atomically call claim then start with unique stable idempotency keys based on taskId. If claim loses with a conflict, do not duplicate the work. If claim succeeds, perform the requested work, then call progress and submit with honest evidence. Use each returned event.roomSeq as the next basedOnRoomSeq.

Finally POST {throughSeq: the original sync cursorAfter} to "/v1/worker/acknowledge". CLI prose, transcript, exit code, and provider session are diagnostics only; never infer or mutate Room state from them.`;
}
