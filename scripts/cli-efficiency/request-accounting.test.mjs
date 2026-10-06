import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  accountCodexRequest,
  accountCapturedRequests,
} from "./request-accounting.mjs";

const message = (role, text) => ({
  type: "message",
  role,
  content: [{ type: "input_text", text }],
});
const prefix = () => [
  { type: "additional_tools", role: "developer", tools: [] },
  message("developer", "base instructions"),
  message("developer", "runtime policy"),
  message("developer", "team instructions"),
  message("developer", "delegation policy"),
  message("user", "# AGENTS.md instructions for /private/example"),
];
const request = (items, extra = {}) =>
  JSON.stringify({ model: "fixture-only", input: items, ...extra });
const first = () => [...prefix(), message("user", "问题：秘密材料🔒")];
const productHistory = () => [
  { type: "custom_tool_call", name: "exec", input: 'text("回答")' },
  {
    type: "custom_tool_call_output",
    output: [
      {
        type: "input_text",
        text: JSON.stringify({
          content: [{ type: "text", text: '{"state":"published"}' }],
        }),
      },
    ],
  },
  message("developer", "<turn_aborted>interrupted</turn_aborted>"),
  message("user", "下一轮问题"),
];

test("UTF-8 JSON body categories reconcile without exposing prompt contents", () => {
  const body = request(first(), { client_metadata: { secret: "PRIVATE" } });
  const report = accountCodexRequest(body);
  assert.equal(report.bodyBytes, Buffer.byteLength(body));
  assert.ok(report.bodyBytes > body.length);
  assert.equal(
    Object.values(report.categories).reduce((sum, n) => sum + n, 0),
    report.bodyBytes,
  );
  assert.equal(
    report.inputBytes + report.categories.requestOutsideInput,
    report.bodyBytes,
  );
  assert.equal(report.classificationComplete, true);
  assert.equal(
    report.historyPreserved,
    null,
    "no previous request is unknown, not proof",
  );
  assert.equal(report.prefixStable, null);
  assert.match(report.bodySha256, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(report),
    /秘密|PRIVATE|\/private\/example|fixture-only/u,
  );
});

test("old wakes and tool results are counted once per request, not twice via nested JSON", () => {
  const before = first();
  const after = [...before, ...productHistory()];
  const report = accountCodexRequest(request(after), request(before));
  assert.equal(report.prefixStable, true);
  assert.equal(report.historyPreserved, true);
  assert.equal(
    report.categories.historicalWakes,
    Buffer.byteLength(JSON.stringify(before[6])),
  );
  assert.equal(
    report.categories.historicalToolResults,
    Buffer.byteLength(JSON.stringify(after[8])),
  );
  assert.equal(
    report.categories.historicalInterruptions,
    Buffer.byteLength(JSON.stringify(after[9])),
  );
  assert.equal(
    report.categories.currentWake,
    Buffer.byteLength(JSON.stringify(after[10])),
  );
  assert.equal(report.categories.inputArraySyntax, after.length + 1);
});

test("changed fixed instructions and rewritten old history cannot pass continuity checks", () => {
  const before = first();
  const after = [...structuredClone(before), ...productHistory()];
  after[2] = message("developer", "changed policy");
  after[6] = message("user", "replacement history");
  const report = accountCodexRequest(request(after), request(before));
  assert.equal(report.prefixStable, false);
  assert.equal(report.historyPreserved, false);
});

test("new input kinds remain measured but explicitly unclassified", () => {
  const body = request([
    ...first(),
    { type: "reasoning", encrypted_content: "PRIVATE" },
  ]);
  const report = accountCodexRequest(body);
  assert.equal(report.classificationComplete, false);
  assert.equal(report.unclassifiedItems, 1);
  assert.ok(report.categories.unclassifiedInput > 0);
  assert.equal(
    Object.values(report.categories).reduce((a, b) => a + b),
    Buffer.byteLength(body),
  );
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|encrypted_content/u);
});

test("unsupported layouts and serialization reject without echoing private requests", () => {
  for (const body of [
    "SECRET invalid JSON",
    JSON.stringify({ input: [] }),
    request(first(), { tools: [] }),
    JSON.stringify(JSON.parse(request(first())), null, 2),
    request([message("developer", "SECRET"), ...first().slice(1)]),
  ]) {
    assert.throws(
      () => accountCodexRequest(body),
      (error) => {
        assert.doesNotMatch(error.message, /SECRET|秘密|private\/example/u);
        return true;
      },
    );
  }
});

test("aggregate arms separately, preserving session order and excluding usage and ratios", () => {
  const initial = request(first());
  const resumed = request([...first(), ...productHistory()]);
  const records = [
    { arm: "product", session: "a", round: 1, body: initial },
    { arm: "native", session: "a", round: 1, body: initial },
    { arm: "product", session: "a", round: 2, body: resumed },
  ];
  const report = accountCapturedRequests(records);
  assert.equal(
    report.arms.product.bodyBytes,
    Buffer.byteLength(initial) + Buffer.byteLength(resumed),
  );
  assert.equal(report.arms.native.bodyBytes, Buffer.byteLength(initial));
  assert.equal(report.arms.product.requests, 2);
  assert.equal(report.rows[2].historyPreserved, true);
  assert.equal(report.rows[1].historyPreserved, null);
  for (const key of [
    "tokens",
    "usage",
    "ratio",
    "paidCalls",
    "efficiencyPassed",
  ])
    assert.equal(Object.hasOwn(report, key), false);
  assert.throws(
    () => accountCapturedRequests([...records, records[2]]),
    /round/u,
  );
  assert.throws(
    () => accountCapturedRequests([{ ...records[0], round: 2 }]),
    /round/u,
  );
  assert.throws(
    () =>
      accountCapturedRequests([{ ...records[0], session: "/private/SECRET" }]),
    /label/u,
  );
  assert.throws(() => accountCapturedRequests([]), /empty/u);
});

test("CLI hashes exact UTF-8 capture bytes and rejects corruption or a BOM without leaking paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-accounting-private-"));
  const path = join(directory, "capture.json");
  const manifest = join(directory, "manifest.json");
  const cli = fileURLToPath(
    new URL("./request-accounting.mjs", import.meta.url),
  );
  const body = request(first());
  writeFileSync(
    manifest,
    JSON.stringify([
      { arm: "product", session: "a", round: 1, bodyPath: "capture.json" },
    ]),
  );
  try {
    writeFileSync(path, body);
    const valid = spawnSync(process.execPath, [cli, manifest], {
      encoding: "utf8",
    });
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout).rows[0], {
      arm: "product",
      session: "a",
      round: 1,
      ...accountCodexRequest(body),
    });
    const validBytes = Buffer.from(body);
    const corrupt = Buffer.from(validBytes);
    corrupt[corrupt.indexOf(Buffer.from("秘密"))] = 0xff;
    for (const bytes of [
      corrupt,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), validBytes]),
    ]) {
      writeFileSync(path, bytes);
      const rejected = spawnSync(process.execPath, [cli, manifest], {
        encoding: "utf8",
      });
      assert.equal(
        rejected.status,
        1,
        "invalid encoding must not yield accounting evidence",
      );
      assert.equal(rejected.stdout, "");
      assert.match(rejected.stderr, /Request accounting failed/u);
      assert.ok(!rejected.stderr.includes(directory));
      assert.doesNotMatch(rejected.stderr, /秘密|AGENTS/u);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
