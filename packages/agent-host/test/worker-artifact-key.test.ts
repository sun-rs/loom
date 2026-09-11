import assert from "node:assert/strict";
import { mkdtemp, open, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deriveArtifactPublicationKey } from "../src/worker-artifact-key.ts";

test("artifact keys stay stable for same Run/content retries and differ for changed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-artifact-key-"));
  const path = join(root, "evidence.txt");
  const key = async (runAttemptId = "run-1") => {
    const file = await open(path, "r");
    try {
      return await deriveArtifactPublicationKey({
        file,
        runAttemptId,
        taskId: "task-1",
        filename: "evidence.txt",
        mimeType: "text/plain",
        size: 3,
      });
    } finally {
      await file.close();
    }
  };
  try {
    await writeFile(path, "one");
    const first = await key();
    assert.equal(await key(), first);
    assert.notEqual(await key("run-2"), first);
    await writeFile(path, "two");
    assert.notEqual(await key(), first);
    assert.match(first, /^artifact:[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("artifact auto key refuses absent Run identity or changed file size", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-artifact-key-"));
  const path = join(root, "evidence.txt");
  await writeFile(path, "abc");
  const file = await open(path, "r");
  try {
    const input = {
      file,
      taskId: "task-1",
      filename: "evidence.txt",
      mimeType: "text/plain",
      size: 2,
    };
    await assert.rejects(
      deriveArtifactPublicationKey({ ...input, runAttemptId: undefined }),
      /Run/,
    );
    await assert.rejects(
      deriveArtifactPublicationKey({ ...input, runAttemptId: "run" }),
      /changed/,
    );
  } finally {
    await file.close();
    await rm(root, { recursive: true, force: true });
  }
});
