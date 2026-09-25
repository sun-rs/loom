export const CLAUDE_DISALLOWED_TOOLS: string;
export function withoutNestedClaudeCode(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
export function isMissingClaudeSessionError(
  message: string | undefined,
): boolean;
export function claudeResultError(frame: unknown): string;
export function claudeResultInputUuids(frame: unknown): string[];
export function settleClaudeControlResponse(
  frame: unknown,
  requests: Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >,
): void;
