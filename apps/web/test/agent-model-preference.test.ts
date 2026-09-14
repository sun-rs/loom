import assert from "node:assert/strict";
import test from "node:test";
import * as preferences from "../src/settings-preferences.ts";

test("model name preference defaults off in Web and persists explicit choices", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  } as unknown as Storage;
  const document = {
    documentElement: { dataset: {} as Record<string, string> },
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  try {
    assert.equal(preferences.readAgentModelName(storage), false);
    for (const value of [true, false]) {
      assert.equal(preferences.writeAgentModelName(storage, value), true);
      assert.equal(preferences.readAgentModelName(storage), value);
      preferences.applySettingsPreferences(storage);
      assert.equal(
        document.documentElement.dataset.rahAgentModelName,
        String(value),
      );
    }
    const unavailable = {
      getItem() {
        throw Error("denied");
      },
      setItem() {
        throw Error("quota");
      },
    } as unknown as Storage;
    assert.equal(preferences.readAgentModelName(unavailable), false);
    assert.equal(preferences.writeAgentModelName(unavailable, true), false);
    assert.equal(document.documentElement.dataset.rahAgentModelName, "true");
  } finally {
    if (prior) Object.defineProperty(globalThis, "document", prior);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
