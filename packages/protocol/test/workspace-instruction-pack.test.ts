import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceInstructionPackSchema } from "../src/index.ts";

test("Workspace instruction pack protocol is strict, bounded, and path-scoped", () => {
  const pack = {
    files: [
      file("AGENTS.md", "Agent rules\n"),
      file("CLAUDE.md", "Claude rules\n"),
      file(".agents/skills/review/SKILL.md", "Review skill\n"),
      file(".claude/skills/review.md", "Claude review skill\n"),
    ],
    packId: "f".repeat(64),
    protocolVersion: 1,
  };
  assert.deepEqual(WorkspaceInstructionPackSchema.parse(pack), pack);
  assert.throws(() =>
    WorkspaceInstructionPackSchema.parse({ ...pack, command: "/bin/sh" }),
  );
  assert.throws(() =>
    WorkspaceInstructionPackSchema.parse({
      ...pack,
      files: pack.files.filter((entry) => entry.relativePath !== "CLAUDE.md"),
    }),
  );
  for (const relativePath of [
    "../AGENTS.md",
    "/AGENTS.md",
    ".agents/skills/../../escape.md",
    ".agents\\skills\\bad.md",
    ".agents/skills/not-markdown.txt",
    "MEMORY.md",
  ]) {
    assert.throws(() =>
      WorkspaceInstructionPackSchema.parse({
        ...pack,
        files: [
          file("AGENTS.md", "Agent rules\n"),
          file("CLAUDE.md", "Claude rules\n"),
          file(relativePath, "bad\n"),
        ],
      }),
    );
  }
  assert.throws(() =>
    WorkspaceInstructionPackSchema.parse({
      ...pack,
      files: [
        file("AGENTS.md", "Agent rules\n"),
        file("CLAUDE.md", "Claude rules\n"),
        file("AGENTS.md", "duplicate\n"),
      ],
    }),
  );
  assert.throws(() =>
    WorkspaceInstructionPackSchema.parse({
      ...pack,
      files: [
        { ...file("AGENTS.md", "Agent rules\n"), size: 1 },
        file("CLAUDE.md", "Claude rules\n"),
      ],
    }),
  );
});

function file(relativePath: string, content: string) {
  return {
    content,
    relativePath,
    sha256: "a".repeat(64),
    size: Buffer.byteLength(content),
  };
}
