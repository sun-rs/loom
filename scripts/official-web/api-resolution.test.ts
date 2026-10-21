import test from "node:test";
import assert from "node:assert/strict";
import { resolveOfficialApi } from "../../frontends/raft/loom/api-resolution.ts";
const root = "/workspace/frontends/raft";
test("every relative import of the official transport binds to the Loom facade", () => {
  for (const [source, importer] of [
    ["./client", "/api/overloadRetry.ts"],
    ["./client.ts", "/api/overloadRetry.ts"],
    ["../api/client", "/store/messageStore.ts"],
    ["../../api/client.ts", "/components/message/MessageItem.tsx"],
  ] as const)
    assert.equal(
      resolveOfficialApi(
        source,
        root + "/packages/web/src" + importer,
        root + "/loom",
      ),
      root + "/loom/upstream-api.ts",
    );
});
test("unrelated clients and the Loom facade remain untouched", () => {
  for (const [source, importer] of [
    ["./client", "/packages/web/src/other/reader.ts"],
    ["./client", "/loom/reader.ts"],
    ["./client-sdk", "/packages/web/src/api/reader.ts"],
  ] as const)
    assert.equal(
      resolveOfficialApi(source, root + importer, root + "/loom"),
      null,
    );
});
