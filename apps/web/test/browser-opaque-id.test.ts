import assert from "node:assert/strict";
import test from "node:test";
import { browserOpaqueId } from "../src/browser-opaque-id.ts";
test("HTTP browsers generate fresh IDs without secure-context randomUUID", () => {
  const cryptoWithoutRandomUUID = {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  };
  const ids = new Set(
    Array.from({ length: 100 }, () => browserOpaqueId(cryptoWithoutRandomUUID)),
  );
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[a-f0-9-]{32,36}$/u);
});
