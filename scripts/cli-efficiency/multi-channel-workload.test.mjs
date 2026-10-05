import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { multiWorkload } from "./multi-channel-workload.mjs";
const sha = (s) => createHash("sha256").update(s).digest("hex");
test("multi channel evidence is exactly frozen source slices, without evaluator commentary", () => {
  assert.equal(multiWorkload.sourceRef, "7afe141");
  assert.deepEqual(Object.keys(multiWorkload.files), ["evidence.txt"]);
  const sections = multiWorkload.sourceSlices.map(({ path, from, to }) => {
    const source = execFileSync("git", ["show", `7afe141:${path}`], {
      encoding: "utf8",
    }).split("\n");
    return (
      `=== 7afe141:${path}:${from}–${to} ===\n` +
      source
        .slice(from - 1, to)
        .map((line, i) => `${from + i}: ${line}`)
        .join("\n")
    );
  });
  assert.equal(
    multiWorkload.files["evidence.txt"],
    sections.join("\n\n") + "\n",
  );
  assert.equal(
    sha(multiWorkload.files["evidence.txt"]),
    multiWorkload.fileHashes["evidence.txt"],
  );
});
test("twelve scheduled steps give each instance four ordered turns without changing sessions", () => {
  assert.deepEqual(
    multiWorkload.steps.map((s) => s.speaker),
    ["a", "b", "c", "a", "b", "c", "a", "b", "c", "a", "b", "c"],
  );
  for (const speaker of ["a", "b", "c"]) {
    const turns = multiWorkload.steps.filter((s) => s.speaker === speaker);
    assert.deepEqual(
      turns.map((s) => s.round),
      [1, 2, 3, 4],
    );
    assert.match(turns[0].body, /evidence\.txt/);
    for (const turn of turns.slice(1)) assert.match(turn.body, /不再读取/);
  }
  assert.match(multiWorkload.instructions, /800.*汉字/);
  assert.match(multiWorkload.instructions, /不设最低/);
  assert.match(multiWorkload.instructions, /不得.*@/);
  assert.match(multiWorkload.instructions, /同一.*session/);
  assert.match(multiWorkload.instructions, /不得.*运行/);
  assert.doesNotMatch(
    multiWorkload.instructions,
    /omittedRuntimeCredentials|深比较失败|稳定目录.*阻断/,
  );
});
test("workload identity covers exact evidence, common instructions and scheduled questions", () => {
  assert.equal(multiWorkload.id, "credential-review-3x4/v1");
  assert.equal(
    sha(
      JSON.stringify({
        instructions: multiWorkload.instructions,
        steps: multiWorkload.steps,
      }),
    ),
    multiWorkload.promptSetHash,
  );
  assert.equal(
    sha(
      JSON.stringify({
        id: multiWorkload.id,
        sourceRef: multiWorkload.sourceRef,
        sourceSlices: multiWorkload.sourceSlices,
        fileHashes: multiWorkload.fileHashes,
        promptSetHash: multiWorkload.promptSetHash,
      }),
    ),
    multiWorkload.identityHash,
  );
});

test("v1 cannot silently replace questions or selected evidence with regenerated hashes", () => {
  assert.equal(
    multiWorkload.promptSetHash,
    "192dfb2135085d914ccf425a720a721741848da172bcb6a30859a8b50539c36f",
  );
  assert.equal(
    multiWorkload.fileHashes["evidence.txt"],
    "6ae369899978d878a1b11182a9675fbff7aef2a6955ce747d524011c7bca6204",
  );
  assert.equal(
    multiWorkload.identityHash,
    "4ae87620e3143a1ca2895d71863014d8c58426f59ea1c669c5102d25f86622c4",
  );
});
