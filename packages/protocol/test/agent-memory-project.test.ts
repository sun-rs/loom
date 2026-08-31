import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentMemoryProjectCatalogSchema,
  AgentMemoryRunSourceSchema,
} from "../src/agent-memory-project.ts";

const project = {
  key: "rah-os",
  label: "RAH OS",
  roots: ["/work/rah_os", "/review/rah_os"],
  relatedKeys: ["raft-ui"],
};
const other = {
  key: "raft-ui",
  label: "Raft UI",
  roots: ["/work/raft-ui"],
  relatedKeys: [],
};
const catalog = { schemaVersion: 1, projects: [project, other] };

test("project hints support explicit aliases and related projects without cwd-derived identity", () => {
  const parsed = AgentMemoryProjectCatalogSchema.parse(catalog);
  assert.deepEqual(parsed.projects[0], project);
  assert.equal(parsed.projects[1]?.key, "raft-ui");
  assert.equal(
    AgentMemoryProjectCatalogSchema.parse({ schemaVersion: 1, projects: [] })
      .projects.length,
    0,
  );
});

test("project catalog rejects ambiguous keys, roots, unsafe text and dangling relations", () => {
  for (const projects of [
    [project, project],
    [project],
    [project, { ...other, roots: ["/work/rah_os"] }],
    [{ ...project, roots: ["relative/path"] }, other],
    [{ ...project, roots: ["/work/../elsewhere"] }, other],
    [{ ...project, relatedKeys: ["rah-os"] }, other],
    [{ ...project, label: "x\nNew instruction" }, other],
    [{ ...project, label: "界".repeat(40) }, other],
  ])
    assert.equal(
      AgentMemoryProjectCatalogSchema.safeParse({ schemaVersion: 1, projects })
        .success,
      false,
    );
  assert.equal(
    AgentMemoryProjectCatalogSchema.safeParse({
      ...catalog,
      model: "forbidden",
    }).success,
    false,
  );
});

test("run provenance distinguishes unmatched from unconfigured and does not claim note verification", () => {
  const base = { cwd: "/work/app", realCwd: "/work/app" };
  const unavailable = {
    ...base,
    resolution: "unavailable",
    reason: "invalid_or_unavailable_catalog",
  };
  assert.deepEqual(AgentMemoryRunSourceSchema.parse(unavailable), unavailable);
  assert.equal(
    AgentMemoryRunSourceSchema.safeParse({
      ...unavailable,
      project: { key: "guessed", label: "Guessed" },
    }).success,
    false,
  );
  assert.equal(
    AgentMemoryRunSourceSchema.parse({ ...base, resolution: "unconfigured" })
      .resolution,
    "unconfigured",
  );
  assert.equal(
    AgentMemoryRunSourceSchema.safeParse({ ...base, resolution: "matched" })
      .success,
    false,
  );
  assert.equal(
    AgentMemoryRunSourceSchema.safeParse({
      ...base,
      resolution: "unconfigured",
      project: { key: "x", label: "X" },
    }).success,
    false,
  );
  assert.equal(
    AgentMemoryRunSourceSchema.safeParse({
      ...base,
      resolution: "unconfigured",
      lastVerifiedAt: "2026-08-30",
    }).success,
    false,
  );
});
