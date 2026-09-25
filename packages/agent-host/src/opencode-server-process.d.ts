export interface OpenCodeServerExit {
  code: number | null;
  signal: string | null;
}
export function stopOpenCodeServer(
  handle: {
    child: {
      exitCode: number | null;
      signalCode: string | null;
      kill(signal: NodeJS.Signals): boolean;
    };
    exited: Promise<OpenCodeServerExit>;
  },
  options: { termTimeoutMs: number },
): Promise<OpenCodeServerExit>;
