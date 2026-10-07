import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverMultiNativeUsage } from "./multi-native-recovery.mjs";
import { nativeClaudeRound } from "./native-claude.mjs";
import { nativeKimiRound } from "./native-kimi.mjs";
import { nativeOpenCodeRound } from "./native-opencode.mjs";
const fixture = String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');const provider=path.basename(process.argv[1]),args=process.argv.slice(2),t=Date.now(),at=new Date(t).toISOString(),id='test-session',answer='short';
if(args[0]==='--version'){console.log({claude:'2.1.287 (Claude Code)',kimi:'0.39.1',opencode:'1.18.32'}[provider]);process.exit(0)}
if(args[0]==='debug'){console.log('{}');process.exit(0)}
const emit=x=>console.log(JSON.stringify(x));
if(provider==='claude'){
 const dir=path.join(process.env.CLAUDE_CONFIG_DIR,'projects','fixture');fs.mkdirSync(dir,{recursive:true});
 const m={id:'msg-'+t,model:'claude-haiku-test',content:[{type:'text',text:answer}],usage:{input_tokens:10,output_tokens:2}};
 fs.appendFileSync(path.join(dir,id+'.jsonl'),JSON.stringify({type:'assistant',timestamp:at,cwd:process.cwd(),message:m})+'\n');
 for(const event of [{type:'message_start',message:{id:m.id,usage:{input_tokens:10,output_tokens:0}}},{type:'message_delta',usage:{output_tokens:2}},{type:'message_stop'}])emit({type:'stream_event',session_id:id,event});
 emit({type:'assistant',session_id:id,message:m});emit({type:'result',session_id:id,subtype:'success',is_error:false,result:answer});
}else if(provider==='kimi'){
 const dir=path.join(process.env.KIMI_CODE_HOME,'sessions','workspace','session_'+id,'agents','main');fs.mkdirSync(dir,{recursive:true});
 const rows=[{type:'llm.request',agentId:'main',kind:'loop',modelAlias:'kimi-code/k3-256k',thinkingEffort:'low',turnStep:t+'.1',time:t},{type:'context.append_loop_event',agentId:'main',time:t,event:{type:'step.end',turnId:String(t),step:1,messageId:'msg-'+t,usage:{inputOther:10,output:2,inputCacheRead:0,inputCacheCreation:0}}}];
 fs.appendFileSync(path.join(dir,'wire.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');emit({role:'assistant',content:answer});emit({role:'meta',type:'session.resume_hint',session_id:'session_'+id});
}else{
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.OPENCODE_DB);
 db.exec('CREATE TABLE IF NOT EXISTS session(id TEXT PRIMARY KEY,parent_id TEXT,directory TEXT);CREATE TABLE IF NOT EXISTS message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT)');
 db.prepare('INSERT OR IGNORE INTO session VALUES(?,?,?)').run(id,null,process.cwd());
 db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('msg-'+t,id,t,JSON.stringify({role:'assistant',providerID:'deepseek',modelID:'deepseek-flash',variant:'low'}));db.close();
 emit({type:'step_finish',sessionID:id,timestamp:t,part:{type:'step-finish',id:'step-'+t,messageID:'msg-'+t,reason:'stop',tokens:{input:10,output:2,reasoning:0,cache:{read:0,write:0}}}});
 emit({type:'text',sessionID:id,timestamp:t,part:{type:'text',text:answer}});
}
if(process.env.FAKE_NATIVE_EXIT1)process.exitCode=1;
`;
test("all native adapters accept an explicit short-answer policy, default minimum remains enforced, same session resumes", async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-native-short-")),
    old = { ...process.env };
  try {
    process.env.PATH = root + ":" + old.PATH;
    process.env.CLAUDE_CONFIG_DIR = join(root, "claude-home");
    process.env.KIMI_CODE_HOME = join(root, "kimi-home");
    process.env.OPENCODE_DB = join(root, "opencode.db");
    mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
    for (const k of Object.keys(process.env))
      if (k.startsWith("ANTHROPIC_")) delete process.env[k];
    for (const [provider, invoke, config] of [
      ["claude", nativeClaudeRound, { model: "haiku", effort: null }],
      ["kimi", nativeKimiRound, { model: "kimi-code/k3-256k", effort: "low" }],
      [
        "opencode",
        nativeOpenCodeRound,
        { model: "deepseek/deepseek-flash", effort: "low" },
      ],
    ]) {
      writeFileSync(join(root, provider), fixture, { mode: 0o700 });
      let sessionId;
      for (let i = 0; i < 2; i++) {
        const round = {};
        sessionId = await invoke({
          cwd: root,
          sessionId,
          prompt: "FAKE LOCAL FIXTURE",
          round,
          config,
          save() {},
          answerValidator: (a) => a === "short",
        });
        assert.equal(round.answer, "short");
        assert.equal(round.metrics.generations, 1);
        assert.equal(round.nativeLaunchCwd, root);
      }
      const round = {};
      await assert.rejects(
        invoke({
          cwd: root,
          sessionId,
          prompt: "FAKE LOCAL FIXTURE",
          round,
          config,
          save() {},
        }),
        /effective final answer/,
      );
      assert.equal(
        round.metrics.generations,
        1,
        "rejected answer still retains actual usage",
      );
      process.env.FAKE_NATIVE_EXIT1 = "1";
      const failed = {};
      await assert.rejects(
        invoke({
          cwd: root,
          sessionId,
          prompt: "FAKE LOCAL FIXTURE",
          round: failed,
          config,
          save() {},
          answerValidator: () => true,
        }),
        /Native CLI failed/,
      );
      const recovered = recoverMultiNativeUsage({
        config: { ...config, provider },
        round: failed,
      });
      assert.equal(recovered.metrics.generations, 1);
      assert.equal(recovered.metrics.input, 10);
      assert.equal(recovered.usageRecoveryEvidence.completeness, "incomplete");
      delete process.env.FAKE_NATIVE_EXIT1;
    }
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed native batch retains reported charges even when the session id is missing", async () => {
  const { recoverFailedNativeRounds } =
    await import("./multi-native-recovery.mjs");
  const arm = {
    rounds: [
      {
        startedAt: "2026-10-07T00:00:00Z",
        finishedAt: "2026-10-07T00:00:01Z",
        nativeUsageEvidence: {
          generations: [
            {
              responseId: "reported",
              inputTokens: 10,
              cachedInputTokens: 0,
              outputTokens: 2,
            },
          ],
        },
      },
    ],
  };
  recoverFailedNativeRounds(arm, { provider: "claude" });
  assert.equal(arm.rounds[0].metrics.input, 10);
  assert.equal(arm.rounds[0].metrics.generationsBeforeReply, null);
  assert.equal(arm.rounds[0].metrics.usageRecoveryIncomplete, true);
  assert.equal(arm.rounds[0].usageRecoveryEvidence.identityVerified, false);
  assert.equal(arm.rounds[0].sessionId, undefined);
});
