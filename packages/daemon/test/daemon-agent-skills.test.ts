import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSkillsConfiguration,
  createDaemonAgentSkillsReader,
} from "../src/daemon-agent-skills.ts";

test("Skills environment follows the launch overlay without reading credential slots", () => {
  const revision = {
    manifest: {
      manifestVersion: 3,
      staticEnv: {
        HOME: "/actual-home",
        CODEX_HOME: "/actual-codex",
        IGNORED_SECRET: "never disclose",
      },
      credentialSlots: [],
    },
  };
  const probe = { reportVersion: 2, modelBindings: [] };
  assert.deepEqual(
    resolveSkillsConfiguration(revision as never, probe as never, {
      HOME: "/default",
      CODEX_HOME: "/inherited",
    }),
    { known: true, home: "/actual-home", codexHome: "/actual-codex" },
  );
  assert.equal(
    resolveSkillsConfiguration(
      {
        manifest: {
          ...revision.manifest,
          credentialSlots: [{ target: { variable: "HOME" } }],
        },
      } as never,
      probe as never,
      {},
    ).known,
    false,
  );
  assert.equal(
    resolveSkillsConfiguration(
      revision as never,
      {
        reportVersion: 2,
        modelBindings: [
          {
            adapterMapping: {
              config: { reasoningEnvironment: ["CODEX_HOME", "{reasoning}"] },
            },
          },
        ],
      } as never,
      {},
    ).known,
    false,
  );
});

test("Skills reader selects only the exact current policy offer and Agent root, never the runtime cwd", async () => {
  const calls: unknown[] = [];
  const read = createDaemonAgentSkillsReader({
    coordinator: {
      workspaceRoots: async (owner: string) => {
        calls.push(owner);
        return {
          roots: [
            { rootId: "agent-workspace", rootPath: "/agent-private" },
            { rootId: "runtime-project", rootPath: "/project" },
          ],
        };
      },
    } as never,
    configured: [
      {
        runtimeOfferId: "codex-offer",
        cliId: "codex",
        skillsConfiguration: { known: true, home: "/human" },
      },
    ] as never,
    scan: async (input) => {
      calls.push(input);
      return {
        global: { state: "ready", skills: [], truncated: false, issues: [] },
        workspace: { state: "ready", skills: [], truncated: false, issues: [] },
      };
    },
  });
  const policy = {
    executionPolicyRevisionId: "policy-1",
    required: { allowedOfferIds: ["codex-offer"] },
  };
  assert.equal((await read("alice", policy as never)).cliId, "codex");
  assert.deepEqual(calls, [
    "alice",
    { cliId: "codex", home: "/human", workspaceRoot: "/agent-private" },
  ]);
  assert.equal(
    (
      await read("alice", {
        ...policy,
        required: { allowedOfferIds: ["unknown"] },
      } as never)
    ).global.issues[0],
    "unresolved_runtime",
  );
  assert.equal(calls.length, 2, "unresolved policy must not perform Host I/O");
});
