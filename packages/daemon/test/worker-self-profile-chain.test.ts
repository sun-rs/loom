import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import { profileImageContentPath } from "@rah-os/protocol";
import { DaemonApplication, DaemonConfigSchema } from "../src/index.ts";
import { ProfileImageStore } from "../src/profile-image-store.ts";

const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=";
const cliUrl = new URL("../../agent-host/src/worker-cli.ts", import.meta.url)
  .href;

test("DaemonApplication launches a real fake child that edits its own profile and publishes, binds and reads real avatar bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-daemon-chain-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "registry.db");
  const secretPath = join(stateDirectory, "host.token");
  const evidencePath = join(directory, "fake-child-result.json");
  const childPath = join(directory, "fake-profile-child.mjs");
  const pngPath = join(directory, "self.png");
  writeFileSync(pngPath, Buffer.from(image, "base64"));
  writeFileSync(
    childPath,
    `
    import {writeFileSync} from 'node:fs';
    import {runWorkerCliCommand} from ${JSON.stringify(cliUrl)};
    if (!process.env.RAH_WORKER_API_URL) { console.log('Fake profile worker fixture'); process.exit(0); }
    const text=async (...args)=>{
      let out='',err='';
      const status=await runWorkerCliCommand(['worker',...args],{env:process.env,fetch:globalThis.fetch,stdout:{write:x=>out+=x},stderr:{write:x=>err+=x}});
      if(status!==0)throw new Error(args[0]+': '+err);
      return out;
    };
    // Raft's profile commands print \`formatProfile\` text, so the child reads
    // the rendered block; only the commands Raft answers in JSON are parsed as
    // JSON. \`sync\` renders Raft's text and states the delivered cursor on its
    // header line.
    const call=async (...args)=>JSON.parse(await text(...args));
    const field=(out,label)=>{
      const matched=new RegExp('^- '+label+': (.+)$','mu').exec(out);
      if(!matched)throw new Error('profile printed no '+label+': '+out);
      return matched[1];
    };
    const profile=async(...args)=>{
      const out=await text(...args);
      return {
        profile:{
          displayName:field(out,'Display Name'),
          description:field(out,'Description'),
          avatarKey:field(out,'Avatar'),
          participantId:field(out,'ID'),
          agentDefinitionId:field(out,'Agent Definition'),
        },
        writeContext:{
          controlRoomId:field(out,'Control Room'),
          controlRoomSeq:Number(field(out,'Control Room Seq')),
          expectedRevisionId:field(out,'Expected Revision'),
        },
      };
    };
    const syncCursorAfter=async()=>{
      const out=await text('sync');
      const matched=/cursor \\d+ to (\\d+) of \\d+/u.exec(out);
      if(!matched)throw new Error('sync printed no cursor: '+out);
      return Number(matched[1]);
    };
    const flags=c=>['--control-room-id',c.controlRoomId,'--control-room-seq',String(c.controlRoomSeq),'--expected-revision-id',c.expectedRevisionId];
    try {
      const deliveredThrough=await syncCursorAfter();
      const before=await profile('profile-self-get');
      const metadata=await profile('profile-update',...flags(before.writeContext),'--display-name','Alicia from child','--description','Actual daemon Worker commands','--idempotency-key','child-metadata');
      const upload=await call('profile-avatar-publish','--path',${JSON.stringify(pngPath)},'--mime-type','image/png');
      const changed=await profile('profile-update',...flags(metadata.writeContext),'--avatar-key',upload.avatarKey,'--avatar-upload-intent-id',upload.uploadIntentId,'--idempotency-key','child-avatar');
      const posted=await call('message-post','--json','--body','Fake child completed self profile and actual avatar binding','--top-level','--based-on-room-seq',String(deliveredThrough),'--idempotency-key','child-profile-result');
      await call('acknowledge','--through-seq',String(deliveredThrough));
      writeFileSync(${JSON.stringify(evidencePath)},JSON.stringify({before,metadata,upload,changed,posted}));
    } catch(error) { writeFileSync(${JSON.stringify(evidencePath)},JSON.stringify({error:String(error)})); process.exitCode=1; }
  `,
  );
  const seed = new RoomKernel({ databasePath });
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "profile-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({ handle: "alice", kind: "agent" });
    const actor = seed.authenticateAccessToken(human.accessToken);
    const workspace = seed.createWorkspace(actor, {
      name: "Profile",
      slug: "profile",
      idempotencyKey: "workspace",
    });
    const controlRoomId = workspace.controlRoom.roomId;
    seed.addMember(actor, {
      roomId: controlRoomId,
      principalId: agent.principal.principalId,
    });
    const seq = () =>
      seed.sync(actor, { roomId: controlRoomId, consumerId: "setup" })
        .latestRoomSeq;
    const digest = `sha256:${"a".repeat(64)}`;
    const policy = seed.createExecutionPolicy(actor, {
      basedOnRoomSeq: seq(),
      controlRoomId,
      idempotencyKey: "policy",
      modelIntent: { fallback: "disabled" },
      preferred: [],
      required: {
        allowedOfferIds: ["offer"],
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "none",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "retry",
        contentDigest: digest,
        versionId: "v1",
      },
      sessionPolicy: "fresh",
      toolAccessMode: "full_access",
    }).policy;
    const definition = seed.createAgentDefinition(actor, {
      basedOnRoomSeq: seq(),
      controlRoomId,
      executionPolicyRevisionId: policy.executionPolicyRevisionId,
      idempotencyKey: "agent",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "private-memory",
        contentDigest: digest,
        versionId: "v1",
      },
      participantId: agent.principal.principalId,
      role: "Preserve private role",
      skillRefs: [],
    });
    const room = seed.createWorkspaceRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      kind: "channel",
      name: "Work",
      slug: "work",
      visibility: "public",
      basedOnControlRoomSeq: seq(),
      idempotencyKey: "room",
    }).room;
    seed.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const hostId = "profile-chain-host";
    const host = seed.provisionHostCredential({
      hostId,
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, host.accessToken, { mode: 0o600 });
    const registry = new RuntimeProfileRegistry({
      databasePath: registryDatabasePath,
      hostId,
    });
    registry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = registry.importManifest({
      adapter: {
        config: { terminationGraceMs: 1000 },
        executable: process.execPath,
        fixedArgs: [childPath],
        kind: "generic-process/v1",
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      displayName: "Fake profile child",
      manifestVersion: 2,
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers: ["rah-process-supervisor-v1"],
      runtimeProfileId: "profile",
      staticEnv: {},
      workspacePolicy: { allowedModes: ["in_place"] },
    });
    registry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    registry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    registry.close();
    seed.postMessage(actor, {
      roomId: room.roomId,
      body: "Update your public profile and avatar",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "wake",
    });
    seed.close();
    const config = DaemonConfigSchema.parse({
      schemaVersion: 4,
      stateDirectory,
      client: { bindHost: "127.0.0.1", port: 0 },
      host: {
        hostId,
        participantIds: [agent.principal.principalId],
        maxConcurrent: 1,
        credential: { path: secretPath, source: "file" },
      },
      hostStaleAfterMs: 60000,
      leaseMs: 30000,
      drainTimeoutMs: 5000,
      outboxLeaseMs: 5000,
      outboxPollIntervalMs: 20,
      outboxRetryAfterMs: 1000,
      pollIntervalMs: 20,
      runTimeoutMs: 30000,
      runtimeCancelTimeoutMs: 10000,
      runtimeRecoveryTimeoutMs: 30000,
      runtimeStartTimeoutMs: 10000,
      runtimes: [
        {
          credentialBindings: {},
          kind: "runtime-profile-registry",
          registryDatabasePath,
          runtimeProfileId: "profile",
          offer: {
            leaseMs: 1000,
            maxConcurrent: 1,
            refreshIntervalMs: 100,
            runtimeOfferId: "offer",
          },
        },
      ],
      workspace: {
        cwd: directory,
        mode: "in_place",
        workspaceDefinitionId: workspace.workspace.workspaceId,
        workspaceMountDigest: digest,
        workspaceMountRevisionId: "mount-v1",
      },
    });
    const app = new DaemonApplication({ config });
    let runtimeError: unknown;
    running = app.run({ signal: controller.signal }).catch((error) => {
      runtimeError = error;
    });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const deadline = Date.now() + 20000;
    while (!existsSync(evidencePath) && Date.now() < deadline && !runtimeError)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(runtimeError, undefined);
    assert.ok(
      existsSync(evidencePath),
      JSON.stringify({
        health: app.health(),
        runs: observer.listRunAttempts({ roomId: room.roomId }),
      }),
    );
    const result = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.changed.profile.displayName, "Alicia from child");
    assert.equal(result.changed.profile.avatarKey, result.upload.avatarKey);
    assert.equal(result.before.writeContext.controlRoomId, controlRoomId);
    assert.notEqual(controlRoomId, room.roomId);
    const finishDeadline = Date.now() + 5000;
    while (
      observer.listActivations({ roomId: room.roomId })[0]?.state !==
        "completed" &&
      Date.now() < finishDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      observer.listActivations({ roomId: room.roomId })[0]?.state,
      "completed",
    );
    assert.equal(
      observer.listRunAttempts({ roomId: room.roomId })[0]?.state,
      "exited",
    );
    const served = await fetch(
      `${app.clientOrigin()}${profileImageContentPath(result.upload.avatarKey)}`,
      {
        headers: { authorization: `Bearer ${human.accessToken}` },
      },
    );
    assert.equal(served.status, 200, await served.clone().text());
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.deepEqual(
      Buffer.from(await served.arrayBuffer()),
      Buffer.from(image, "base64"),
    );
    const store = new ProfileImageStore({
      directory: join(stateDirectory, "profile-images"),
    });
    const content = store.read(result.upload.avatarKey);
    const chunks: Buffer[] = [];
    for await (const chunk of content.stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(image, "base64"));
    const control = observer.sync(actor, {
      roomId: controlRoomId,
      consumerId: "profile-evidence",
      limit: 500,
    });
    const updates = control.events.filter(
      (event) =>
        event.type === "agent.profile_updated" &&
        event.aggregateId === definition.definition.agentDefinitionId,
    );
    assert.equal(updates.length, 2);
    assert.ok(
      updates.every(
        (event) =>
          event.actorId === agent.principal.principalId &&
          event.payload.metadataOnly === true,
      ),
    );
    assert.ok(
      observer
        .sync(actor, { roomId: room.roomId, consumerId: "message-evidence" })
        .events.some(
          (event) =>
            event.type === "message.posted" &&
            event.actorId === agent.principal.principalId &&
            String(event.payload.body).includes("actual avatar"),
        ),
    );
    assert.equal(observer.listTasks(actor, { roomId: room.roomId }).length, 0);
  } finally {
    controller.abort();
    await running;
    observer?.close();
    try {
      seed.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
