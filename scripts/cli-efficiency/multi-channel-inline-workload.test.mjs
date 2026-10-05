import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  multiChannelLongWorkload,
  multiChannelLongExpected,
} from "./multi-channel-long-workload.mjs";
import {
  inlineWorkload,
  inlineExpected,
  inlineEvidenceText,
} from "./multi-channel-inline-workload.mjs";
const sha = (value) => createHash("sha256").update(value).digest("hex");

test("one public first message carries the exact historical evidence once", () => {
  assert.equal(
    inlineEvidenceText,
    multiChannelLongWorkload.files["evidence.txt"],
  );
  assert.equal(Buffer.byteLength(inlineEvidenceText), 14682);
  assert.deepEqual(inlineWorkload.files, multiChannelLongWorkload.files);
  assert.equal(inlineWorkload.steps.length, 36);
  assert.equal(inlineWorkload.steps[0].speaker, "a");
  assert.equal(inlineWorkload.steps[0].round, 1);
  const first = inlineWorkload.steps[0].body;
  const open = "```text\n",
    start = first.indexOf(open) + open.length;
  assert.ok(start >= open.length);
  assert.equal(
    first.slice(start, start + inlineEvidenceText.length),
    inlineEvidenceText,
  );
  assert.equal(
    first.slice(
      start + inlineEvidenceText.length,
      start + inlineEvidenceText.length + 3,
    ),
    "```",
  );
  assert.equal(
    inlineWorkload.steps.filter((s) => s.body.includes(inlineEvidenceText))
      .length,
    1,
  );
  for (const s of inlineWorkload.steps.slice(1))
    assert.ok(!s.body.includes("=== 7afe141:"));
});

test("all original factual questions and speaker order remain, without file read authorization", () => {
  assert.match(inlineWorkload.instructions, /材料已经放在频道公共消息中/);
  assert.match(inlineWorkload.instructions, /不得读取文件/);
  assert.match(inlineWorkload.instructions, /零业务工具/);
  for (let i = 0; i < 36; i++) {
    const previous = multiChannelLongWorkload.steps[i],
      next = inlineWorkload.steps[i];
    assert.equal(next.speaker, previous.speaker);
    assert.equal(next.round, previous.round);
    const question = previous.body
      .replace(/^第\d+轮。/, "")
      .replace(
        /^(只读一次evidence\.txt全文。|不再读取文件或调用业务工具。)/,
        "",
      );
    assert.ok(next.body.endsWith(question));
    assert.doesNotMatch(
      next.body.slice(next.body.lastIndexOf(`第${next.round}轮。`)),
      /只读一次|cat evidence/,
    );
  }
  assert.match(inlineWorkload.instructions, /只返回一行/);
});

test("expected answers are evaluator-only and identity includes the single material message", () => {
  assert.deepEqual(inlineExpected, multiChannelLongExpected);
  assert.equal("expected" in inlineWorkload, false);
  const provider = JSON.stringify({
    instructions: inlineWorkload.instructions,
    steps: inlineWorkload.steps,
  });
  for (const e of inlineExpected) assert.ok(!provider.includes(e.answer));
  assert.equal(inlineWorkload.promptSetHash, sha(provider));
  assert.equal(
    inlineWorkload.identityHash,
    sha(
      JSON.stringify({
        id: inlineWorkload.id,
        sourceRef: inlineWorkload.sourceRef,
        sourceSlices: inlineWorkload.sourceSlices,
        fileHashes: inlineWorkload.fileHashes,
        promptSetHash: inlineWorkload.promptSetHash,
      }),
    ),
  );
});

test("inline experimental identity is frozen separately from the file-read workload", () => {
  assert.equal(inlineWorkload.id, "credential-inline-facts-3x12/v1");
  assert.equal(
    inlineWorkload.promptSetHash,
    "ff03d4f56d6bb7c744185330296d98ac9817e8862706fdc6f4eb67118a0c249f",
  );
  assert.equal(
    inlineWorkload.identityHash,
    "65608fede5d5bb7bdb4e1bbb53b9f04d1e2ea47e7138ea3d29e19145764675a9",
  );
  assert.equal(
    sha(inlineEvidenceText),
    "6ae369899978d878a1b11182a9675fbff7aef2a6955ce747d524011c7bca6204",
  );
});
