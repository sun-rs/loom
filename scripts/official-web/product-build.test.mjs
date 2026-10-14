import assert from "node:assert/strict";
import test from "node:test";
import { assertOfficialFrontendReady } from "../build-product-web.mjs";
test("unconnected official UI cannot silently become the installed Loom product", () => {
  assert.throws(
    () => assertOfficialFrontendReady({ productConnected: false }),
    /not connected/,
  );
  assert.throws(() => assertOfficialFrontendReady({}), /not connected/);
  assert.doesNotThrow(() =>
    assertOfficialFrontendReady({ productConnected: true }),
  );
});
