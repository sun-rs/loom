#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
} from "node:fs";
const args = process.argv.slice(2),
  value = (n) => args[args.indexOf(n) + 1];
let wake = "";
for await (const c of process.stdin) wake += c;
const path = value("--session"),
  old = existsSync(path) ? readFileSync(path, "utf8") : "";
const rows = old
  ? old.trim().split("\n").map(JSON.parse)
  : [{ type: "session", id: "pi-session" }];
let parent = rows.at(-1).type === "session" ? null : rows.at(-1).id;
const add = (type, data) => {
  const r = { type, id: "entry-" + rows.length, parentId: parent, ...data };
  rows.push(r);
  parent = r.id;
  return r;
};
if (rows.length === 1) {
  add("model_change", {
    provider: value("--provider"),
    modelId: value("--model"),
  });
  add("thinking_level_change", { thinkingLevel: value("--thinking") });
}
const user = { role: "user", content: [{ type: "text", text: wake }] };
add("message", { message: user });
const compaction = wake.includes("compact");
if (compaction)
  add("compaction", {
    usage: { input: 82296, output: 3108, cacheRead: 0, cacheWrite: 0 },
  });
const message = {
  role: "assistant",
  provider: value("--provider"),
  model: value("--model"),
  thinkingLevel: value("--thinking"),
  responseId: "response-" + rows.length,
  content: [
    { type: "text", text: wake.includes("unicode") ? "完成中文😀" : "done" },
  ],
  usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
  stopReason: wake.includes("failed") ? "error" : "stop",
  rawStopReason: "stop",
};
add("message", { message });
writeFileSync(path, rows.map(JSON.stringify).join("\n") + "\n", {
  mode: 0o600,
});
if (process.env.PI_FAKE_RECORD)
  appendFileSync(
    process.env.PI_FAKE_RECORD,
    JSON.stringify({ args, wake }) + "\n",
  );
for (const f of [
  rows[0],
  { type: "agent_start" },
  { type: "message_end", message: user },
  ...(compaction && !wake.includes("suffix-only")
    ? [
        ...(wake.includes("end-only")
          ? []
          : [{ type: "compaction_start", reason: "threshold" }]),
        ...(wake.includes("start-only")
          ? []
          : [
              {
                type: "compaction_end",
                reason: "threshold",
                aborted: false,
                willRetry: false,
              },
            ]),
      ]
    : []),
  { type: "message_end", message },
  { type: "agent_end", willRetry: false },
  { type: "agent_settled", aborted: false },
]) {
  const encoded = Buffer.from(JSON.stringify(f) + "\n");
  for (let i = 0; i < encoded.length; i += 7) {
    process.stdout.write(encoded.subarray(i, i + 7));
    if (wake.includes("unicode")) await new Promise((r) => setTimeout(r, 1));
  }
  if (
    wake.includes("partial") &&
    f.type === "message_end" &&
    f.message?.role === "assistant"
  ) {
    console.log(
      JSON.stringify({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    );
    process.exit(0);
  }
  if (
    wake.includes("hang") &&
    f.type === "message_end" &&
    f.message?.role === "assistant"
  )
    await new Promise((r) => setTimeout(r, 30000));
}
