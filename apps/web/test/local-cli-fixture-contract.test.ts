import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const fixtureSource = readFileSync(
  join(import.meta.dirname, "../../../scripts/run-local-cli-web-fixture.mjs"),
  "utf8",
);
const runtimeSpecSource = readFileSync(
  join(
    import.meta.dirname,
    "../../../packages/daemon/src/local-cli-runtime-spec.ts",
  ),
  "utf8",
);

test("local CLI Agent catalog belongs to the product Workspace", () => {
  assert.match(
    fixtureSource,
    /const catalogRoom = productWorkspace\.controlRoom;/u,
  );
  assert.doesNotMatch(fixtureSource, /const catalogWorkspace =/u);
  assert.match(
    fixtureSource,
    /const hostId = `local-cli-web-host-\$\{String\(process\.pid\)\}`/u,
  );
  assert.match(
    fixtureSource,
    /workspaceDefinitionId: productWorkspace\.workspace\.workspaceId/u,
  );
  assert.match(fixtureSource, /localCliRuntimeSpec/u);
  assert.match(runtimeSpecSource, /RAH_AGENT_CONTEXT_JSON/u);
});

test("local CLI fixture exposes a same-origin Web entry without announcing a token", () => {
  assert.match(fixtureSource, /RAH_DEV_ACCESS_TOKEN: human\.accessToken/u);
  assert.match(fixtureSource, /webOrigin:/u);
  assert.doesNotMatch(fixtureSource, /humanAccessToken:/u);
});
