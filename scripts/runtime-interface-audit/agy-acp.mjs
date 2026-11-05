import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { isolatedEnvironment } from "../herdr-runtime-study/fixture.mjs";
import { JsonLinesProcess } from "./stdio.mjs";
assert(process.argv.includes("--run-free"), "Explicit --run-free required");
const root = mkdtempSync("/tmp/lh-rpc-agy-");
for (const dir of ["home", "agy", "gemini", "work"])
  mkdirSync(root + "/" + dir);
const env = isolatedEnvironment(root),
  traffic = [];
const sink = createServer(async (req, res) => {
  let bytes = 0;
  for await (const part of req) bytes += part.length;
  traffic.push({ method: req.method, url: req.url, bytes });
  res.writeHead(401, { "content-type": "application/json" }).end(
    JSON.stringify({
      error: {
        code: 401,
        message: "LOCAL AUDIT SINK: no authentication or model execution",
      },
    }),
  );
});
await new Promise((r) => sink.listen(0, "127.0.0.1", r));
const args = [
  "acp",
  "--stdio",
  "--disable-telemetry",
  "--include-default-customizations=false",
  "--app-data-dir",
  "loom-runtime-audit-agy",
  "--gemini-dir",
  ".gemini",
  "--cloud_code_endpoint",
  "http://127.0.0.1:" + sink.address().port,
  "--log-file",
  root + "/agy.log",
];
const child = new JsonLinesProcess("/Users/sun/.local/bin/agy", args, {
  env,
  cwd: root + "/work",
});
const result = {
  root,
  kind: "native-agy-acp-metadata-only",
  args,
  paidCalls: 0,
  modelPromptsSent: 0,
  startedAt: new Date().toISOString(),
};
try {
  console.log(JSON.stringify({ root, paidCalls: 0 }));
  const init = await child.rpc("initialize", {
    protocolVersion: 1,
    clientInfo: { name: "loom-runtime-audit", version: "1" },
    clientCapabilities: {},
  });
  assert(init.result && !init.error, JSON.stringify(init));
  result.initialize = init.result;
  console.log(JSON.stringify({ check: "initialize", result: init.result }));
  // No account is copied. Creating a session is metadata-only; never send session/prompt.
  const session = await child.rpc(
    "session/new",
    { cwd: root + "/work", mcpServers: [] },
    20000,
  );
  result.newSession = session;
  result.status = session.error
    ? session.error.code === -32000 &&
      /Authentication required/i.test(session.error.message)
      ? "protocol-ready-isolated-auth-required"
      : "protocol-ready-session-create-error"
    : "protocol-and-empty-session-ready-no-generation";
  console.log(JSON.stringify({ check: "session-new", response: session }));
  if (session.result?.sessionId) {
    result.list = await child.rpc("session/list", {});
    result.close = await child.rpc("session/close", {
      sessionId: session.result.sessionId,
    });
  }
} catch (e) {
  result.status = "probe-failed";
  result.error = String(e);
  console.error(String(e));
  process.exitCode = 1;
} finally {
  result.exit = await child.close();
  result.frames = child.frames;
  result.stderr = child.stderr;
  result.traffic = traffic;
  sink.closeAllConnections();
  await new Promise((r) => sink.close(r));
  result.finishedAt = new Date().toISOString();
  writeFileSync(root + "/result.json", JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      root,
      status: result.status,
      error: result.error,
      modelPromptsSent: 0,
    }),
  );
}
