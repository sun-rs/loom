import { mkdir, realpath, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Preserve upstream CSS @source ../node_modules/raft-ui/dist with npm hoisting.
// No source rewrite and no replacement of an existing package installation.
export async function prepareUiSource(webRoot, packageRoot) {
  const actual = await realpath(packageRoot);
  const target = join(webRoot, "node_modules/raft-ui");
  try {
    if ((await realpath(target)) !== actual) {
      throw new Error("Official UI source path points to a different package");
    }
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  await symlink(
    relative(await realpath(dirname(target)), actual),
    target,
    "dir",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const webRoot = resolve(import.meta.dirname, "../packages/web");
  const require = createRequire(join(webRoot, "package.json"));
  await prepareUiSource(
    webRoot,
    dirname(require.resolve("raft-ui/package.json")),
  );
}
