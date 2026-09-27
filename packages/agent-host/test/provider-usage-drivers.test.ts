import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ProviderCostFrameSchema,
  ProviderUsageFrameSchema,
} from "@rah-os/protocol";

// Each native driver runs against a Fake CLI that replays recorded-shape
// Provider payloads; the fd3 channel is read exactly as the Host reads it.
async function runDriver(
  driver: string,
  fakeSource: string,
  extraArgs: readonly string[] = [],
): Promise<{ code: number | null; frames: unknown[]; stderr: string }> {
  const directory = mkdtempSync(join(tmpdir(), "rah-usage-driver-"));
  chmodSync(directory, 0o700);
  try {
    const executable = join(directory, "fake-provider.mjs");
    writeFileSync(executable, fakeSource, { mode: 0o700 });
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL(`../src/${driver}`, import.meta.url)),
        "--executable",
        executable,
        "--tool-access-mode",
        "full_access",
        "--prompt",
        "fixture standing prompt",
        ...extraArgs,
      ],
      { cwd: directory, stdio: ["pipe", "pipe", "pipe", "pipe"] },
    );
    let fd3 = "";
    let stderr = "";
    child.stdio[3]!.on("data", (chunk: Buffer) => {
      fd3 += chunk.toString("utf8");
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const code = await new Promise<number | null>((resolve) =>
      child.once("close", (exitCode) => resolve(exitCode)),
    );
    const frames = fd3
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as unknown);
    return { code, frames, stderr };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function costFrames(frames: readonly unknown[]) {
  return frames
    .filter(
      (frame) =>
        typeof frame === "object" &&
        frame !== null &&
        (frame as { protocol?: unknown }).protocol === "rah-provider-cost/v1",
    )
    .map((frame) => {
      const { observedAt: _observedAt, ...stable } =
        ProviderCostFrameSchema.parse(frame);
      return stable;
    });
}

function usageFrames(frames: readonly unknown[]) {
  return frames
    .filter(
      (frame) =>
        typeof frame === "object" &&
        frame !== null &&
        (frame as { protocol?: unknown }).protocol === "rah-provider-usage/v1",
    )
    .map((frame) => {
      const parsed = ProviderUsageFrameSchema.parse(frame);
      const { observedAt: _observedAt, ...stable } = parsed;
      return stable;
    });
}

const fakeCodex = `#!/usr/bin/env node
if (process.argv[2] === "mcp") { process.stdout.write("[]"); process.exit(0); } // FAKE \`codex mcp list --json\`: no user MCP servers
import { createInterface } from "node:readline";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const threadId = "thread-usage";
const turnId = "turn-usage";
const usage = (last, total) => send({jsonrpc:"2.0",method:"thread/tokenUsage/updated",params:{threadId,turnId,tokenUsage:{last,total,modelContextWindow:258400}}});
const b = (i,c,o,r) => ({inputTokens:i,cachedInputTokens:c,outputTokens:o,reasoningOutputTokens:r,totalTokens:i+o,cacheWriteInputTokens:0});
const rl = createInterface({ input: process.stdin });
rl.on("close", () => process.exit(0));
rl.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{userAgent:"fake-codex/1"}});
  else if (frame.method === "thread/start") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:threadId}}});
  else if (frame.method === "turn/start") {
    send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:turnId,status:"inProgress"}}});
    usage(b(20000,16000,120,40), b(20000,16000,120,40));
    usage(b(20000,16000,120,40), b(20000,16000,120,40));
    send({jsonrpc:"2.0",method:"thread/tokenUsage/updated",params:{threadId:"other-thread",turnId:"other-turn",tokenUsage:{last:b(9,0,1,0),total:b(9,0,1,0)}}});
    usage(b(20300,20000,60,0), b(40300,36000,180,40));
    send({jsonrpc:"2.0",method:"turn/completed",params:{threadId,turn:{id:turnId,status:"completed"}}});
  }
});
`;

test("Codex driver emits one usage frame per native generation", async () => {
  const result = await runDriver("codex-app-server-driver.mjs", fakeCodex);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(usageFrames(result.frames), [
    {
      protocol: "rah-provider-usage/v1",
      provider: "codex-app-server/v1",
      responseId: "turn-usage:20120",
      inputTokens: 20000,
      cachedInputTokens: 16000,
      outputTokens: 120,
      reasoningOutputTokens: 40,
      contextWindow: 258400,
      contextUsedTokens: 20120,
    },
    {
      protocol: "rah-provider-usage/v1",
      provider: "codex-app-server/v1",
      responseId: "turn-usage:40480",
      inputTokens: 20300,
      cachedInputTokens: 20000,
      outputTokens: 60,
      reasoningOutputTokens: 0,
      contextWindow: 258400,
      contextUsedTokens: 20360,
    },
  ]);
  // Usage never masquerades as a trajectory entry.
  assert.equal(
    result.frames.some((frame) => JSON.stringify(frame).includes("tokenUsage")),
    false,
  );
});

const fakeClaude = `#!/usr/bin/env node
import { createInterface } from "node:readline";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const session_id = "claude-usage-session";
const rl = createInterface({ input: process.stdin });
let answered = false;
rl.on("line", (line) => {
  if (answered) return;
  answered = true;
  const input = JSON.parse(line);
  send({type:"system",subtype:"init",session_id});
  send({...input,session_id});
  const stream = (event) => send({type:"stream_event",event,parent_tool_use_id:null,session_id,uuid:"u"});
  stream({type:"message_start",message:{id:"msg_usage_1",model:"claude-sonnet",usage:{input_tokens:6,cache_creation_input_tokens:1200,cache_read_input_tokens:18000,output_tokens:1}}});
  stream({type:"content_block_start",index:0,content_block:{type:"text",text:""}});
  stream({type:"message_delta",delta:{stop_reason:"end_turn"},usage:{output_tokens:42}});
  send({type:"assistant",message:{id:"msg_usage_1",role:"assistant",content:[{type:"text",text:"done"}],usage:{input_tokens:6,output_tokens:1}},session_id});
  stream({type:"message_stop"});
  send({type:"result",subtype:"success",is_error:false,result:"done",session_id,uuid:"result-usage-1",total_cost_usd:0.042,usage:{input_tokens:6,cache_creation_input_tokens:1200,cache_read_input_tokens:18000,output_tokens:42},modelUsage:{"claude-sonnet":{contextWindow:200000}}});
});
rl.on("close", () => process.exit(0));
`;

test("Claude driver emits usage from the streamed message, not the cumulative result", async () => {
  const result = await runDriver("claude-stream-json-driver.mjs", fakeClaude);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(usageFrames(result.frames), [
    {
      protocol: "rah-provider-usage/v1",
      provider: "claude-stream-json/v1",
      responseId: "msg_usage_1",
      inputTokens: 19206,
      cachedInputTokens: 18000,
      outputTokens: 42,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
    },
  ]);
});

// evo §40: the cumulative CLI estimate is copied; a fresh session's first
// result is the whole value, a resumed process's first result is unknown.
test("Claude driver copies result.total_cost_usd as a CLI estimate with session-cumulative semantics", async () => {
  const fresh = await runDriver("claude-stream-json-driver.mjs", fakeClaude);
  assert.equal(fresh.code, 0, fresh.stderr);
  assert.deepEqual(costFrames(fresh.frames), [
    {
      protocol: "rah-provider-cost/v1",
      provider: "claude-stream-json/v1",
      costId: "result-usage-1",
      source: "claude_result_total_cost_usd",
      reportedTotalUsd: 0.042,
      costUsd: 0.042,
    },
  ]);
  const resumed = await runDriver("claude-stream-json-driver.mjs", fakeClaude, [
    "--resume-session",
    "claude-usage-session",
  ]);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.deepEqual(
    costFrames(resumed.frames).map((frame) => [
      frame.reportedTotalUsd,
      frame.costUsd,
    ]),
    [[0.042, null]],
  );
});

const fakeOpenCode = `#!/usr/bin/env node
import { createServer } from "node:http";
const args = process.argv.slice(2);
// User MCP isolation (evo §57/§59): no user MCP server resolved.
if (args[0] === "debug" && args[1] === "config") { process.stdout.write("{}"); process.exit(0); }
if (args[0] !== "serve") process.exit(64);
const port = Number(args[args.indexOf("--port") + 1]);
const streams = new Set();
const sessionID = "ses_usage";
const send = (res,status,body) => { res.writeHead(status,{"content-type":"application/json"}); res.end(JSON.stringify(body)); };
const event = (value) => { for (const stream of streams) stream.write("data: " + JSON.stringify(value) + "\\n\\n"); };
const step = (id, messageID, tokens, cost = 0) => event({type:"message.part.updated",properties:{sessionID,part:{id,messageID,sessionID,type:"step-finish",reason:"stop",cost,tokens}}});
const server = createServer(async (req,res) => {
  const url = new URL(req.url,"http://127.0.0.1");
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = text === "" ? {} : JSON.parse(text);
  if (req.method === "GET" && url.pathname === "/path") return send(res,200,{directory:process.cwd()});
  if (req.method === "GET" && url.pathname === "/mcp") return send(res,200,{});
  if (req.method === "GET" && url.pathname === "/event") {
    res.writeHead(200,{"content-type":"text/event-stream"});
    res.write("data: " + JSON.stringify({type:"server.connected",properties:{}}) + "\\n\\n");
    streams.add(res); req.once("close",()=>streams.delete(res)); return;
  }
  if (req.method === "POST" && url.pathname === "/session") return send(res,200,{id:sessionID});
  if (req.method === "POST" && url.pathname.endsWith("/message")) {
    const user = body.messageID ?? "msg_user";
    event({type:"message.updated",properties:{info:{id:user,sessionID,role:"user"}}});
    step("prt_user_step",user,{total:1,input:1,output:0,reasoning:0,cache:{read:0,write:0}});
    event({type:"message.updated",properties:{info:{id:"msg_a1",parentID:user,sessionID,role:"assistant"}}});
    step("prt_step_1","msg_a1",{total:15300,input:300,output:80,reasoning:20,cache:{read:14000,write:900}},0.0125);
    step("prt_step_1","msg_a1",{total:15300,input:300,output:80,reasoning:20,cache:{read:14000,write:900}},0.0125);
    event({type:"message.updated",properties:{info:{id:"msg_a2",parentID:user,sessionID,role:"assistant"}}});
    step("prt_step_2","msg_a2",{total:15500,input:100,output:30,reasoning:0,cache:{read:15300,write:70}});
    event({type:"session.idle",properties:{sessionID}});
    return send(res,200,{info:{id:"msg_a2",sessionID,role:"assistant",finish:"stop",tokens:{input:100,output:30,reasoning:0,cache:{read:15300,write:70}}},parts:[]});
  }
  if (req.method === "POST" && url.pathname.endsWith("/abort")) return send(res,200,true);
  send(res,404,{});
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
`;

test("OpenCode driver emits one usage frame per assistant step-finish part", async () => {
  const result = await runDriver("opencode-server-driver.mjs", fakeOpenCode);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(usageFrames(result.frames), [
    {
      protocol: "rah-provider-usage/v1",
      provider: "opencode-server/v1",
      responseId: "prt_step_1",
      inputTokens: 15200,
      cachedInputTokens: 14000,
      outputTokens: 100,
      reasoningOutputTokens: 20,
      contextWindow: null,
      contextUsedTokens: null,
    },
    {
      protocol: "rah-provider-usage/v1",
      provider: "opencode-server/v1",
      responseId: "prt_step_2",
      inputTokens: 15470,
      cachedInputTokens: 15300,
      outputTokens: 30,
      reasoningOutputTokens: 0,
      contextWindow: null,
      contextUsedTokens: null,
    },
  ]);
  // evo §40: each step's CLI cost is copied, including OpenCode's 0.
  assert.deepEqual(
    costFrames(result.frames).map((frame) => [
      frame.costId,
      frame.source,
      frame.costUsd,
    ]),
    [
      ["prt_step_1", "opencode_step_finish_cost", 0.0125],
      ["prt_step_2", "opencode_step_finish_cost", 0],
    ],
  );
});
