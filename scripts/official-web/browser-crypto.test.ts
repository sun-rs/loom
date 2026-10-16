import test from "node:test";
import assert from "node:assert/strict";
import { installBrowserUuid } from "../../frontends/raft/loom/browser-crypto.ts";
test("HTTP trusted origin gets RFC4122 UUIDs from secure random bytes, preserving native implementation", () => {
  let fills = 0;
  const crypto: any = {
    getRandomValues: (bytes: Uint8Array) => {
      fills++;
      bytes.fill(255);
      return bytes;
    },
  };
  installBrowserUuid(crypto);
  assert.equal(crypto.randomUUID(), "ffffffff-ffff-4fff-bfff-ffffffffffff");
  assert.equal(fills, 1);
  const native = () => "native";
  const secure: any = { randomUUID: native };
  installBrowserUuid(secure);
  assert.equal(secure.randomUUID, native);
});
