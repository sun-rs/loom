/** Native local /mcp readiness, never a model prompt or a Room acknowledgement. */
export class KimiWorkerMcpReady {
  #advertised = new Set();
  #checking;
  #text = "";
  observe(frame) {
    if (frame?.method !== "session/update") return;
    const { sessionId, update } = frame.params ?? {};
    if (
      update?.sessionUpdate === "available_commands_update" &&
      update.availableCommands?.some((c) => c.name === "mcp")
    )
      this.#advertised.add(sessionId);
    if (
      sessionId === this.#checking &&
      update?.sessionUpdate === "agent_message_chunk" &&
      update.content?.type === "text"
    )
      this.#text += update.content.text;
  }
  async wait(sessionId, request) {
    if (!this.#advertised.has(sessionId))
      throw Error(
        "Kimi has not advertised local /mcp command; refusing internal MCP startup",
      );
    this.#checking = sessionId;
    try {
      const deadline = Date.now() + 10000;
      do {
        this.#text = "";
        const result = await request(
          "session/prompt",
          { sessionId, prompt: [{ type: "text", text: "/mcp" }] },
          5000,
        );
        if (result?.stopReason !== "end_turn")
          throw Error("Kimi local MCP status did not finish");
        if (
          this.#text ===
          "MCP servers (1):\n- loom_worker (stdio): connected, 1 tools"
        )
          return;
        if (
          this.#text !==
          "MCP servers (1):\n- loom_worker (stdio): pending, 0 tools"
        )
          throw Error("Kimi internal MCP not connected with exactly one tool");
        await new Promise((r) => setTimeout(r, 100));
      } while (Date.now() < deadline);
      throw Error("Kimi internal MCP readiness timed out");
    } finally {
      this.#checking = undefined;
      this.#text = "";
    }
  }
}
