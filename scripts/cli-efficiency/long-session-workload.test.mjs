import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { longWorkload } from "./long-session-workload.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
test("long workload uses six byte-verified files from the fixed source snapshot", () => {
  assert.equal(longWorkload.sourceRef, "7afe141");
  assert.equal(Object.keys(longWorkload.sourceHashes).length, 6);
  let total = 0;
  for (const [path, expected] of Object.entries(longWorkload.sourceHashes)) {
    const bytes = execFileSync("git", [
      "show",
      `${longWorkload.sourceRef}:${path}`,
    ]);
    assert.equal(sha(bytes), expected, path);
    assert.equal(bytes.length, longWorkload.sourceBytes[path], path);
    total += bytes.length;
  }
  assert.equal(total, 48659);
  assert.equal(longWorkload.totalSourceBytes, total);
});
test("twelve frozen stages accumulate checkpoints in one session", () => {
  assert.equal(longWorkload.questions.length, 12);
  assert.deepEqual(longWorkload.checkpoints, [1, 3, 6, 9, 12]);
  assert.match(longWorkload.instructions, /400–600.*汉字/);
  assert.match(longWorkload.instructions, /审查结论：/);
  assert.match(longWorkload.instructions, /同一.*session/);
  assert.match(longWorkload.instructions, /不得.*运行/);
  for (const [index, question] of longWorkload.questions.entries()) {
    assert.equal(sha(question), longWorkload.questionHashes[index]);
    assert.ok(longWorkload.rubric[index].criteria.length === 3);
    assert.doesNotMatch(question, /你此前错误地|请撤回此前/);
  }
  assert.equal(
    sha(
      JSON.stringify({
        instructions: longWorkload.instructions,
        questions: longWorkload.questions,
      }),
    ),
    longWorkload.promptSetHash,
  );
});
test("incremental reading ends before four distinct synthesis deliverables", () => {
  for (const question of longWorkload.questions.slice(0, 8))
    assert.match(question, /新增读取/);
  for (const question of longWorkload.questions.slice(8))
    assert.match(question, /无新读取/);
  assert.match(longWorkload.questions[8], /逐字段/);
  assert.match(longWorkload.questions[9], /SIGTERM/);
  assert.match(longWorkload.questions[10], /测试/);
  assert.match(longWorkload.questions[11], /备忘录/);
  assert.equal(new Set(longWorkload.questions).size, 12);
});

test("v1 prompt identity cannot drift through regenerated metadata", () => {
  assert.equal(longWorkload.id, "restart-audit-12/v1");
  assert.equal(
    longWorkload.promptSetHash,
    "2baafe268994b8a00bfdcae984382974fb073235cbd84b1f83dfa4be84e702a7",
  );
});

test("reading instructions name actual manifest paths without shorthand guesses", () => {
  assert.match(
    longWorkload.questions[0],
    /新增读取 scripts\/workbench-launch-receipt\.mjs/,
  );
  assert.match(
    longWorkload.questions[1],
    /新增读取 scripts\/workbench-launch-receipt\.test\.mjs/,
  );
  assert.match(
    longWorkload.questions[4],
    /新增读取 packages\/daemon\/test\/workbench-restart-guard\.test\.ts/,
  );
  for (const index of [3, 5, 6, 7])
    assert.match(
      longWorkload.questions[index],
      /新增读取 packages\/daemon\/src\/state-backup\.ts/,
    );
});

test("native compaction may require honest re-reading without invalidating technical quality", () => {
  assert.match(longWorkload.instructions, /必要重读.*计费/);
  assert.doesNotMatch(longWorkload.instructions, /后续不得重复读取/);
  assert.match(longWorkload.instructions, /长度合规.*单列/);
});
