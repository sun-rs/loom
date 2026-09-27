export const RAH_WORKER_TOOLS_ENV: "RAH_WORKER_TOOLS";
export const OPENCODE_WORKER_TOOLS_MODE: "opencode";
export const LOOM_MCP_SERVER: "loom";
export const WORKER_MCP_ARGUMENT: "__worker-mcp";
export function openCodeWorkerToolCommand(
  env?: Readonly<Record<string, string | undefined>>,
): string[] | undefined;
export function resolveOpenCodeMcpNames(input: {
  executable: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  timeoutMs?: number;
}): Promise<string[]>;
export function openCodeConfigContentWithWorkerTools(
  content: string,
  input: { command: readonly string[]; names: readonly string[] },
): string;
export function verifyOpenCodeWorkerTools(input: {
  requestJson: (path: string) => Promise<unknown>;
  timeoutMs?: number;
  delay?: (ms: number) => Promise<void>;
}): Promise<void>;
export function prepareOpenCodeWorkerTools(input: {
  executable: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
}): Promise<
  | {
      command: string[];
      names: string[];
      configContent: (content: string) => string;
      verify: (
        requestJson: (path: string) => Promise<unknown>,
      ) => Promise<void>;
    }
  | undefined
>;
export function isLoomFinalPostPart(part: unknown): boolean;
