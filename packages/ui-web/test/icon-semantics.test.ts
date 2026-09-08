import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { iconName } from "../src/neo-brutalist/icon-name.ts";

test("folder, menu, sharing and links retain the official semantic glyph", () => {
  for (const [requested, expected] of [
    ["folder", "folder-closed"],
    ["menu", "menu"],
    ["share-2", "share-2"],
    ["link", "link"],
    ["play", "play"],
    ["globe", "globe"],
  ]) {
    assert.equal(iconName(requested!), expected, requested);
    const sprite = readFileSync(
      new URL("../../ui-tokens/src/interaction-icons.svg", import.meta.url),
      "utf8",
    );
    assert.ok(
      sprite.includes(`id="raft-icon-${expected}"`),
      `actual SVG symbol exists for ${requested}`,
    );
  }
});

test("Skills globe has the current official geometry and uses the maintained sprite", () => {
  const sprite = readFileSync(
    new URL("../../ui-tokens/src/interaction-icons.svg", import.meta.url),
    "utf8",
  );
  const globe = sprite.match(
    /<symbol id="raft-icon-globe"[\s\S]*?<\/symbol>/,
  )?.[0];
  assert.ok(globe);
  assert.ok(globe.includes('<circle cx="12" cy="12" r="10"'));
  assert.ok(
    globe.includes('d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"'),
  );
  assert.ok(globe.includes('d="M2 12h20"'));
  const component = readFileSync(
    new URL("../src/neo-brutalist/icon.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /\["globe", "play"/);
});
