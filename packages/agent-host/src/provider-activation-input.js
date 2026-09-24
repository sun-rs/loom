/**
 * Raft's bounded inbox wake, with RAH's finite Activation and read/ACK
 * contract. S1-d: this fixed wake remains the path for every driver without a
 * reliable acceptance signal, and for any Codex turn whose bodied wake could
 * not be prepared.
 */
const RUNTIME_NOTICE_LIMIT = 300;

/**
 * S2-0: the Host's one-line leftover-process cleanup notice for this run. A
 * driver reads it from `RAH_RUNTIME_NOTICE` (a Host fence); the Host passes it
 * explicitly when it composes the input itself (the Codex wake file, the warm
 * turn), so the acceptance digest covers the notice. The Kernel reserves it
 * for one RunAttempt (at-least-once); it is one bounded line, never Room
 * content.
 */
export function withRuntimeNotice(
  text,
  runtimeNotice = process.env.RAH_RUNTIME_NOTICE,
  protocolNotice = process.env.RAH_PROTOCOL_NOTICE,
) {
  return [text, oneLine(runtimeNotice), oneLine(protocolNotice)]
    .filter((line) => line !== "")
    .join("\n");
}

function oneLine(value) {
  return (value ?? "").split("\n")[0].trim().slice(0, RUNTIME_NOTICE_LIMIT);
}

/**
 * P2-3: `RAH_PROTOCOL_NOTICE` is the Host's one line for a resumed native
 * session whose recorded standing protocol is older than the current one
 * (`session-protocol-upgrade.ts`). Like the cleanup notice it is a bounded
 * line, never Room content, and the Host passes it explicitly when it
 * composes the input itself.
 */

/** ` --turn <handle>` on a warm runtime, empty otherwise. */
export function turnArgument(turnHandle) {
  return turnHandle === undefined || turnHandle === ""
    ? ""
    : ` --turn ${turnHandle}`;
}

/**
 * The fallback wake carries no messages, so it names the one first command.
 * What `--startup` returns, and every constant Activation rule, is stated
 * once in the standing prompt rather than repeated in each turn's history.
 */
export function providerActivationInput(
  runtimeNotice = process.env.RAH_RUNTIME_NOTICE,
  turnHandle,
  protocolNotice = process.env.RAH_PROTOCOL_NOTICE,
) {
  return withRuntimeNotice(
    `Run message-check --startup${turnArgument(turnHandle)} first.`,
    runtimeNotice,
    protocolNotice,
  );
}

/** Role instances may never replace a bound native session implicitly. */
export function assertSessionReplacementAllowed() {
  if (process.env.RAH_REQUIRE_SESSION_CONTINUITY === "1") {
    throw new Error(
      "RAH_SESSION_CONTINUITY_REQUIRED: 原生会话无法继续，已停止；未创建替代会话。请检查运行时会话或账号状态。",
    );
  }
}
