import { readFile, writeFile } from "node:fs/promises";

import {
  createNodeKCarrierComputerUpgradeProcessRunner,
  readNodeKCarrierComputerUpgradeProcessConfiguration,
} from "../../src/index.ts";

const requestPath = process.argv[2];
if (
  typeof requestPath !== "string" ||
  !process.argv.includes("--config-fd=3")
) {
  process.exit(2);
}

const configuration = readNodeKCarrierComputerUpgradeProcessConfiguration(3);
const manifest = JSON.parse(
  await readFile(`${requestPath}.release-manifest.json`, "utf8"),
);
const artifact = await readFile(`${requestPath}.release-artifact`);
const releaseFetch = async (input) => {
  const url = input.toString();
  if (url.endsWith("/manifest.json")) {
    return new Response(JSON.stringify(manifest), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(artifact, {
    headers: { "content-type": "application/octet-stream" },
  });
};

try {
  const result = await createNodeKCarrierComputerUpgradeProcessRunner(
    configuration,
    { fetch: releaseFetch },
  ).run();
  await writeFile(
    `${requestPath}.process-result`,
    `${JSON.stringify({ result })}\n`,
    { mode: 0o600 },
  );
} catch (error) {
  await writeFile(
    `${requestPath}.process-result`,
    `${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
    { mode: 0o600 },
  );
  process.exitCode = 1;
}
