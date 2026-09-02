import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "packages", "raft-ui-snapshot");
const outputRoot = join(repositoryRoot, "packages", "ui-tokens", "generated");
const snapshotManifest = JSON.parse(
  readFileSync(join(snapshotRoot, "snapshot-manifest.json"), "utf8"),
);
const snapshotFiles = new Map(
  snapshotManifest.files.map((entry) => [entry.path, entry]),
);
const sourcePaths = [
  "activity.css",
  "channel-extras.css",
  "generated/raft-icons.svg",
  "generated/raft-official-activity.css",
  "generated/raft-official-avatar-pack.json",
  "generated/raft-official-computers.css",
  "generated/raft-official-members-page.css",
  "generated/raft-official-overlays.css",
  "generated/raft-official-tasks.css",
  "generated/raft-official-tokens.css",
  "search.css",
  "styles.css",
  "tokens.brutal.css",
  "vendor/raft/fonts/raft-quote-glyphs.woff2",
  "vendor/raft/fonts/space-grotesk-latin.woff2",
  "vendor/raft/fonts/space-mono-400-latin.woff2",
  "vendor/raft/fonts/space-mono-700-latin.woff2",
  "vendor/raft/official-fonts.css",
];

const files = sourcePaths.map((sourcePath) => {
  const source = join(snapshotRoot, "reference", sourcePath);
  const content = readFileSync(source);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const evidence = snapshotFiles.get(sourcePath);
  if (
    evidence === undefined ||
    evidence.bytes !== content.byteLength ||
    evidence.sha256 !== sha256
  ) {
    throw new Error(`Raft snapshot evidence mismatch: ${sourcePath}`);
  }
  const outputPath = sourcePath;
  const output = join(outputRoot, outputPath);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(source, output);
  return { bytes: content.byteLength, outputPath, sha256, sourcePath };
});

mkdirSync(outputRoot, { recursive: true });
writeFileSync(
  join(outputRoot, "generated-manifest.json"),
  `${JSON.stringify(
    {
      files,
      schemaVersion: 1,
      source: snapshotManifest.source,
    },
    null,
    2,
  )}\n`,
);
