import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyKimiSession } from "../src/kimi-session-fork.ts";

test("Kimi native copy forks without a prompt or source resume, drains EOF before returning, and refuses unsafe outcomes", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-kimi-copy-"));
  try {
    const executable = join(root, "fixture.mjs");
    await writeFile(
      executable,
      `#!${process.execPath}
import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';
const mode=process.env.MODE;const log=x=>appendFileSync(process.env.LOG,JSON.stringify(x)+'\\n');
log({args:process.argv.slice(2),cron:process.env.KIMI_DISABLE_CRON});
for await(const line of createInterface({input:process.stdin})) {
 const f=JSON.parse(line);log(f);
 if(f.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:f.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:mode==='unsupported'?{}:{fork:{}}}}}));
 if(f.method==='session/fork') {
  if(mode==='exit')process.exit(2);
  if(mode==='tool'){console.log(JSON.stringify({jsonrpc:'2.0',id:99,method:'terminal/create',params:{command:'forbidden'}}));continue;}
  console.log(JSON.stringify(mode==='error'?{jsonrpc:'2.0',id:f.id,error:{message:'PRIVATE_PROVIDER_DETAIL'}}:{jsonrpc:'2.0',id:f.id,result:{sessionId:mode==='same'?'source':'child'}}));
  if(mode==='late-tool')console.log(JSON.stringify({jsonrpc:'2.0',id:100,method:'terminal/create',params:{command:'forbidden'}}));
 }
}
log({eof:true});if(mode==='bad-exit')process.exit(2);
`,
      { mode: 0o700 },
    );
    for (const mode of [
      "ok",
      "unsupported",
      "exit",
      "error",
      "same",
      "tool",
      "bad-exit",
      "late-tool",
    ]) {
      const log = join(root, mode + ".jsonl");
      const result = copyKimiSession({
        executable,
        cwd: root,
        sourceId: "source",
        env: {
          PATH: process.env.PATH,
          HOME: root,
          KIMI_CODE_HOME: root,
          MODE: mode,
          LOG: log,
        },
      });
      if (mode === "ok") assert.equal(await result, "child");
      else
        await assert.rejects(result, (error: Error) => {
          assert(!error.message.includes("PRIVATE_PROVIDER_DETAIL"));
          return true;
        });
      const frames = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(frames[0], { args: ["acp"], cron: "1" });
      const methods = frames.filter((x) => x.method);
      assert.deepEqual(
        methods.map((x) => x.method),
        mode === "unsupported"
          ? ["initialize"]
          : ["initialize", "session/fork"],
      );
      if (mode !== "unsupported")
        assert.deepEqual(methods[1].params, {
          sessionId: "source",
          cwd: root,
          mcpServers: [],
        });
      if (mode === "ok") assert.equal(frames.at(-1).eof, true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
