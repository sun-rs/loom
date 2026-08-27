import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("production Web auth can use a trusted same-origin gateway without embedding a PAT", () => {
  const app = readFileSync(join(import.meta.dirname, "../src/App.tsx"), "utf8");
  const vite = readFileSync(
    join(import.meta.dirname, "../vite.config.ts"),
    "utf8",
  );
  assert.match(vite, /RAH_WEB_TRUSTED_PROXY_AUTH/u);
  assert.match(app, /__RAH_TRUSTED_PROXY_AUTH__/u);
  assert.match(app, /trusted-proxy-auth/u);
  assert.doesNotMatch(app, /RAH_WEB_TRUSTED_PROXY_AUTH/u);
});
