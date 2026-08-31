/**
 * Identity-bound unattended approval policy extracted from Raft's runtime
 * strategy. It approves Provider tool access, never product authorization:
 * Room, Workspace, MCP and App authority remain Kernel-owned.
 */
export class CodexUnattendedApprovalPolicy {
  #consumed = new Map();

  decide(frame, activeTurn, cancellationRequested = false) {
    const method = String(frame.method);
    const key = String(frame.id);
    const fingerprint = `${method}\0${JSON.stringify(frame.params ?? null)}`;
    const previous = this.#consumed.get(key);
    if (previous !== undefined) {
      if (previous === fingerprint) return { duplicate: true };
      throw new CodexApprovalPolicyError(
        -32602,
        "approval request reused a consumed JSON-RPC id with different content",
      );
    }
    this.#consumed.set(key, fingerprint);

    const params = record(frame.params);
    if (
      activeTurn.threadId === undefined ||
      activeTurn.turnId === undefined ||
      params.threadId !== activeTurn.threadId ||
      params.turnId !== activeTurn.turnId
    ) {
      throw new CodexApprovalPolicyError(
        -32602,
        "approval request does not belong to the active Codex turn",
      );
    }

    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      return {
        duplicate: false,
        result: { decision: cancellationRequested ? "cancel" : "accept" },
      };
    }
    if (method === "item/permissions/requestApproval") {
      if (cancellationRequested) {
        throw new CodexApprovalPolicyError(-32800, "turn was interrupted");
      }
      return {
        duplicate: false,
        result: {
          permissions: knownPermissions(params.permissions),
          scope: "turn",
        },
      };
    }
    throw new CodexApprovalPolicyError(-32601, `method not found: ${method}`);
  }
}

export class CodexApprovalPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function knownPermissions(value) {
  const requested = record(value);
  const permissions = {};
  if (isRecord(requested.fileSystem)) {
    permissions.fileSystem = structuredClone(requested.fileSystem);
  }
  if (isRecord(requested.network)) {
    permissions.network = structuredClone(requested.network);
  }
  return permissions;
}

function record(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
