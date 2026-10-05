import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test, { mock } from "node:test";

const filename = fileURLToPath(import.meta.url);
if (process.env.LOOM_RAH_HOOK_CHILD !== "1") {
  test("rahArm business instructions and pre-round admission use real Role persistence", () => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-test-module-mocks", "--test", filename],
      {
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: undefined,
          LOOM_RAH_HOOK_CHILD: "1",
        },
        encoding: "utf8",
        timeout: 20000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /tests 3/u,
      "child test runner really executed all cases",
    );
  });
} else {
  const { roleInstanceFixture } =
    await import("../../packages/kernel/test/role-instance-fixture.ts");
  const { instructions } = await import("./common.mjs");
  let gate;
  mock.module(new URL("./gate-daemon.mjs", import.meta.url).href, {
    namedExports: { prepareGateDaemon: async () => gate },
  });
  const { rahArm } = await import("./rah.mjs");
  for (const custom of [
    undefined,
    "Only discuss the explicit user task; do not inspect source files.",
    null,
  ]) {
    test(`real Role stores ${custom === null ? "default without hook" : custom === undefined ? "default" : "custom"} instructions; denied admission sends no message and cleans up`, async () => {
      const f = roleInstanceFixture();
      const directory = dirname(
        f.db
          .prepare("PRAGMA database_list")
          .all()
          .find((row) => row.name === "main").file,
      );
      let stopped = 0,
        sent = 0,
        createdRole,
        admitted = 0;
      const escaped = new Error("FAKE stop at Human message boundary");
      const refusal = new Error("FAKE preregistered resource ceiling reached");
      gate = {
        spec: { runtimeProfileId: "profile", reasoning: "low" },
        prepared: {
          humanAccessToken: f.owner.accessToken,
          metadata: {
            controlRoomId: f.controlRoomId,
            workspaceId: f.workspace.workspace.workspaceId,
          },
          config: { workspace: { workspaceMountRevisionId: "mount" } },
        },
        stateDirectory: directory,
        start: async () => {},
        stop: async () => {
          stopped++;
          return { code: 0 };
        },
        head: async (id) => f.head(id),
        post: async (route, body) => {
          if (route === "/v1/local/runtimes/list")
            return {
              runtimes: [
                {
                  runtimeProfileId: "profile",
                  runtimeOfferId: "offer",
                  modelBindingDescriptors: [
                    {
                      modelBindingId: "binding",
                      modelId: "gpt-6-luna",
                      supportedReasoning: ["low"],
                    },
                  ],
                },
              ],
            };
          if (route === "/v3/client/rooms/create")
            return { room: f.kernel.createWorkspaceRoom(f.actor, body).room };
          if (route === "/v3/client/roles/create") {
            const value = f.kernel.roles.create(f.actor, body);
            createdRole = value.role;
            return value;
          }
          if (route === "/v3/client/roles/instantiate")
            return {
              instance: f.instance,
              agent: { definition: { agentId: f.agentId } },
            };
          if (route === "/v3/client/messages/post") {
            sent++;
            throw escaped;
          }
          throw Error(`Unexpected route ${route}`);
        },
      };
      const arm = { rounds: [], processes: [] };
      try {
        await assert.rejects(
          rahArm({
            kind: "role",
            root: directory,
            cwd: directory,
            questions: ["one"],
            arm,
            save() {},
            config: {
              provider: "codex",
              model: "gpt-6-luna",
              effort: "low",
              bindingId: "binding",
            },
            ...(typeof custom !== "string"
              ? {}
              : { businessInstructions: custom }),
            ...(custom === null
              ? {}
              : {
                  beforeRound: async ({ round, arm: observed }) => {
                    assert.equal(round, 1);
                    assert.equal(observed, arm);
                    await Promise.resolve();
                    admitted++;
                    throw refusal;
                  },
                }),
          }),
          (e) => e === (custom === null ? escaped : refusal),
        );
        assert.equal(admitted, custom === null ? 0 : 1);
        assert.equal(sent, custom === null ? 1 : 0);
        assert.equal(stopped, 1);
        assert.equal(arm.rounds.length, custom === null ? 1 : 0);
        assert.ok(createdRole);
        const rows = f.db
          .prepare("SELECT snapshot_json FROM role_revisions WHERE role_id=?")
          .all(createdRole.roleId);
        assert.equal(rows.length, 1);
        assert.equal(
          JSON.parse(rows[0].snapshot_json).configuration.instructions,
          custom ?? instructions,
        );
      } finally {
        f.close();
      }
    });
  }
}
