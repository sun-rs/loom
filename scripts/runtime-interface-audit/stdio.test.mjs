import test from "node:test";
import assert from "node:assert/strict";
import { JsonLinesProcess } from "./stdio.mjs";

test("correlates out-of-order replies and retains events emitted before the caller waits", async () => {
  const code = `let input='';process.stdin.on('data',b=>{input+=b;let n;while((n=input.indexOf('\\n'))>=0){const r=JSON.parse(input.slice(0,n));input=input.slice(n+1);setTimeout(()=>{console.log(JSON.stringify({type:'ready',request:r.id}));console.log(JSON.stringify({id:r.id,result:r.method}));},r.method==='slow'?20:0);}});process.stdin.on('end',()=>setTimeout(()=>process.exit(0),30));`;
  const child = new JsonLinesProcess(process.execPath, ["-e", code], {
    env: { PATH: process.env.PATH },
  });
  try {
    const a = child.rpc("slow", {}),
      b = child.rpc("fast", {});
    assert.equal((await b).result, "fast");
    assert.equal((await a).result, "slow");
    assert.equal(
      (await child.wait((x) => x.type === "ready" && x.request === 2)).type,
      "ready",
    );
  } finally {
    assert.equal((await child.close()).code, 0);
  }
});

test("reports a native protocol error without treating command acceptance as task completion", async () => {
  const code = `process.stdin.once('data',b=>{const r=JSON.parse(b);console.log(JSON.stringify({id:r.id,error:{code:-32601,message:'unsupported'}}));});process.stdin.on('end',()=>process.exit(0));`;
  const child = new JsonLinesProcess(process.execPath, ["-e", code], {
    env: { PATH: process.env.PATH },
  });
  try {
    const r = await child.rpc("missing", {});
    assert.equal(r.error.code, -32601);
    assert.equal(
      child.frames.some((x) => x.type === "agent_settled"),
      false,
    );
  } finally {
    await child.close();
  }
});
