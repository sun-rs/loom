import assert from "node:assert/strict";
import test from "node:test";

import {
  currentWebBuildId,
  isStaleWebBuildError,
  recoveryUrl,
  webBuildCacheNames,
} from "../src/web-build-recovery.ts";

test("reads the immutable build identity embedded in the served HTML", () => {
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: () => ({ content: "  content-derived-build  " }),
    },
  });
  try {
    assert.equal(currentWebBuildId(), "content-derived-build");
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
});

test("classifies the dynamic import failures emitted by Vite and major browsers", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: /assets/old.js",
    "Error loading dynamically imported module: /assets/old.js",
    "Importing a module script failed.",
    "Failed to load module script: Expected a JavaScript-or-Wasm module script",
    "Loading chunk 12 failed",
  ]) {
    assert.equal(isStaleWebBuildError(new TypeError(message)), true, message);
  }
  assert.equal(
    isStaleWebBuildError(new Error("message payload was invalid")),
    false,
  );
});

test("recovery keeps typed navigation while replacing an old recovery nonce", () => {
  assert.equal(
    recoveryUrl(
      "http://127.0.0.1:4173/?room=room-1&task=task-1&rah_recover=old#detail",
      42,
    ),
    "http://127.0.0.1:4173/?room=room-1&task=task-1&rah_recover=42#detail",
  );
});

test("cache cleanup is limited to RAH OS shell generations", () => {
  assert.deepEqual(
    webBuildCacheNames([
      "rah-os-shell-v1",
      "rah-os-assets-build-2",
      "third-party-cache",
      "other-rah-os-data",
    ]),
    ["rah-os-shell-v1", "rah-os-assets-build-2"],
  );
});
