import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareUiSource } from "../../frontends/raft/scripts/prepare-ui-source.mjs";
test("npm-hoisted official UI remains discoverable at the upstream Tailwind source path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-official-assets-"));
  try {
    const source = join(dir, "node_modules/raft-ui");
    const web = join(dir, "packages/web");
    await mkdir(source, { recursive: true });
    await mkdir(web, { recursive: true });
    await writeFile(join(source, "source.txt"), "official");
    await prepareUiSource(web, source);
    await prepareUiSource(web, source);
    assert.equal(
      await realpath(join(web, "node_modules/raft-ui")),
      await realpath(source),
    );
    assert.equal(
      await readFile(join(web, "node_modules/raft-ui/source.txt"), "utf8"),
      "official",
    );
    const other = join(dir, "other");
    await mkdir(other);
    await assert.rejects(prepareUiSource(web, other), /different/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
