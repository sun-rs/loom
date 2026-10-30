import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRelease } from "./release-integrity.mjs";

export async function withPinnedRelease(run) {
  const root = resolve(
    fileURLToPath(
      new URL("../../frontends/raft/upstream/releases/", import.meta.url),
    ),
  );
  const metadata = JSON.parse(
    readFileSync(join(root, "raft-web-1.21.40-distribution.json"), "utf8"),
  );
  if (metadata.archive !== "raft-web-1.21.40-distribution.tar.gz")
    throw Error("Unexpected release archive path");
  const archive = join(root, metadata.archive);
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  if (digest(readFileSync(archive)) !== metadata.sha256)
    throw Error("Pinned distribution archive hash mismatch");
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  if (
    entries.some(
      (name) =>
        !/^(?:files\/[^\\]+|release-lock\.json)$/.test(name) ||
        name.split("/").some((part) => part === ".." || part === "."),
    )
  )
    throw Error("Unsafe release archive member");
  const directory = mkdtempSync(join(tmpdir(), "loom-native-release-fixture-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", directory]);
    if (
      digest(readFileSync(join(directory, "release-lock.json"))) !==
      metadata.lockSha256
    )
      throw Error("Pinned release lock mismatch");
    const verification = verifyRelease(directory, {
      releaseId: metadata.release.releaseId,
    });
    return await run({ directory, metadata, verification });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await withPinnedRelease(async ({ metadata, verification }) =>
    console.log(JSON.stringify({ metadata, verification }, null, 2)),
  );
