import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readPassiveHttpCapture } from "./passive-http-capture-reader.mjs";

const preload = new URL("./passive-http-capture.mjs", import.meta.url).pathname;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function harness(t, handler) {
  const root = mkdtempSync(join(tmpdir(), "passive-capture-"));
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    url: `http://127.0.0.1:${server.address().port}/v1/chat/completions?private=query`,
    launch(code, extra = {}) {
      const child = spawn(
        process.execPath,
        ["--import", preload, "--input-type=module", "-e", code],
        {
          env: {
            ...process.env,
            LOOM_REQUEST_CAPTURE_DIR: root,
            LOOM_REQUEST_CAPTURE_ARM: "native",
            LOOM_REQUEST_CAPTURE_ROUND: "2",
            ...extra,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.on("data", (b) => {
        stderr += b;
      });
      const done = new Promise((resolve) =>
        child.on("close", (code, signal) => resolve({ code, signal, stderr })),
      );
      t.after(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      });
      return { child, done };
    },
  };
}

test("actual streaming UTF-8 bytes, failed HTTP retry, metadata privacy and sealed census", async (t) => {
  const bodies = [],
    authorization = [];
  const response = Buffer.from('data: {"text":"你好🌍"}\n\ndata: [DONE]\n\n');
  const h = await harness(t, async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    bodies.push(Buffer.concat(chunks));
    authorization.push(req.headers.authorization);
    res.writeHead(bodies.length === 1 ? 429 : 200);
    for (let i = 0; i < response.length; i++)
      res.write(response.subarray(i, i + 1));
    res.end();
  });
  const body = JSON.stringify({
    model: "synthetic",
    messages: [{ role: "user", content: "测试🌍" }],
  });
  const run = h.launch(
    `for(let n=0;n<2;n++){const bytes=Buffer.from(${JSON.stringify(body)});async function* parts(){for(const b of bytes)yield Buffer.from([b]);}const r=await fetch(${JSON.stringify(h.url)},{method:'POST',headers:{authorization:'Bearer SYNTHETIC_HEADER_ONLY'},duplex:'half',body:parts()});await r.arrayBuffer();}`,
  );
  assert.equal((await run.done).code, 0);
  const report = readPassiveHttpCapture(h.root);
  assert.equal(report.complete, true, JSON.stringify(report.errors));
  assert.equal(report.attempts.length, 2);
  assert.equal(new Set(report.attempts.map((a) => a.id)).size, 2);
  assert.deepEqual(
    report.attempts.map((a) => a.status),
    [429, 200],
  );
  for (const a of report.attempts) {
    assert.equal(readFileSync(a.requestPath, "utf8"), body);
    assert.deepEqual(readFileSync(a.responsePath), response);
    assert.equal(a.requestSha256, hash(body));
    assert.equal(a.responseSha256, hash(response));
    assert.equal(a.arm, "native");
    assert.equal(a.round, 2);
    assert.equal(statSync(a.requestPath).mode & 0o777, 0o600);
    const events = readFileSync(
      join(a.processDirectory, "events.jsonl"),
      "utf8",
    );
    assert.ok(!events.includes("SYNTHETIC_HEADER_ONLY"));
    assert.ok(!events.includes("private=query"));
  }
  assert.deepEqual(bodies, [Buffer.from(body), Buffer.from(body)]);
  assert.deepEqual(authorization, [
    "Bearer SYNTHETIC_HEADER_ONLY",
    "Bearer SYNTHETIC_HEADER_ONLY",
  ]);
});

test("interrupted response retains bytes and unknown completeness", async (t) => {
  const h = await harness(t, (_req, res) => {
    res.writeHead(200);
    res.write("partial");
  });
  const run = h.launch(
    `const c=new AbortController();const r=await fetch(${JSON.stringify(h.url)},{method:'POST',body:'{}',signal:c.signal});setTimeout(()=>c.abort(),40);try{await r.text()}catch{}`,
  );
  assert.equal((await run.done).code, 0);
  const r = readPassiveHttpCapture(h.root);
  assert.equal(r.complete, false);
  assert.equal(r.attempts.length, 1);
  assert.equal(readFileSync(r.attempts[0].responsePath, "utf8"), "partial");
});

test("capacity exhaustion preserves bounded bytes and never changes HTTP outcome", async (t) => {
  const h = await harness(t, (req, res) => {
    req.resume();
    res.end("x".repeat(4096));
  });
  const run = h.launch(
    `const r=await fetch(${JSON.stringify(h.url)},{method:'POST',body:'{}'});if((await r.text()).length!==4096)process.exitCode=4;`,
    { LOOM_REQUEST_CAPTURE_MAX_BYTES: "32" },
  );
  assert.equal((await run.done).code, 0);
  const r = readPassiveHttpCapture(h.root);
  assert.equal(r.complete, false);
  const bytes = r.attempts.reduce(
    (n, a) => n + statSync(a.requestPath).size + statSync(a.responsePath).size,
    0,
  );
  assert.ok(bytes <= 32);
  assert.ok(r.errors.length > 0);
});

test("missing process seal cannot be accepted after forced termination", async (t) => {
  let received;
  const ready = new Promise((resolve) => {
    received = resolve;
  });
  const h = await harness(t, (_req, res) => {
    res.write("partial");
    received();
  });
  const run = h.launch(
    `await (await fetch(${JSON.stringify(h.url)},{method:'POST',body:'{}'})).text()`,
  );
  await ready;
  run.child.kill("SIGKILL");
  await run.done;
  const r = readPassiveHttpCapture(h.root);
  assert.equal(r.complete, false);
  assert.ok(r.errors.some((e) => e.includes("seal")));
});

test("unrelated requests are excluded and empty observation is not evidence", async (t) => {
  const h = await harness(t, (_req, res) => res.end("ok"));
  const url = h.url.replace("chat/completions", "models");
  assert.equal(
    (await h.launch(`await(await fetch(${JSON.stringify(url)})).text()`).done)
      .code,
    0,
  );
  const r = readPassiveHttpCapture(h.root);
  assert.equal(r.attempts.length, 0);
  assert.equal(r.complete, false);
  assert.ok(readdirSync(h.root).length > 0);
});

test("compressed response is archived as bytes with safe encoding metadata", async (t) => {
  const bytes = gzipSync(Buffer.from("你好 compressed payload"));
  const h = await harness(t, (req, res) => {
    req.resume();
    res.writeHead(200, {
      "content-encoding": "gzip",
      "x-private": "SECRET_HEADER",
    });
    res.end(bytes);
  });
  assert.equal(
    (
      await h.launch(
        `const r=await fetch(${JSON.stringify(h.url)},{method:'POST',body:'{}'});if(await r.text()!=='你好 compressed payload')process.exitCode=4;`,
      ).done
    ).code,
    0,
  );
  const r = readPassiveHttpCapture(h.root);
  assert.equal(r.complete, true, JSON.stringify(r.errors));
  assert.equal(r.attempts[0].contentEncoding, "gzip");
  assert.deepEqual(readFileSync(r.attempts[0].responsePath), bytes);
  assert.ok(
    !readFileSync(
      join(r.attempts[0].processDirectory, "events.jsonl"),
      "utf8",
    ).includes("SECRET_HEADER"),
  );
});

test("observer filesystem failure does not throw into provider and cannot seal evidence", async (t) => {
  const h = await harness(t, (req, res) => {
    req.resume();
    res.end("provider unchanged");
  });
  const run = h.launch(
    `import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';fs.writeSync=()=>{throw new Error('SYNTHETIC PRIVATE ERROR')};syncBuiltinESMExports();const r=await fetch(${JSON.stringify(h.url)},{method:'POST',body:'{}'});if(await r.text()!=='provider unchanged')process.exitCode=4;`,
  );
  const exit = await run.done;
  assert.equal(exit.code, 0);
  assert.ok(!exit.stderr.includes("SYNTHETIC PRIVATE ERROR"));
  assert.equal(readPassiveHttpCapture(h.root).complete, false);
});
