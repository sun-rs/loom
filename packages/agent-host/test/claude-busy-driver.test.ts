import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";

for (const { resumed, failFirst } of [
  { resumed: true, failFirst: false },
  { resumed: true, failFirst: true },
  { resumed: false, failFirst: false },
])
  test(
    `Claude driver readiness resumed=${resumed}, preserves early failure=${failFirst}`,
    { timeout: 10000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "rah-claude-busy-"));
      const executable = join(dir, "claude.mjs");
      await writeFile(
        executable,
        `#!/usr/bin/env node
import {createInterface} from 'node:readline';
const rl=createInterface({input:process.stdin});
const emit=x=>process.stdout.write(JSON.stringify({...x,session_id:'session-a'})+'\\n');
let inputs=0;
rl.on('line',line=>{
 const frame=JSON.parse(line);inputs++;
 emit(frame);
 if(inputs===1){
  emit({type:'system',subtype:'init'});
  emit({type:'assistant',message:{content:[{type:'tool_use',id:'tool-1',name:'Bash',input:{}}]}});
  process.stderr.write('READY\\n');
  setTimeout(()=>emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'done'}]}}),500);
  if(!${resumed}) setTimeout(()=>{emit({type:'result',subtype:'success',is_error:false});rl.close();process.stdin.destroy();},600);
 }else{
  if(frame.session_id!=='session-a'||frame.message.content[0].text!=='Check #room')process.exit(7);
  emit({type:'result',subtype:${failFirst ? "'error_during_execution'" : "'success'"},is_error:${failFirst},result:'first turn failed'});
  setTimeout(()=>{emit({type:'result',subtype:'success',is_error:false});rl.close();process.stdin.destroy();},50);
 }
});
rl.on('close',()=>{if(inputs!==${resumed ? 2 : 1})process.exitCode=8;});
`,
        { mode: 0o700 },
      );
      const child = spawn(
        process.execPath,
        [
          "packages/agent-host/src/claude-stream-json-driver.mjs",
          "--executable",
          executable,
          ...(resumed ? ["--resume-session", "session-a"] : []),
          "--prompt",
          "fixture",
          "--tool-access-mode",
          "full_access",
        ],
        { stdio: ["pipe", "pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      let receipt = "";
      let sent = false;
      child.stderr.on("data", (data) => {
        stderr += String(data);
      });
      child.stdio[3]!.on("data", (data) => {
        receipt += String(data);
        if (!sent && receipt.includes("tool_start")) {
          sent = true;
          child.stdin.write(
            JSON.stringify({
              protocol: "rah-runtime-notice/v1",
              id: "busy-1",
              fingerprint: "a".repeat(64),
              text: "Check #room",
            }) + "\n",
          );
        }
      });
      child.stdout.resume();
      const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
      try {
        const [code] = await once(child, "close");
        assert.equal(code, failFirst ? 1 : 0, stderr);
        assert.ok(receipt.includes(`"accepted":${resumed}`), receipt);
        if (!resumed) assert.equal(receipt.includes('"accepted":true'), false);
        assert.equal(receipt.includes("rah-provider-session/v1"), !failFirst);
        if (failFirst) assert.ok(stderr.includes("first turn failed"), stderr);
      } finally {
        clearTimeout(timer);
        child.kill("SIGKILL");
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

for (const scenario of [
  "missing-session-fallback",
  "changed-session",
] as const) {
  test(
    `Claude busy delivery rejects ${scenario}`,
    { timeout: 10000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "rah-claude-busy-fence-"));
      const executable = join(dir, "claude.mjs");
      const fallback = scenario === "missing-session-fallback";
      await writeFile(
        executable,
        `#!/usr/bin/env node
import {createInterface} from 'node:readline';
const rl=createInterface({input:process.stdin});
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
let inputs=0;
rl.on('line', line=>{
  inputs++;
  if (inputs>1) { process.stderr.write('UNEXPECTED_BUSY_WRITE\\n'); process.exit(9); }
  if (${fallback} && process.argv.includes('--resume')) {
    emit({type:'result',subtype:'error_during_execution',is_error:true,result:'No conversation found for session-a'});
    rl.close();process.stdin.destroy();return;
  }
  const frame=JSON.parse(line);
  emit({...frame,session_id:'session-a'});
  emit({type:'assistant',session_id:'session-a',message:{content:[{type:'tool_use',id:'tool-1',name:'Bash',input:{}}]}});
  setTimeout(()=>emit({type:'user',session_id:${fallback ? "'session-a'" : "'wrong-session'"},message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'done'}]}}),400);
  setTimeout(()=>{emit({type:'result',session_id:'session-a',subtype:'success',is_error:false});rl.close();process.stdin.destroy();},650);
});
`,
        { mode: 0o700 },
      );
      const child = spawn(
        process.execPath,
        [
          "packages/agent-host/src/claude-stream-json-driver.mjs",
          "--executable",
          executable,
          "--resume-session",
          "session-a",
          "--prompt",
          "fixture",
          "--tool-access-mode",
          "full_access",
        ],
        { stdio: ["pipe", "pipe", "pipe", "pipe"] },
      );
      let receipt = "";
      let stderr = "";
      let sent = false;
      child.stderr.on("data", (data) => {
        stderr += String(data);
      });
      child.stdio[3]!.on("data", (data) => {
        receipt += String(data);
        if (!sent && receipt.includes("tool_start")) {
          sent = true;
          child.stdin.write(
            JSON.stringify({
              protocol: "rah-runtime-notice/v1",
              id: "busy-fence",
              fingerprint: "b".repeat(64),
              text: "Check #room",
            }) + "\n",
          );
        }
      });
      child.stdout.resume();
      const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
      try {
        const [code] = await once(child, "close");
        assert.equal(sent, true, receipt + stderr);
        assert.equal(code, fallback ? 0 : 1, receipt + stderr);
        assert.ok(receipt.includes('"accepted":false'), receipt);
        assert.ok(!receipt.includes('"accepted":true'), receipt);
        assert.ok(!stderr.includes("UNEXPECTED_BUSY_WRITE"), stderr);
        if (fallback)
          assert.ok(
            receipt.includes("claude:resume:session-not-found"),
            receipt,
          );
        else
          assert.ok(
            stderr.includes("changed Provider session identity"),
            stderr,
          );
      } finally {
        clearTimeout(timer);
        child.kill("SIGKILL");
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
}
