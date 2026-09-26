import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

import { providerLaunchPolicy } from "../src/provider-launch-arguments.js";

// Opt-in local probe for global personal-config isolation (2026-09-26).
// It runs the INSTALLED Claude Code / Codex / OpenCode binaries against a
// FAKE model API on 127.0.0.1 with a temporary HOME full of marker files, so
// no real model is called, nothing is paid and no user file is touched. Each
// CLI runs twice: without the Loom policy (the markers must appear, proving
// the probe can see them) and with it (the markers must be gone).
//
//   LOOM_CLI_ISOLATION_PROBE=1 node --test \
//     packages/agent-host/test/provider-global-isolation-probe.test.ts
//
// Skipped by default: it depends on locally installed CLI versions (verified
// with Claude Code 2.1.282, Codex 0.156.1, OpenCode 1.18.32) and OpenCode may
// contact the public npm registry for its provider package.

const ENABLED = process.env.LOOM_CLI_ISOLATION_PROBE === "1";
const installed = (cli: string) =>
  spawnSync("/usr/bin/which", [cli], { encoding: "utf8" }).status === 0;
const skip = (cli: string) =>
  !ENABLED
    ? "set LOOM_CLI_ISOLATION_PROBE=1 to run the local CLI probe"
    : !installed(cli)
      ? `${cli} is not installed`
      : false;

type Captured = { url: string; body: string };

async function fakeServer(
  respond: (
    request: IncomingMessage,
    body: string,
  ) => { status: number; type: string; chunks: string[] },
): Promise<{ port: number; requests: Captured[]; server: Server }> {
  const requests: Captured[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push({ url: request.url ?? "", body });
      const reply = respond(request, body);
      response.writeHead(reply.status, { "content-type": reply.type });
      for (const chunk of reply.chunks) response.write(chunk);
      response.end();
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  return { port: (server.address() as AddressInfo).port, requests, server };
}

function run(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 90_000,
    );
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function write(path: string, content: string, mode?: number) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode !== undefined) chmodSync(path, mode);
}
const skill = (name: string, marker: string) =>
  `---\nname: ${name}\ndescription: ${marker}\n---\nbody\n`;
// A stdio MCP server that records that it was started and lists one tool.
const markerMcp = (startedFile: string) => `
import { appendFileSync } from "node:fs";
import readline from "node:readline";
appendFileSync(${JSON.stringify(startedFile)}, "started\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
  if (m.method === "initialize") reply({ protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "loomprobe", version: "1" } });
  else if (m.method === "tools/list") reply({ tools: [{ name: "marker_tool", description: "LOOM_PROBE_USER_MCP_TOOL", inputSchema: { type: "object", properties: {} } }] });
  else if (m.id !== undefined) reply({});
});
`;
const hookCommand = (file: string) => `/bin/sh -c 'echo fired >> ${file}'`;
const baseEnv = (home: string, directory: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: home,
  TMPDIR: directory,
  TERM: "dumb",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
});

// ----------------------------------------------------------------- Claude

test(
  "Claude probe: the policy drops user CLAUDE.md/rules/skills/commands/agents, settings hooks and user MCP; project CLAUDE.md stays",
  { skip: skip("claude"), timeout: 300_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "loom-iso-claude-"));
    const fake = await fakeServer((request, body) => {
      if (request.url?.includes("count_tokens"))
        return {
          status: 200,
          type: "application/json",
          chunks: ['{"input_tokens":1}'],
        };
      if (request.method !== "POST" || !request.url?.startsWith("/v1/messages"))
        return {
          status: 404,
          type: "application/json",
          chunks: [
            '{"type":"error","error":{"type":"not_found_error","message":"FAKE"}}',
          ],
        };
      const model = (JSON.parse(body || "{}") as { model?: string }).model;
      const event = (type: string, data: object) =>
        `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      return {
        status: 200,
        type: "text/event-stream",
        chunks: [
          event("message_start", {
            message: {
              id: "msg_fake",
              type: "message",
              role: "assistant",
              model,
              content: [],
              stop_reason: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          }),
          event("content_block_start", {
            index: 0,
            content_block: { type: "text", text: "" },
          }),
          event("content_block_delta", {
            index: 0,
            delta: { type: "text_delta", text: "FAKE-OK" },
          }),
          event("content_block_stop", { index: 0 }),
          event("message_delta", {
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 1 },
          }),
          event("message_stop", {}),
        ],
      };
    });
    try {
      const home = join(directory, "home");
      const project = join(directory, "project");
      const hookFile = join(directory, "hook-fired.log");
      const mcpFile = join(directory, "mcp-started.log");
      write(join(home, ".claude", "CLAUDE.md"), "LOOM_PROBE_USER_CLAUDEMD\n");
      write(join(home, ".claude", "rules", "r.md"), "LOOM_PROBE_USER_RULES\n");
      write(
        join(home, ".claude", "skills", "uskill", "SKILL.md"),
        skill("uskill", "LOOM_PROBE_USER_SKILL"),
      );
      write(
        join(home, ".claude", "commands", "ucmd.md"),
        "---\ndescription: LOOM_PROBE_USER_COMMAND\n---\nbody\n",
      );
      write(
        join(home, ".claude", "agents", "uagent.md"),
        "---\nname: uagent\ndescription: LOOM_PROBE_USER_AGENT\n---\nbody\n",
      );
      const hook = [
        { hooks: [{ type: "command", command: hookCommand(hookFile) }] },
      ];
      write(
        join(home, ".claude", "settings.json"),
        JSON.stringify({
          env: { LOOM_PROBE_SETTINGS_ENV: "1" },
          hooks: { SessionStart: hook, UserPromptSubmit: hook },
        }),
      );
      write(join(directory, "mcp.mjs"), markerMcp(mcpFile));
      // With CLAUDE_CONFIG_DIR set, the global config file lives inside it.
      write(
        join(home, ".claude", ".claude.json"),
        JSON.stringify({
          hasCompletedOnboarding: true,
          mcpServers: {
            loomprobe: {
              command: process.execPath,
              args: [join(directory, "mcp.mjs")],
            },
          },
        }),
      );
      write(join(project, "CLAUDE.md"), "LOOM_PROBE_PROJECT_CLAUDEMD\n");
      write(
        join(project, ".claude", "skills", "pskill", "SKILL.md"),
        skill("pskill", "LOOM_PROBE_PROJECT_SKILL"),
      );
      const env = (extra: Record<string, string>) => ({
        ...baseEnv(home, directory),
        // Probe only: a relocated config dir keeps the Human's keychain login
        // out of reach. The product never sets it.
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${fake.port}`,
        ANTHROPIC_API_KEY: "sk-ant-FAKE-loom-probe",
        DISABLE_TELEMETRY: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1",
        ...extra,
      });
      const mainRequest = () =>
        fake.requests
          .filter(
            (r) =>
              r.url.startsWith("/v1/messages") &&
              !r.url.includes("count_tokens"),
          )
          .sort((a, b) => b.body.length - a.body.length)[0]?.body ?? "";
      const once = async (args: string[], extra: Record<string, string>) => {
        fake.requests.length = 0;
        rmSync(hookFile, { force: true });
        rmSync(mcpFile, { force: true });
        const result = await run(
          "claude",
          [
            "-p",
            "hi",
            "--output-format",
            "json",
            "--no-session-persistence",
            ...args,
          ],
          { cwd: project, env: env(extra) },
        );
        return {
          ...result,
          body: mainRequest(),
          hook: existsSync(hookFile),
          mcp: existsSync(mcpFile),
        };
      };
      const USER_MARKERS = [
        "LOOM_PROBE_USER_CLAUDEMD",
        "LOOM_PROBE_USER_RULES",
        "LOOM_PROBE_USER_SKILL",
        "LOOM_PROBE_USER_COMMAND",
        "LOOM_PROBE_USER_AGENT",
      ];

      const control = await once([], {});
      assert.equal(control.code, 0, control.stderr);
      for (const marker of USER_MARKERS)
        assert.ok(control.body.includes(marker), `control sees ${marker}`);
      assert.equal(control.hook, true, "control runs the user hook");
      assert.equal(control.mcp, true, "control starts the user MCP server");

      const policy = providerLaunchPolicy("claude");
      const isolated = await once(policy.args, policy.environment);
      assert.equal(isolated.code, 0, isolated.stderr);
      assert.match(isolated.stdout, /FAKE-OK/u);
      for (const marker of USER_MARKERS)
        assert.equal(
          isolated.body.includes(marker),
          false,
          `isolated drops ${marker}`,
        );
      assert.equal(isolated.hook, false, "user settings hooks do not run");
      assert.equal(isolated.mcp, false, "user MCP server is not started");
      assert.ok(isolated.body.includes("LOOM_PROBE_PROJECT_CLAUDEMD"));
      assert.ok(isolated.body.includes("LOOM_PROBE_PROJECT_SKILL"));
    } finally {
      fake.server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

// ------------------------------------------------------------------ Codex

type RpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

async function codexAppServer(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  const child = spawn("codex", ["app-server", ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  let nextId = 0;
  const pending = new Map<number, (message: RpcMessage) => void>();
  let onCompleted: (() => void) | undefined;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (
      message.id !== undefined &&
      pending.has(message.id) &&
      !message.method
    ) {
      pending.get(message.id)!(message);
      pending.delete(message.id);
    } else if (message.id !== undefined && message.method) {
      child.stdin.write(
        JSON.stringify({ id: message.id, result: { decision: "decline" } }) +
          "\n",
      );
    } else if (message.method === "turn/completed") onCompleted?.();
  });
  const request = (method: string, params: unknown) =>
    new Promise<RpcMessage>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out: ${stderr.slice(-2000)}`)),
        60_000,
      );
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  await request("initialize", {
    capabilities: { experimentalApi: true },
    clientInfo: { name: "loom-probe", title: "loom-probe", version: "1.0.0" },
  });
  child.stdin.write(
    JSON.stringify({ method: "initialized", params: {} }) + "\n",
  );
  const config = await request("config/read", {
    includeLayers: false,
    cwd: options.cwd,
  });
  const hooks = await request("hooks/list", { cwds: [options.cwd] });
  const thread = await request("thread/start", {
    approvalPolicy: "never",
    cwd: options.cwd,
    sandbox: "danger-full-access",
  });
  const threadId = (thread.result as { thread?: { id?: string } } | undefined)
    ?.thread?.id;
  assert.ok(threadId, `thread/start failed: ${JSON.stringify(thread.error)}`);
  const completed = new Promise<void>((resolve) => (onCompleted = resolve));
  await request("turn/start", {
    threadId,
    input: [{ type: "text", text: "hello" }],
  });
  await Promise.race([
    completed,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`turn timed out: ${stderr}`)), 60_000),
    ),
  ]);
  // notify runs after the turn ends.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  child.kill("SIGTERM");
  return { config: config.result, hooks: hooks.result, stderr };
}

test(
  "Codex probe: notify, user/agents skills, user MCP, hooks and native web search are off; only the global AGENTS.md remains (known limitation)",
  { skip: skip("codex"), timeout: 300_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "loom-iso-codex-"));
    const fake = await fakeServer((request) => {
      if (request.method !== "POST")
        return {
          status: 200,
          type: "application/json",
          chunks: ['{"models":[],"data":[]}'],
        };
      const event = (type: string, data: object) =>
        `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      return {
        status: 200,
        type: "text/event-stream",
        chunks: [
          event("response.created", { response: { id: "r1" } }),
          event("response.output_item.done", {
            output_index: 0,
            item: {
              type: "message",
              role: "assistant",
              id: "m1",
              content: [{ type: "output_text", text: "FAKE_REPLY" }],
            },
          }),
          event("response.completed", {
            response: {
              id: "r1",
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                total_tokens: 2,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
              },
            },
          }),
        ],
      };
    });
    try {
      const home = join(directory, "home");
      const codexHome = join(directory, "codex-home");
      const project = join(directory, "project");
      const notifyFile = join(directory, "notify.log");
      const mcpFile = join(directory, "mcp-started.log");
      const hookFile = join(directory, "hook-fired.log");
      write(
        join(directory, "notify.sh"),
        `#!/bin/sh\necho "$@" >> ${notifyFile}\n`,
        0o755,
      );
      write(join(directory, "mcp.mjs"), markerMcp(mcpFile));
      write(
        join(codexHome, "config.toml"),
        `notify = [${JSON.stringify(join(directory, "notify.sh"))}, "turn-ended"]
web_search = "live"
model = "gpt-5.5"
model_provider = "fake"

[model_providers.fake]
name = "fake"
base_url = "http://127.0.0.1:${fake.port}/v1"
wire_api = "responses"
env_key = "FAKE_KEY"

[mcp_servers.loomprobe]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(join(directory, "mcp.mjs"))}]
`,
      );
      const hook = [
        { hooks: [{ type: "command", command: hookCommand(hookFile) }] },
      ];
      write(
        join(codexHome, "hooks.json"),
        JSON.stringify({
          hooks: { SessionStart: hook, UserPromptSubmit: hook },
        }),
      );
      write(join(codexHome, "AGENTS.md"), "LOOM_PROBE_CODEX_GLOBAL_AGENTS\n");
      write(
        join(codexHome, "skills", "uskill", "SKILL.md"),
        skill("uskill", "LOOM_PROBE_CODEX_USER_SKILL"),
      );
      write(
        join(home, ".agents", "skills", "askill", "SKILL.md"),
        skill("askill", "LOOM_PROBE_CODEX_AGENTS_SKILL"),
      );
      write(join(project, "AGENTS.md"), "LOOM_PROBE_CODEX_PROJECT_AGENTS\n");
      spawnSync("git", ["init", "-q", project]);
      const env = {
        ...baseEnv(home, directory),
        CODEX_HOME: codexHome,
        FAKE_KEY: "FAKE-loom-probe",
      };
      const turnRequest = () =>
        fake.requests
          .filter((r) => r.url.includes("/responses"))
          .sort((a, b) => b.body.length - a.body.length)[0]?.body ?? "";
      const once = async (args: string[]) => {
        fake.requests.length = 0;
        for (const file of [notifyFile, mcpFile, hookFile])
          rmSync(file, { force: true });
        const result = await codexAppServer(args, { cwd: project, env });
        return {
          ...result,
          body: turnRequest(),
          notify: existsSync(notifyFile),
          mcp: existsSync(mcpFile),
          hook: existsSync(hookFile),
        };
      };
      const webSearch = (body: string) =>
        (
          JSON.parse(body) as {
            tools?: { type?: string; external_web_access?: boolean }[];
          }
        ).tools?.find((tool) => tool.type === "web_search");

      const control = await once([]);
      assert.ok(control.body.includes("LOOM_PROBE_CODEX_USER_SKILL"));
      assert.ok(control.body.includes("LOOM_PROBE_CODEX_AGENTS_SKILL"));
      assert.equal(
        control.notify,
        true,
        "control runs the user notify program",
      );
      assert.equal(control.mcp, true, "control starts the user MCP server");
      assert.equal(webSearch(control.body)?.external_web_access, true);
      const listedHooks = (result: { hooks: unknown }) =>
        (result.hooks as { data: { hooks: unknown[] }[] }).data.flatMap(
          (entry) => entry.hooks,
        );
      assert.ok(
        listedHooks(control).length > 0,
        "control lists the user hooks",
      );

      const policy = providerLaunchPolicy("codex", env);
      assert.ok(policy.args.includes("mcp_servers.loomprobe.enabled=false"));
      const isolated = await once(policy.args);
      assert.equal(isolated.notify, false, "notify never runs");
      assert.equal(isolated.mcp, false, "user MCP server is not started");
      assert.equal(isolated.hook, false, "user hooks do not run");
      for (const marker of [
        "LOOM_PROBE_CODEX_USER_SKILL",
        "LOOM_PROBE_CODEX_AGENTS_SKILL",
      ])
        assert.equal(isolated.body.includes(marker), false, marker);
      const effective = (isolated.config as { config: Record<string, any> })
        .config;
      assert.equal(webSearch(isolated.body), undefined, "no web search tool");
      assert.deepEqual(effective.notify, []);
      assert.equal(effective.web_search, "disabled");
      assert.equal(effective.features.plugins, false);
      assert.equal(effective.features.apps, false);
      assert.equal(effective.features.hooks, false);
      assert.equal(effective.skills.include_instructions, false);
      assert.equal(effective.mcp_servers.loomprobe.enabled, false);
      assert.deepEqual(listedHooks(isolated), []);
      // Known limitation: no process switch removes $CODEX_HOME/AGENTS.md.
      assert.ok(isolated.body.includes("LOOM_PROBE_CODEX_GLOBAL_AGENTS"));
      assert.ok(isolated.body.includes("LOOM_PROBE_CODEX_PROJECT_AGENTS"));
    } finally {
      fake.server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

// --------------------------------------------------------------- OpenCode

test(
  "OpenCode probe: ~/.claude/CLAUDE.md, ~/.claude/skills and ~/.agents/skills stay out of the system prompt",
  { skip: skip("opencode"), timeout: 300_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "loom-iso-opencode-"));
    const fake = await fakeServer((request) => {
      if (request.method !== "POST")
        return {
          status: 200,
          type: "application/json",
          chunks: ['{"data":[{"id":"fake-model","object":"model"}]}'],
        };
      const base = {
        id: "x",
        object: "chat.completion.chunk",
        created: 1,
        model: "fake-model",
      };
      const data = (value: object) => `data: ${JSON.stringify(value)}\n\n`;
      return {
        status: 200,
        type: "text/event-stream",
        chunks: [
          data({
            ...base,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "FAKE_REPLY" },
                finish_reason: null,
              },
            ],
          }),
          data({
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          "data: [DONE]\n\n",
        ],
      };
    });
    try {
      const home = join(directory, "home");
      const project = join(directory, "project");
      mkdirSync(project, { recursive: true });
      write(
        join(home, ".config", "opencode", "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: "fakeprov/fake-model",
          provider: {
            fakeprov: {
              npm: "@ai-sdk/openai-compatible",
              name: "FAKE",
              options: {
                baseURL: `http://127.0.0.1:${fake.port}/v1`,
                apiKey: "FAKE-loom-probe",
              },
              models: { "fake-model": { name: "FAKE model" } },
            },
          },
        }),
      );
      write(
        join(home, ".claude", "CLAUDE.md"),
        "LOOM_PROBE_OC_USER_CLAUDEMD\n",
      );
      write(
        join(home, ".claude", "skills", "uskill", "SKILL.md"),
        skill("uskill", "LOOM_PROBE_OC_CLAUDE_SKILL"),
      );
      write(
        join(home, ".agents", "skills", "askill", "SKILL.md"),
        skill("askill", "LOOM_PROBE_OC_AGENTS_SKILL"),
      );
      const MARKERS = [
        "LOOM_PROBE_OC_USER_CLAUDEMD",
        "LOOM_PROBE_OC_CLAUDE_SKILL",
        "LOOM_PROBE_OC_AGENTS_SKILL",
      ];
      const once = async (extra: Record<string, string>) => {
        fake.requests.length = 0;
        const result = await run(
          "opencode",
          ["run", "--pure", "-m", "fakeprov/fake-model", "hi"],
          {
            cwd: project,
            env: {
              ...baseEnv(home, directory),
              OPENCODE_DISABLE_AUTOUPDATE: "1",
              OPENCODE_DISABLE_MODELS_FETCH: "1",
              OPENCODE_DISABLE_SHARE: "1",
              ...extra,
            },
          },
        );
        const body =
          fake.requests
            .filter((r) => r.url.includes("/chat/completions"))
            .sort((a, b) => b.body.length - a.body.length)[0]?.body ?? "";
        return { ...result, body };
      };
      const control = await once({});
      assert.equal(control.code, 0, control.stderr);
      for (const marker of MARKERS)
        assert.ok(control.body.includes(marker), `control sees ${marker}`);
      const isolated = await once(providerLaunchPolicy("opencode").environment);
      assert.equal(isolated.code, 0, isolated.stderr);
      assert.match(isolated.stdout, /FAKE_REPLY/u);
      assert.ok(isolated.body.length > 0, "the turn reached the FAKE API");
      for (const marker of MARKERS)
        assert.equal(isolated.body.includes(marker), false, marker);
    } finally {
      fake.server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
