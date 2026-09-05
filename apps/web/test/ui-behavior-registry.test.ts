import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  validateRegistry,
  renderRegistry,
} from "../../../scripts/ui-behavior-registry.mjs";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const registry = JSON.parse(
  read("docs/product/ui-behavior-registry.json").toString(),
);

test("registry is complete, source-pinned and its human index is generated", async () => {
  assert.deepEqual(validateRegistry(registry, read), []);
  assert.equal(
    read("docs/product/raft-behavior-inventory.zh-CN.md").toString(),
    await renderRegistry(registry),
  );
  assert.equal(
    registry.behaviors.filter((row: { id: string }) => /^B\d{3}$/.test(row.id))
      .length,
    74,
  );
});

test("manual official observations remain hash-pinned without masquerading as published source", () => {
  const observation = registry.sources.find(
    (source: { id: string }) =>
      source.id === "raft-settings-live-observation-20260905",
  );
  assert.equal(observation?.kind, "official-observation");
  assert.match(observation?.sha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.ok(
    registry.behaviors
      .find((behavior: { id: string }) => behavior.id === "UI010")
      ?.evidenceSources.includes(observation.id),
  );
  const payload = JSON.parse(read(observation.path).toString());
  assert.match(payload.routeNormalization, /slug omitted/u);
  assert.equal(
    payload.routes.every(
      (route: { routeSuffix?: string; route?: string }) =>
        route.route === undefined &&
        route.routeSuffix?.startsWith("/settings/"),
    ),
    true,
  );
  const forbiddenKeys = new Set([
    "cookie",
    "email",
    "principalId",
    "session",
    "token",
    "user",
    "username",
    "workspaceSlug",
  ]);
  const visit = (value: unknown): boolean =>
    value !== null && typeof value === "object"
      ? Object.entries(value).some(
          ([key, child]) => forbiddenKeys.has(key) || visit(child),
        )
      : false;
  assert.equal(visit(payload), false, "observation contains private key");
});

for (const [name, mutate, expected] of [
  [
    "source hash drift",
    (r: any) => {
      r.sources[0].sha256 = "0".repeat(64);
    },
    /hash/,
  ],
  [
    "reference cannot become official",
    (r: any) => {
      r.adoptions.find((a: any) => a.kind === "reference-reconstruction").kind =
        "official-original";
    },
    /official/,
  ],
  [
    "wrong extraction landmark",
    (r: any) => {
      r.adoptions.find((a: any) => a.kind === "extracted-port").needles = [
        "invented-function()",
      ];
    },
    /landmark/,
  ],
  [
    "missing owner",
    (r: any) => {
      r.behaviors[0].owners = ["not-a-file.ts"];
    },
    /owner/,
  ],
  [
    "duplicate identity",
    (r: any) => {
      r.behaviors.push(r.behaviors[0]);
    },
    /duplicate/,
  ],
  [
    "legacy intent deletion",
    (r: any) => {
      // UI-only records can precede the frozen legacy intents; target the ID.
      r.behaviors = r.behaviors.filter((b: any) => b.id !== "B001");
    },
    /legacy/,
  ],
  [
    "missing browser scenario",
    (r: any) => {
      r.behaviors.find((b: any) => b.scenarios.length).scenarios = ["invented"];
    },
    /scenario/,
  ],
  [
    "missing observation source",
    (r: any) => {
      r.behaviors[0].evidenceSources = ["invented-observation"];
    },
    /evidence source/,
  ],
  [
    "unproven current pass",
    (r: any) => {
      r.behaviors[0].status = "verified";
    },
    /status/,
  ],
  [
    "escaping path",
    (r: any) => {
      r.sources[0].path = "../../outside";
    },
    /path/,
  ],
] as const) {
  test(`registry rejects ${name}`, () => {
    const changed = structuredClone(registry);
    mutate(changed);
    assert.match(validateRegistry(changed, read).join("\n"), expected);
  });
}
