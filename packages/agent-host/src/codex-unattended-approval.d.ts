export type CodexApprovalFrame = Readonly<{
  id: string | number;
  method: string;
  params?: unknown;
}>;

export type CodexActiveTurn = Readonly<{
  threadId?: string;
  turnId?: string;
}>;

export type CodexApprovalDecision =
  | Readonly<{ duplicate: true }>
  | Readonly<{ duplicate: false; result: unknown }>;

export class CodexUnattendedApprovalPolicy {
  decide(
    frame: CodexApprovalFrame,
    activeTurn: CodexActiveTurn,
    cancellationRequested?: boolean,
  ): CodexApprovalDecision;
}

export class CodexApprovalPolicyError extends Error {
  readonly code: number;
  constructor(code: number, message: string);
}
