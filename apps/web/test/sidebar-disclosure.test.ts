import assert from "node:assert/strict";
import test from "node:test";
import {
  readSidebarDisclosure,
  writeSidebarDisclosure,
} from "../src/sidebar-disclosure.ts";
import * as preferences from "../src/settings-preferences.ts";

test("sidebar disclosure survives reload but expires on host restart and stays scoped", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } as Storage;
  assert.deepEqual(
    readSidebarDisclosure(storage, "workspace:human", "boot1"),
    {},
  );
  writeSidebarDisclosure(storage, "workspace:human", "boot1", {
    channels: false,
    pinned: true,
  });
  assert.deepEqual(readSidebarDisclosure(storage, "workspace:human", "boot1"), {
    channels: false,
    pinned: true,
  });
  assert.deepEqual(
    readSidebarDisclosure(storage, "workspace:other", "boot1"),
    {},
  );
  assert.deepEqual(
    readSidebarDisclosure(storage, "workspace:human", "boot2"),
    {},
  );
  const denied = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
  } as unknown as Storage;
  assert.deepEqual(readSidebarDisclosure(denied, "w", "b"), {});
  assert.doesNotThrow(() =>
    writeSidebarDisclosure(denied, "w", "b", { channels: false }),
  );
  for (const key of values.keys())
    values.set(key, '{"instanceId":"boot1","choices":{"channels":"false"}}');
  assert.deepEqual(
    readSidebarDisclosure(storage, "workspace:human", "boot1"),
    {},
  );
});

test("hide-empty preference defaults off and survives reload independently of disclosure", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } as Storage;
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { dataset: {} } },
  });
  try {
    assert.equal(preferences.readHideEmptySidebarSections(storage), false);
    assert.equal(
      preferences.writeHideEmptySidebarSections(storage, true),
      true,
    );
    assert.equal(preferences.readHideEmptySidebarSections(storage), true);
    preferences.applySettingsPreferences(storage);
    assert.equal(
      document.documentElement.dataset.rahHideEmptySidebarSections,
      "true",
    );
  } finally {
    if (prior) Object.defineProperty(globalThis, "document", prior);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
