// Research fixture only. No provider credential or non-loopback model route.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function isolatedEnvironment(root, source = process.env) {
  assert(
    isAbsolute(root) && root.startsWith("/tmp/lh-"),
    "Use a newly created study directory",
  );
  return {
    PATH: source.PATH,
    USER: source.USER ?? "sun",
    SHELL: "/bin/sh",
    TERM: "xterm-256color",
    HOME: root + "/home",
    XDG_CONFIG_HOME: root + "/config",
    XDG_STATE_HOME: root + "/state",
    XDG_CACHE_HOME: root + "/cache",
    PI_CODING_AGENT_DIR: root + "/pi",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    NO_PROXY: "*",
    no_proxy: "*",
    LANG: "en_US.UTF-8",
  };
}
export function assertStudySocket(root, socket) {
  const rel = relative(resolve(root), resolve(socket));
  assert(
    rel &&
      !rel.startsWith("..") &&
      !isAbsolute(rel) &&
      socket.endsWith("/herdr.sock"),
    "Refusing a socket outside this study",
  );
}
export async function createFixture({
  models = ["fixture"],
  readTool = { name: "read", arguments: { path: "probe.txt" } },
} = {}) {
  const marker = randomUUID(),
    requests = [],
    receipts = [],
    errors = [],
    traffic = [];
  const server = createServer(async (req, res) => {
    traffic.push({ method: req.method, url: req.url, at: Date.now() });
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    try {
      let bytes = "";
      for await (const part of req) {
        bytes += part;
        assert(bytes.length < 2 * 1024 * 1024);
      }
      const body = JSON.parse(bytes);
      assert(models.includes(body.model), "Unexpected fixture model");
      requests.push({ at: Date.now(), body });
      const userIndex = body.messages.findLastIndex((x) => x.role === "user");
      const tail = body.messages.slice(userIndex + 1);
      const tool = tail.findLast((x) => x.role === "tool");
      if (tool) {
        assert(
          JSON.stringify(tool.content).includes(marker),
          "No actual file-read receipt",
        );
        receipts.push({
          at: Date.now(),
          tool_call_id: tool.tool_call_id,
          marker,
        });
      }
      const id = "fixture-" + requests.length;
      const slow = JSON.stringify(body.messages[userIndex]).includes("SLOW");
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      const emit = (delta, finish_reason = null) =>
        res.write(
          "data: " +
            JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason }],
            }) +
            "\n\n",
        );
      emit({ role: "assistant" });
      if (tool) {
        emit({ content: "Fixture task " });
        if (slow) await delay(400);
        emit({ content: "completed." });
        emit({}, "stop");
      } else {
        emit({
          tool_calls: [
            {
              index: 0,
              id: "read-" + requests.length,
              type: "function",
              function: {
                name: readTool.name,
                arguments: JSON.stringify(readTool.arguments),
              },
            },
          ],
        });
        emit({}, "tool_calls");
      }
      res.write(
        "data: " +
          JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created: 1,
            model: body.model,
            choices: [],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
            },
          }) +
          "\n\n",
      );
      res.end("data: [DONE]\n\n");
    } catch (e) {
      errors.push(String(e));
      res.writeHead(400).end("Fixture refused");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    origin: "http://127.0.0.1:" + server.address().port,
    marker,
    requests,
    receipts,
    errors,
    traffic,
    paidCalls: 0,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
