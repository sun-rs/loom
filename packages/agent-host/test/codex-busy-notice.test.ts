import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { GenericProcessAdapter } from "../src/generic-process-adapter.ts";

// Real driver + authenticated supervisor + fake app-server; no paid provider.
for (const earlyStarted of [false, true])
  test(`Codex busy notice steers the existing turn (earlyStarted=${earlyStarted}), deduplicates, and keeps rejected notices retryable`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-codex-busy-"));
    const executable = join(directory, "fake.mjs");
    const record = join(directory, "requests.jsonl");
    writeFileSync(executable, fake, { mode: 0o700 });
    const adapter = new GenericProcessAdapter({
      command: process.execPath,
      args: [
        fileURLToPath(
          new URL("../src/codex-app-server-driver.mjs", import.meta.url),
        ),
        "--executable",
        executable,
        "--prompt",
        "original work",
        "--tool-access-mode",
        "full_access",
      ],
      cwd: directory,
      env: { RECORD: record, EARLY_STARTED: String(earlyStarted) },
      nativeBusyInput: true,
      supervisorDirectory: join(directory, "supervisors"),
      terminationGraceMs: 1000,
    });
    const run = await adapter.start(
      {
        activationId: "activation",
        consumerId: "consumer",
        fromSeq: 1,
        toSeq: 1,
        hostId: "host",
        participantId: "agent",
        roomId: "room",
        reason: "mention",
        runAttemptId: "run",
      },
      { async registerPrepared() {} },
    );
    const frames = () =>
      readFileSync(record, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const notice = (text: string, fingerprint = text.padEnd(64, "0")) => ({
      text,
      fingerprint,
    });
    try {
      await until(() => frames().some((f) => f.method === "turn/start"));
      assert.equal(await adapter.notifyBusy(run, notice("append")), true);
      assert.equal(await adapter.notifyBusy(run, notice("append")), true);
      assert.equal(await adapter.notifyBusy(run, notice("reject")), false);
      assert.equal(await adapter.notifyBusy(run, notice("reject")), false);
      const steers = frames().filter((f) => f.method === "turn/steer");
      assert.deepEqual(
        steers.map((f) => f.params.input[0].text),
        ["append", "reject", "reject"],
      );
      for (const frame of steers) {
        assert.equal(frame.params.threadId, "original-thread");
        assert.equal(frame.params.expectedTurnId, "original-turn");
      }
      assert.equal(frames().filter((f) => f.method === "turn/start").length, 1);
      assert.equal(
        await adapter.notifyBusy(run, notice("x".repeat(9000))),
        false,
      );
      await adapter.cancel(run);
      assert.equal(await adapter.notifyBusy(run, notice("after-end")), false);
      assert.equal(frames().filter((f) => f.method === "turn/start").length, 1);
    } finally {
      await adapter.cancel(run);
      rmSync(directory, { force: true, recursive: true });
    }
  });

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    try {
      if (check()) return;
    } catch {
      /* file not written yet */
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("fake app-server did not become ready");
}

const fake = `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = f => process.stdout.write(JSON.stringify(f)+'\\n');
createInterface({input:process.stdin}).on('line', line => {
 const f=JSON.parse(line); appendFileSync(process.env.RECORD, line+'\\n');
 if(f.method==='initialize') send({id:f.id,result:{userAgent:'fake'}});
 if(f.method==='thread/start') send({id:f.id,result:{thread:{id:'original-thread'}}});
 if(f.method==='turn/start') {
  const started={method:'turn/started',params:{threadId:'original-thread',turn:{id:'original-turn',status:'inProgress'}}};
  if(process.env.EARLY_STARTED==='true') send(started);
  send({id:f.id,result:{turn:{id:'original-turn'}}});
  if(process.env.EARLY_STARTED!=='true') send(started);
 }
 if(f.method==='turn/steer') send(f.params.input[0].text==='reject'?{id:f.id,error:{code:-1,message:'not ready'}}:{id:f.id,result:{turnId:'original-turn'}});
 if(f.method==='turn/interrupt') {
  send({id:f.id,result:{}});
  send({method:'turn/completed',params:{threadId:'original-thread',turn:{id:'original-turn',status:'interrupted'}}});
 }
}).on('close',()=>process.exit(0));
`;
