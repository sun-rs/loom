import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolvePiSessionFile } from "../src/pi-session-files.ts";
import { copyPiSession } from "../src/pi-session-fork.ts";

const key = {
  participantId: "source",
  provider: "pi-print-json/v1",
  runtimeProfileRevisionId: "revision",
  standingPromptDigest: "prompt",
  workspaceMountRevisionId: "mount",
};
const transcript = (id: string) =>
  JSON.stringify({ type: "session", version: 3, id, cwd: "/fixture" }) +
  "\n" +
  JSON.stringify({
    type: "message",
    id: "m1",
    parentId: null,
    message: { role: "user", content: "SYNTHETIC parent" },
  }) +
  "\n";

test("Pi native file owner preserves old paths and resolves bound forks across Host restarts without blank replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-files-"));
  try {
    await mkdir(join(root, "pi-sessions"), { mode: 0o700 });
    const legacy = join(
      root,
      "pi-sessions",
      createHash("sha256")
        .update(JSON.stringify([key, 2]))
        .digest("hex") + ".jsonl",
    );
    assert.equal(await resolvePiSessionFile(root, key, 2), legacy);
    await writeFile(legacy, transcript("parent"), { mode: 0o600 });
    const fork = join(root, "pi-sessions", "native-fork.jsonl");
    await writeFile(fork, transcript("child"), { mode: 0o600 });
    assert.equal(await resolvePiSessionFile(root, key, 2, "parent"), legacy);
    const target = { ...key, participantId: "child" };
    await writeFile(join(root, "pi-sessions", "unpublished.jsonl"), "", {
      mode: 0o600,
    });
    assert.equal(await resolvePiSessionFile(root, target, 0, "child"), fork);
    assert.equal(
      await resolvePiSessionFile(
        root,
        { ...target, standingPromptDigest: "updated" },
        0,
        "child",
      ),
      fork,
    );
    await assert.rejects(
      resolvePiSessionFile(root, target, 0, "missing"),
      /continuity|missing/i,
    );
    await writeFile(
      join(root, "pi-sessions", "duplicate.jsonl"),
      transcript("child"),
      { mode: 0o600 },
    );
    await assert.rejects(
      resolvePiSessionFile(root, target, 0, "child"),
      /ambiguous/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi source file lookup rejects linked native files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-link-"));
  try {
    await mkdir(join(root, "pi-sessions"), { mode: 0o700 });
    await writeFile(join(root, "foreign"), transcript("parent"));
    await symlink(
      join(root, "foreign"),
      join(root, "pi-sessions", "linked.jsonl"),
    );
    await assert.rejects(
      resolvePiSessionFile(root, key, 0, "parent"),
      /private|symlink|regular/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi copy only uses offline --fork and get_state, preserves source and refuses lost context or reused IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-copy-中文-"));
  try {
    const executable = join(root, "fake-cli.mjs");
    await writeFile(
      executable,
      `#!${process.execPath}
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createInterface} from 'node:readline';
const args=process.argv.slice(2),source=args[args.indexOf('--fork')+1],dir=args[args.indexOf('--session-dir')+1];
writeFileSync(process.env.LOG,JSON.stringify(args));
let body=readFileSync(source,'utf8'),rows=body.trim().split('\\n').map(JSON.parse);rows[0].id=process.env.MODE==='same'?'parent':'child';
if(process.env.MODE==='lost') rows=rows.slice(0,1);
if(process.env.MODE==='mutate')writeFileSync(source,body+'{}\\n');
const sessionFile=join(dir,'child.jsonl');writeFileSync(sessionFile,rows.map(JSON.stringify).join('\\n')+'\\n',{mode:0o600});
for await(const line of createInterface({input:process.stdin})){const f=JSON.parse(line);if(f.type!=='get_state')process.exit(4);const reply=Buffer.from(JSON.stringify({type:'response',id:f.id,command:f.type,success:true,data:{sessionId:rows[0].id,sessionFile}})+'\\n');if(process.env.MODE==='unicode'){const split=reply.indexOf(Buffer.from('中'))+1;process.stdout.write(reply.subarray(0,split));setTimeout(()=>process.stdout.write(reply.subarray(split)),10);}else process.stdout.write(reply);}
`,
      { mode: 0o700 },
    );
    for (const mode of ["ok", "unicode", "same", "lost", "mutate"]) {
      const state = join(root, mode);
      await mkdir(join(state, "pi-sessions"), { recursive: true, mode: 0o700 });
      const source = join(state, "pi-sessions", "source.jsonl");
      const before = transcript("parent");
      await writeFile(source, before, { mode: 0o600 });
      const log = join(root, mode + ".args");
      const result = copyPiSession({
        executable,
        cwd: root,
        env: { PATH: process.env.PATH, HOME: root, LOG: log, MODE: mode },
        sourceId: "parent",
        supervisorDirectory: state,
      });
      if (mode === "ok" || mode === "unicode") {
        assert.equal(await result, "child");
        assert.equal(await readFile(source, "utf8"), before);
        assert.equal(
          await resolvePiSessionFile(
            state,
            { ...key, participantId: "target" },
            0,
            "child",
          ),
          join(state, "pi-sessions", "child.jsonl"),
        );
      } else await assert.rejects(result, /Pi native copy/);
      const args = JSON.parse(await readFile(log, "utf8"));
      for (const flag of [
        "--offline",
        "--fork",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-mcp",
      ])
        assert.ok(args.includes(flag));
      assert.ok(!args.includes("--print"));
      assert.ok(!args.includes("--session"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
