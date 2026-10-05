import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { multiWorkload } from "./multi-channel-workload.mjs";
import {
  multiChannelLongWorkload as workload,
  multiChannelLongExpected as expected,
} from "./multi-channel-long-workload.mjs";
const sha = (s) => createHash("sha256").update(s).digest("hex");

test("long transport workload reuses exact historical evidence and gives each lane twelve turns", () => {
  assert.deepEqual(workload.files, multiWorkload.files);
  assert.deepEqual(workload.fileHashes, multiWorkload.fileHashes);
  assert.equal(workload.sourceRef, "7afe141");
  assert.equal(workload.steps.length, 36);
  for (const speaker of ["a", "b", "c"]) {
    const turns = workload.steps.filter((s) => s.speaker === speaker);
    assert.deepEqual(
      turns.map((s) => s.round),
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    assert.match(turns[0].body, /只读一次evidence\.txt全文/);
    for (const t of turns.slice(1)) assert.match(t.body, /不再读取/);
  }
  for (let i = 0; i < 36; i++)
    assert.equal(workload.steps[i].speaker, ["a", "b", "c"][i % 3]);
});

test("answers are evaluator-only and questions require one unambiguous line", () => {
  assert.equal(expected.length, 12);
  assert.equal(new Set(expected.map((e) => e.field)).size, 12);
  assert.equal("expected" in workload, false);
  for (const [i, e] of expected.entries()) {
    assert.equal(e.round, i + 1);
    assert.equal(e.answer, `审查结论：${e.field}=${e.value}`);
    assert.match(workload.steps[i * 3].body, new RegExp(e.field));
    assert.ok(
      !JSON.stringify({
        instructions: workload.instructions,
        steps: workload.steps,
      }).includes(e.answer),
      `answer leaked at round ${e.round}`,
    );
    assert.ok(e.source.length > 0);
  }
  assert.match(workload.instructions, /只返回一行/);
  assert.match(workload.instructions, /无需解释.*行号/);
  assert.match(workload.instructions, /同一原生session/);
  assert.match(workload.instructions, /不得.*运行/);
});

test("causal questions retain the actual source distinction rather than the P116 misconception", () => {
  const source = workload.files["evidence.txt"];
  assert.ok(
    source.includes("153:     assert.deepEqual(await fileInventory(state), {"),
  );
  assert.ok(
    source.includes(
      "116:     ...(omittedRuntimeCredentials.length ? { omittedRuntimeCredentials } : {}),",
    ),
  );
  const record = {
    files: {},
    omittedSockets: [],
    omittedRuntimeCredentials: [
      "warm-runtimes/instrt_00000000-0000-0000-0000-000000000000/turns",
    ],
  };
  assert.throws(() =>
    assert.deepEqual(record, { files: {}, omittedSockets: [] }),
  );
  assert.equal(expected.find((e) => e.field === "stable").value, "reject");
  assert.ok(
    source.includes(
      "28:     assert.equal(await steps[name](), true, `Restart blocked at ${name}`);",
    ),
  );
  assert.equal(expected.find((e) => e.field === "stop_calls").value, "0");
});

test("identity includes evidence and full sequence but never sends expected answers", () => {
  assert.equal(
    workload.promptSetHash,
    sha(
      JSON.stringify({
        instructions: workload.instructions,
        steps: workload.steps,
      }),
    ),
  );
  assert.equal(
    workload.identityHash,
    sha(
      JSON.stringify({
        id: workload.id,
        sourceRef: workload.sourceRef,
        sourceSlices: workload.sourceSlices,
        fileHashes: workload.fileHashes,
        promptSetHash: workload.promptSetHash,
      }),
    ),
  );
});

test("first read is one complete cat and shared answers are not independent-review evidence", () => {
  assert.match(workload.instructions, /唯一读取命令为cat evidence\.txt/);
  assert.match(workload.instructions, /max_output_tokens.*10000/);
  assert.match(workload.instructions, /不代表三份独立审查/);
});

test("long v1 question identity is frozen independently of regenerated metadata", () => {
  assert.equal(workload.id, "credential-facts-3x12/v1");
  assert.equal(
    workload.promptSetHash,
    "3a52f20b52f065b9002cb69f60911a85ac4c73e36b470100d7162273b4af59c3",
  );
  assert.equal(
    workload.identityHash,
    "0c9f8c64412fa44ec658c15a0dd0db1bcc19e13749add9dfd028499c4f49cd29",
  );
  assert.deepEqual(
    expected.map((e) => e.answer),
    [
      "审查结论：credential_field=absent",
      "审查结论：credentials=reject",
      "审查结论：socket=omit",
      "审查结论：symlink=reject",
      "审查结论：sidecars=omit",
      "审查结论：mode=0700",
      "审查结论：db=backup",
      "审查结论：changed_files=reject",
      "审查结论：quick_check=ok",
      "审查结论：foreign_keys=reject",
      "审查结论：stable=reject",
      "审查结论：stop_calls=0",
    ],
  );
});
