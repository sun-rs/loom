export function codexWorkerMcpConfig(
  env: Readonly<Record<string, string | undefined>>,
): { args: string[] } | undefined;
export function verifyCodexWorkerMcpReady(
  request: (
    method: string,
    params: { threadId: string; serverName: string },
  ) => Promise<unknown>,
  threadId: string,
  tool: {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
  },
): Promise<void>;
export function assertCodexWorkerMcpNamespace(
  config: { args: string[] } | undefined,
  userServerNames: readonly string[],
): void;
