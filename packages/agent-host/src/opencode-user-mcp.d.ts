export function resolveOpenCodeMcpNames(input: {
  executable: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  timeoutMs?: number;
}): Promise<string[]>;
export function openCodeConfigContentWithUserMcpDisabled(
  content: string,
  names: readonly string[],
): string;
export function verifyOpenCodeUserMcpDisabled(input: {
  requestJson: (path: string) => Promise<unknown>;
}): Promise<void>;
export function prepareOpenCodeUserMcpIsolation(input: {
  executable: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
}): Promise<{
  names: string[];
  configContent: (content: string) => string;
  verify: (requestJson: (path: string) => Promise<unknown>) => Promise<void>;
}>;
