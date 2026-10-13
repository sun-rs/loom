import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeSessionCopyAdapter } from "../src/native-session-copy.ts";
import { forkCodexSession } from "../src/codex-session-fork.ts";

test("native session copying uses runtime adapters, never CLI display names or a blank-session fallback", () => {
  assert.equal(
    nativeSessionCopyAdapter("opencode-server/v1")?.provider,
    "opencode-server/v1",
  );
  assert.equal(
    nativeSessionCopyAdapter("codex-app-server/v1")?.provider,
    "codex-app-server/v1",
  );
  assert.equal(
    nativeSessionCopyAdapter("claude-stream-json/v1")?.provider,
    "claude-stream-json/v1",
  );
  assert.equal(
    nativeSessionCopyAdapter("pi-print-json/v1")?.provider,
    "pi-print-json/v1",
  );
  assert.equal(
    nativeSessionCopyAdapter("kimi-acp/v1")?.provider,
    "kimi-acp/v1",
  );
  for (const kind of ["codex-exec/v1", "acp/v1", "unknown"])
    assert.equal(nativeSessionCopyAdapter(kind), undefined);
});

test("Codex copy uses only initialize and thread/fork, with memory disabled and a distinct identity", async () => {
  const methods: string[] = [];
  const result = await forkCodexSession(
    async (method, params) => {
      methods.push(method);
      if (method === "initialize") return { userAgent: "fixture" };
      assert.equal(method, "thread/fork");
      assert.equal(params.threadId, "source");
      assert.equal(params.cwd, "/fixture");
      assert.equal(
        (params.config as Record<string, unknown>)["features.memories"],
        false,
      );
      assert.equal(params.persistExtendedHistory, true);
      return { thread: { id: "child" } };
    },
    () => methods.push("initialized"),
    { sourceId: "source", cwd: "/fixture" },
  );
  assert.equal(result, "child");
  assert.deepEqual(methods, ["initialize", "initialized", "thread/fork"]);
  for (const result of [
    {},
    { thread: { id: "source" } },
    { thread: { id: "" } },
  ])
    await assert.rejects(
      () =>
        forkCodexSession(
          async (method) =>
            method === "initialize" ? { userAgent: "fixture" } : result,
          () => {},
          { sourceId: "source", cwd: "/fixture" },
        ),
      /independent/,
    );
});

import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyCodexSession } from "../src/codex-session-fork.ts";

test("Codex copy process closes after success and refuses broken transport or provider errors without leaking details", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-copy-transport-"));
  try {
    const executable = join(root, "fixture-cli.mjs");
    await writeFile(
      executable,
      `#!${process.execPath}
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
if(process.argv.includes('mcp')) { console.log('[]'); process.exit(0); }
appendFileSync(process.env.LOG,JSON.stringify({args:process.argv.slice(2)})+'\\n');
for await(const line of createInterface({input:process.stdin})) {
 const f=JSON.parse(line);appendFileSync(process.env.LOG,JSON.stringify({method:f.method})+'\\n');
 if(f.method==='initialize')console.log(JSON.stringify({id:f.id,result:{userAgent:'fixture'}}));
 if(f.method==='thread/fork') {
   if(process.env.MODE==='exit')process.exit(2);
   console.log(JSON.stringify(process.env.MODE==='error'?{id:f.id,error:{message:'PRIVATE_PROVIDER_DETAIL'}}:{id:f.id,result:{thread:{id:'child'}}}));
 }
}
`,
      { mode: 0o700 },
    );
    for (const mode of ["ok", "exit", "error"]) {
      const log = join(root, mode + ".jsonl");
      const copy = copyCodexSession({
        executable,
        cwd: root,
        sourceId: "source",
        env: { PATH: process.env.PATH, HOME: root, MODE: mode, LOG: log },
      });
      if (mode === "ok") assert.equal(await copy, "child");
      else
        await assert.rejects(copy, (error: Error) => {
          assert.match(
            error.message,
            /Native copy (process exited|request failed)/,
          );
          assert.ok(!error.message.includes("PRIVATE_PROVIDER_DETAIL"));
          return true;
        });
      const frames = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        frames.slice(1).map((x) => x.method),
        ["initialize", "initialized", "thread/fork"],
      );
      assert.ok(frames[0].args.includes("features.memories=false"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
