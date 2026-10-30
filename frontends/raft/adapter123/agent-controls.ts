/** Retain the original read cache. Native lifecycle optimistic presence is not
 * evidence that a Loom Host actually started/stopped an Instance. */
export function observedAgentControls(
  write: (method: string, path: string, input?: unknown) => Promise<unknown>,
  refresh: () => Promise<void>,
  notice: (message: string) => void,
) {
  const execute = async (method: string, path: string, input?: unknown) => {
    try {
      await write(method, path, input);
    } finally {
      await refresh();
    }
  };
  return {
    startAgent: async (id: string) => {
      try {
        await execute("post", `/agents/${id}/start`);
      } catch (e) {
        notice(e instanceof Error ? e.message : String(e));
      }
    },
    stopAgent: (id: string) => execute("post", `/agents/${id}/stop`),
    resetAgent: (id: string, mode: "restart" | "session" | "full") =>
      execute("post", `/agents/${id}/reset`, { mode }),
    deleteAgent: (id: string, workspace = "keep") =>
      execute("delete", `/agents/${id}`, { workspace }),
  };
}
