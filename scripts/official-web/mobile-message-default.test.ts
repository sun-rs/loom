import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { adaptMobileMessageDefault } from "../../frontends/raft/loom/mobile-message-default.ts";
test("mobile default is 14px only when no explicit size exists; desktop and user choice retained", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/store/appearanceStore.ts",
    "utf8",
  );
  const result = adaptMobileMessageDefault(source);
  const expression = result.match(
    /return normalizeMessageBodyFontSize\(([^;]+)\);/,
  )![1];
  const evaluate = (value: string | null, mobile: boolean) =>
    runInNewContext(expression, {
      localStorage: { getItem: () => value },
      MESSAGE_BODY_FONT_SIZE_STORAGE_KEY: "size",
      window: { matchMedia: () => ({ matches: mobile }) },
    });
  assert.equal(evaluate(null, true), "sm");
  assert.equal(evaluate(null, false), null);
  for (const size of ["sm", "md", "lg"])
    assert.equal(evaluate(size, true), size);
  assert.throws(() => adaptMobileMessageDefault("changed"));
});
