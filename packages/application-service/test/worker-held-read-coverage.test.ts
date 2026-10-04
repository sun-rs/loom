import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { runWorkerCliCommand } from "../../agent-host/src/worker-cli.ts";
import { MAX_RENDERED_BODY_CHARACTERS } from "../../agent-host/src/worker-held-send.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";
import { WorkerApplicationService } from "../src/index.ts";

for (const mode of ["text", "truncated-text", "full-json"] as const) {
  test(`HTTP held output and CLI revision preserve ACK and cancel only fully delivered context (${mode})`, async () => {
    const f = roleInstanceFixture();
    const service = new WorkerApplicationService({ kernel: f.kernel });
    const directory = mkdtempSync(join(tmpdir(), "loom-held-http-"));
    try {
      await service.start();
      const work = startInstanceRun(f);
      f.kernel.presentWorkerMessages(work.execution);
      f.kernel.markPresentedDeliverySent(f.host, {
        activationId: work.activation.activationId,
        consumerId: "worker",
        runAttemptId: work.run.runAttemptId,
      });
      const credential = service.issueActivationCredential(f.host, work.scope);
      const tokenFile = join(directory, "worker-token");
      writeFileSync(tokenFile, credential.accessToken, { mode: 0o600 });
      const later = f.kernel.postMessage(f.actor, {
        roomId: f.home.roomId,
        body:
          mode === "text"
            ? "new fact requiring a revised answer"
            : "x".repeat(MAX_RENDERED_BODY_CHARACTERS + 1),
        idempotencyKey: "later-held-context",
        recipients: [
          { participantId: f.instance.instanceId, reason: "mention" },
        ],
      });
      let stdout = "";
      let stderr = "";
      let outputFinished = false;
      let receiptCalls = 0;
      const output = (kind: "stdout" | "stderr") =>
        new Writable({
          write(chunk, _encoding, done) {
            if (kind === "stdout") stdout += chunk.toString();
            else stderr += chunk.toString();
            // Exercise actual Writable callbacks, rather than a synchronous spy.
            setImmediate(() => {
              outputFinished = true;
              done();
            });
          },
        });
      const runtime = {
        env: {
          RAH_WORKER_API_URL: service.origin,
          RAH_WORKER_SESSION_FILE: tokenFile,
          RAH_ACTIVATION_ID: work.activation.activationId,
        },
        stdout: output("stdout"),
        stderr: output("stderr"),
        fetch: async (...args: Parameters<typeof fetch>) => {
          if (String(args[0]).endsWith("/v1/worker/read-received")) {
            assert.equal(
              outputFinished,
              true,
              "receipt follows output callback",
            );
            receiptCalls += 1;
          }
          return fetch(...args);
        },
      };
      const post = await runWorkerCliCommand(
        [
          "worker",
          "message-post",
          "--target",
          "#home",
          "--based-on-room-seq",
          String(work.activation.toSeq),
          ...(mode === "full-json" ? ["--json"] : []),
        ],
        { ...runtime, stdin: Readable.from(["original answer"]) },
      );
      assert.equal(post, 1, "held send remains unsuccessful");
      assert.equal(receiptCalls, mode === "truncated-text" ? 0 : 1);
      assert.match(stderr, /SEND_HELD_AS_DRAFT/u);
      assert.doesNotMatch(stdout + stderr, /readReceiptId/u);
      const draft = f.db
        .prepare(
          "SELECT held_draft_id, read_proof_json FROM held_message_drafts",
        )
        .get();
      assert.equal(typeof draft?.held_draft_id, "string");
      const receiptState = () =>
        f.db
          .prepare(
            "SELECT delivered, confirmed FROM worker_run_read_receipts WHERE room_id=? AND room_seq=?",
          )
          .get(f.home.roomId, later.event.roomSeq);
      assert.equal(
        JSON.parse(String(draft!.read_proof_json)).delivered,
        mode !== "truncated-text",
      );
      assert.equal(receiptState(), undefined, "output alone is not processing");
      const revised = await runWorkerCliCommand(
        [
          "worker",
          "message-post",
          "--target",
          "#home",
          "--revise-draft",
          String(draft!.held_draft_id),
        ],
        {
          ...runtime,
          stdin: Readable.from(["answer revised against new fact"]),
        },
      );
      assert.equal(revised, 0, stderr);
      assert.equal(
        receiptState()?.confirmed,
        mode === "truncated-text" ? undefined : 1,
      );
      work.finish(0);
      const laterActivation = f.db
        .prepare(
          "SELECT state FROM activations WHERE participant_id=? AND activation_id<>?",
        )
        .get(f.instance.instanceId, work.activation.activationId);
      assert.equal(
        laterActivation?.state,
        mode === "truncated-text" ? "queued" : "cancelled",
      );
      assert.equal(
        f.db
          .prepare("SELECT to_seq FROM activations WHERE activation_id=?")
          .get(work.activation.activationId)?.to_seq,
        work.activation.toSeq,
      );
      assert.equal(
        f.db
          .prepare(
            "SELECT last_seq FROM subscription_cursors WHERE consumer_id='worker'",
          )
          .get()?.last_seq,
        work.activation.toSeq,
      );
      assert.equal(
        f.db
          .prepare("SELECT state FROM inbox_items WHERE event_id=?")
          .get(later.event.eventId)?.state,
        "pending",
      );
      assert.equal(
        f.db.prepare("SELECT count(*) AS n FROM run_attempts").get()?.n,
        1,
      );
    } finally {
      await service.close();
      f.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
