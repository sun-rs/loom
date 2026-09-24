export const CLAUDE_DISALLOWED_TOOLS: string;
export function withoutNestedClaudeCode(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
export function isMissingClaudeSessionError(
  message: string | undefined,
): boolean;
