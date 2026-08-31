import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentMemoryBootstrap,
  AGENT_MEMORY_BOOTSTRAP_MAX_BYTES,
} from "../src/agent-memory-bootstrap.ts";

test("Raft original-file reading is the default; no generated selection substitutes for memory", () => {
  for (const source of [
    null,
    "",
    "# Agent\n- Fact → notes/fact.md",
    "x".repeat(10000),
  ]) {
    const view = JSON.parse(buildAgentMemoryBootstrap(source));
    assert.equal(view.schemaVersion, 2);
    assert.equal(view.mode, "raft_original");
    assert.equal(view.status, "read_original");
    assert.equal(view.text, "");
    assert.equal("omittedBlocks" in view, false);
  }
});

test("optional verbatim inline keeps a loose list's conclusion AND its long qualifier", () => {
  const source =
    "# Agent\n## Key Knowledge\n- Migration is allowed.\n\n  ONLY on disposable staging, NEVER production. " +
    "Read restrictions first. ".repeat(30) +
    "\n\n- Other → notes/other.md";
  const view = JSON.parse(
    buildAgentMemoryBootstrap(source, undefined, { mode: "verbatim_inline" }),
  );
  assert.equal(view.status, "verbatim");
  assert.equal(view.text, source);
});

test("optional verbatim inline never orphans a continuation from its project scope", () => {
  const source =
    "# Agent\n- [obsolete-project] " +
    "context ".repeat(90) +
    "\n\n  Database: old-db.internal → notes/old.md\n\n- [new] → notes/new.md";
  assert.equal(
    JSON.parse(
      buildAgentMemoryBootstrap(source, undefined, { mode: "verbatim_inline" }),
    ).text,
    source,
  );
});

test("overflow falls back to the WHOLE original file, not a prefix or selected fragments", () => {
  for (const source of [
    null,
    "x".repeat(10000),
    Array.from(
      { length: 150 },
      (_, i) => "- " + i + ' 条目 🧠 \\"quote\\" → notes/' + i + ".md",
    ).join("\n"),
  ]) {
    const encoded = buildAgentMemoryBootstrap(
      source,
      { key: "core", label: "项目" },
      { mode: "verbatim_inline" },
    );
    const view = JSON.parse(encoded);
    assert.ok(Buffer.byteLength(encoded) <= AGENT_MEMORY_BOOTSTRAP_MAX_BYTES);
    assert.equal(view.status, "read_original");
    assert.equal(view.text, "");
    assert.deepEqual(view.project, { key: "core", label: "项目" });
  }
});

test("no Markdown normalization, splitting, heading loss or BOM/CRLF rewriting", () => {
  const sources = [
    "",
    "\uFEFF# Agent\r\n\r\n- A\r\n",
    "# Agent\n## Topic\n### Specific\n- Narrow\n## Topic\n- Broad",
    "- Rule\n\n  ~~~text\n  " +
      "x".repeat(600) +
      "\n  ~~~\n  ONLY in this example\n- Other",
  ];
  for (const source of sources) {
    const view = JSON.parse(
      buildAgentMemoryBootstrap(source, undefined, { mode: "verbatim_inline" }),
    );
    assert.equal(view.status, "verbatim");
    assert.equal(view.text, source);
  }
});

test("metadata and UTF-8 escaping share the inline budget; equal inputs are deterministic", () => {
  const project = { key: "core", label: "一".repeat(32) };
  for (let length = 1; length <= 1400; length += 17) {
    const source = '"🧠\\'.repeat(length);
    const encoded = buildAgentMemoryBootstrap(source, project, {
      mode: "verbatim_inline",
    });
    assert.ok(Buffer.byteLength(encoded) <= AGENT_MEMORY_BOOTSTRAP_MAX_BYTES);
    const view = JSON.parse(encoded);
    assert.equal(view.text, view.status === "verbatim" ? source : "");
    assert.equal(
      encoded,
      buildAgentMemoryBootstrap(source, project, { mode: "verbatim_inline" }),
    );
  }
});
