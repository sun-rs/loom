// FIXTURE ONLY: real Kernel, application service and gateway; fake native-copy and run adapters, no CLI/model.
import { resolve } from "node:path";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../../packages/application-service/src/index.ts";
import { LocalWorkbenchGateway } from "../../packages/daemon/src/local-workbench-gateway.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../packages/kernel/test/role-instance-fixture.ts";
const f = roleInstanceFixture();
let service, gateway;
let copies = 0,
  side;
const offer = JSON.parse(
  f.db
    .prepare(
      "SELECT offer_json FROM runtime_offers WHERE runtime_offer_id='offer'",
    )
    .get().offer_json,
);
for (const key of [
  "acceptedAt",
  "resolvedCertifications",
  "runtimeOfferObservationId",
  "runtimeOfferSnapshotDigest",
])
  delete offer[key];
f.kernel.publishRuntimeOffer(f.host, {
  ...offer,
  supportsAgentPrivateWorkspace: true,
  observedAt: new Date(Date.now() + 1).toISOString(),
});
const previous = JSON.parse(
  f.db
    .prepare(
      "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id=?",
    )
    .get(f.revisionId).definition_json,
);
f.kernel.reviseAgentDefinition(f.actor, {
  ...previous,
  agentId: f.agentId,
  executionWorkspace: { kind: "channel_home", roomId: f.home.roomId },
  basedOnRoomSeq: f.head(f.controlRoomId),
  idempotencyKey: "fixture-home-binding",
});
const run = startInstanceRun(f);
f.kernel.instanceSessions.record(f.host, {
  runAttemptId: run.run.runAttemptId,
  runtimeRunId: run.runtime.runtimeRunId,
});
f.kernel.postWorkerMessage(run.execution, {
  body: "FIXTURE sender action entry",
  basedOnRoomSeq: run.scope.toSeq,
  idempotencyKey: "sender-action-message",
});
run.finish(0);
// Test-only permission projection: exercise ordinary-editor drop restrictions.
// Actual allowed task updates still execute through the real Kernel.
const human = createHumanApplicationPort(f.kernel);
service = new ClientApplicationService({
  human: {
    ...human,
    listGlobalTasks: (actor, input) => {
      const result = human.listGlobalTasks(actor, input);
      return {
        ...result,
        tasks: result.tasks.map((row) => ({ ...row, canManageAnyTask: false })),
      };
    },
  },
  health: () => {
    throw Error("not used");
  },
  localRuntimeInventory: () => ({
    hostId: "host",
    restartRequiredToRescan: true,
    runtimes: [
      {
        runtimeOfferId: "offer",
        runtimeProfileId: "profile",
        available: true,
        configured: true,
        displayName: "FIXTURE COPY ONLY",
        executable: "fake",
        resolvedExecutablePath: "/fixture/fake",
        source: "configured",
        agentBindings: [],
        modelBindingDescriptors: [],
        sessionBranches: ["fork", "side"],
      },
    ],
  }),
  instanceFork: (actor, input) =>
    f.kernel.roles.forkInstance(actor, f.host, input, async () => {
      copies++;
    }),
  sideCreate: async (actor, input) => {
    const result = await f.kernel.roles.createSide(
      actor,
      f.host,
      input,
      async () => {
        copies++;
      },
    );
    side = result.side;
    return result;
  },
  sideDiscard: (actor, input) => f.kernel.roles.discardSide(actor, input),
});
await service.start();
gateway = new LocalWorkbenchGateway({
  accessToken: f.owner.accessToken,
  daemonOrigin: service.origin,
  port: 0,
  sessionToken: "x".repeat(43),
  staticDirectory: resolve("frontends/raft/packages/web/dist-workbench"),
});
await gateway.start();

const createdSide = await f.kernel.roles.createSide(
  f.actor,
  f.host,
  {
    instanceId: f.instance.instanceId,
    basedOnRoomSeq: f.head(f.home.roomId),
    idempotencyKey: "fixture-side134",
  },
  async () => {
    copies++;
  },
);
const task = f.kernel.createTask(f.actor, {
  roomId: f.home.roomId,
  title: "FIXTURE keyboard move",
  dependencyTaskIds: [],
  basedOnRoomSeq: f.head(f.home.roomId),
  idempotencyKey: "fixture-task134",
}).task;
console.log(
  JSON.stringify({
    origin: gateway.origin,
    roomId: f.home.roomId,
    sideRoomId: createdSide.side.roomId,
    taskId: task.taskId,
    taskUrl:
      gateway.origin +
      "/?room=" +
      f.home.roomId +
      "&chatTab=tasks&taskView=board",
    sideUrl:
      gateway.origin +
      "/?room=" +
      f.home.roomId +
      "&side=" +
      createdSide.side.roomId,
  }),
);
const stop = async () => {
  await gateway.stop();
  await service.stop();
  f.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
