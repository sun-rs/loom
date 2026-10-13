import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyClaudeSession } from "../src/claude-session-fork.ts";

// Synthetic native storage, no provider executable, credentials or model calls.
async function fixture(
  root: string,
  sourceId: string,
  marker: string,
  compact: false | "anchor" | "tail",
) {
  await mkdir(join(root, "workspace"));
  const cwd = await realpath(join(root, "workspace"));
  const config = join(root, "config");
  const directory = join(config, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  await mkdir(directory, { recursive: true });

  const ids = Array.from({ length: 6 }, () => randomUUID());
  const row = (
    uuid: string,
    parentUuid: string | null,
    type: string,
    text: string,
  ) => ({
    uuid,
    parentUuid,
    type,
    sessionId: sourceId,
    cwd,
    isSidechain: false,
    timestamp: "2026-10-13T00:00:00.000Z",
    message: { role: type, content: text },
  });
  const rows: Record<string, unknown>[] = [
    row(ids[0]!, null, "user", "DISCARDED_OLD"),
    row(ids[1]!, ids[0]!, "assistant", marker),
  ];
  if (compact)
    rows.push(
      {
        uuid: ids[2],
        parentUuid: null,
        type: "system",
        subtype: "compact_boundary",
        sessionId: sourceId,
        timestamp: "2026-10-13T00:00:00.000Z",
        compactMetadata: {
          trigger: "manual",
          preTokens: 8000,
          postTokens: 1000,
          preservedSegment: {
            headUuid: ids[1],
            tailUuid: ids[1],
            anchorUuid: ids[3],
          },
          preservedMessages: {
            anchorUuid: ids[3],
            uuids: [ids[1]],
            allUuids: [ids[1]],
          },
        },
      },
      {
        ...row(ids[3]!, ids[2]!, "user", "COMPACT_SUMMARY"),
        isCompactSummary: true,
      },
    );
  rows.push(
    row(
      ids[4]!,
      compact === "anchor" ? ids[3]! : ids[1]!,
      "user",
      "NEXT_QUESTION",
    ),
    row(ids[5]!, ids[4]!, "assistant", "NEXT_REPLY"),
  );
  const path = join(directory, sourceId + ".jsonl");
  const original = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(path, original);
  return { cwd, config, directory, path, original, ids };
}

test("Claude offline copy preserves compacted history references and source, with isolated per-copy environments", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-claude-copy-"));
  try {
    const sourceId = randomUUID();
    const fixtures = await Promise.all(
      ([false, "anchor", "tail"] as const).map(async (compact, i) => {
        const dir = join(root, String(i));
        await mkdir(dir);
        return fixture(dir, sourceId, `MARKER_${i}`, compact);
      }),
    );
    const children = await Promise.all(
      fixtures.map((f) =>
        copyClaudeSession({
          executable: "/not-a-cli",
          cwd: f.cwd,
          env: {
            PATH: process.env.PATH,
            HOME: root,
            CLAUDE_CONFIG_DIR: f.config,
          },
          sourceId,
        }),
      ),
    );
    for (const [i, f] of fixtures.entries()) {
      const id = children[i]!;
      assert.notEqual(id, sourceId);
      assert.equal(await readFile(f.path, "utf8"), f.original);
      const raw = await readFile(join(f.directory, id + ".jsonl"), "utf8");
      assert.ok(raw.includes(`MARKER_${i}`));
      for (let j = 0; j < fixtures.length; j++)
        if (j !== i) assert.ok(!raw.includes(`MARKER_${j}`));
      const rows = raw
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const ids = new Set(rows.map((r) => r.uuid).filter(Boolean));
      for (const oldId of f.ids) assert.ok(!ids.has(oldId));
      const boundary = rows.find((r) => r.subtype === "compact_boundary");
      if (i > 0) {
        assert.ok(boundary, "compaction checkpoint must survive");
        const meta = boundary.compactMetadata;
        for (const ref of [
          ...Object.values(meta.preservedSegment),
          meta.preservedMessages.anchorUuid,
          ...meta.preservedMessages.uuids,
          ...meta.preservedMessages.allUuids,
        ])
          assert.ok(
            ids.has(ref),
            "nested compaction references must address the fork",
          );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude missing source refuses without launching a CLI or returning a replacement session", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-claude-missing-"));
  try {
    await assert.rejects(
      copyClaudeSession({
        executable: "/not-a-cli",
        cwd: root,
        env: { HOME: root, CLAUDE_CONFIG_DIR: root },
        sourceId: randomUUID(),
      }),
      /Claude native session copy failed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
