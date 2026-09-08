import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { request as createHttpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LanWorkbenchAccessStore } from "../src/lan-workbench-access-store.ts";
import { LanWorkbenchGateway } from "../src/lan-workbench-gateway.ts";

for (const revoke of [true, false]) {
  test(`LAN restart rechecks the session after receiving its body: revoked=${revoke}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-lan-restart-auth-"));
    const staticDirectory = join(directory, "dist");
    mkdirSync(staticDirectory);
    writeFileSync(
      join(staticDirectory, "index.html"),
      "<!doctype html>Isolated LAN restart authentication fixture",
    );
    let gateway: LanWorkbenchGateway | undefined;
    let restartCalls = 0;
    try {
      const keyPath = join(directory, "test.key");
      const certificatePath = join(directory, "test.crt");
      execFileSync(
        "/usr/bin/openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          keyPath,
          "-out",
          certificatePath,
          "-days",
          "1",
          "-subj",
          "/CN=127.0.0.1",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
        ],
        { stdio: "ignore" },
      );
      const certificate = readFileSync(certificatePath);
      const accessStore = new LanWorkbenchAccessStore({
        path: join(directory, "access.json"),
      });
      const pair = (name: string) => {
        const invite = accessStore.issuePairingCode({ ttlMs: 60_000 });
        const result = accessStore.exchangePairingCode(invite.code, name);
        assert.ok(result);
        return result;
      };
      const requester = pair("Temporary restart requester");
      const administrator = pair("Temporary revoking browser");
      gateway = new LanWorkbenchGateway({
        accessStore,
        accessToken: "unused-fixture-human-token",
        bindHost: "127.0.0.1",
        daemonOrigin: "http://127.0.0.1:1",
        port: 0,
        publicHostname: "127.0.0.1",
        staticDirectory,
        tls: { certificate, privateKey: readFileSync(keyPath) },
        serviceControl: {
          status: () => ({ generation: "fixture-generation", state: "online" }),
          restart: (generation) => {
            assert.equal(generation, "fixture-generation");
            restartCalls += 1;
            return "accepted";
          },
        },
      });
      await gateway.start();
      const origin = gateway.origin;
      const continued = Promise.withResolvers<void>();
      const result = Promise.withResolvers<{
        status: number;
        headers: IncomingHttpHeaders;
        body: string;
      }>();
      const request = createHttpsRequest(
        new URL("/_rah/service/restart", origin),
        {
          ca: certificate,
          method: "POST",
          headers: {
            cookie: `rah_lan_session=${requester.sessionToken}`,
            origin,
            "content-type": "application/json",
            expect: "100-continue",
          },
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => (body += String(chunk)));
          response.once("error", result.reject);
          response.once("end", () =>
            result.resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body,
            }),
          );
        },
      );
      request.once("continue", continued.resolve);
      request.once("error", result.reject);
      request.setTimeout(5_000, () =>
        request.destroy(new Error("TLS request timed out")),
      );
      try {
        request.flushHeaders();
        await Promise.race([
          continued.promise,
          result.promise.then(() =>
            assert.fail("response preceded body continuation"),
          ),
        ]);
        request.write('{"generation":');
        if (revoke) {
          // Use the existing HTTPS device-management route while the restart
          // handler is suspended on an incomplete body, without timing sleeps.
          const revoked = await new Promise<number>((resolve, reject) => {
            const revokeRequest = createHttpsRequest(
              new URL(
                `/_rah/devices/${requester.device.deviceId}/revoke`,
                origin,
              ),
              {
                ca: certificate,
                method: "POST",
                headers: {
                  cookie: `rah_lan_session=${administrator.sessionToken}`,
                  origin,
                  "content-type": "application/json",
                },
              },
              (response) => {
                response.resume();
                response.once("error", reject);
                response.once("end", () => resolve(response.statusCode ?? 0));
              },
            );
            revokeRequest.once("error", reject);
            revokeRequest.end("{}");
          });
          assert.equal(revoked, 204);
          assert.equal(
            accessStore.authenticateSession(requester.sessionToken),
            null,
          );
        }
        request.end('"fixture-generation"}');
        const response = await result.promise;
        assert.equal(
          response.status,
          revoke ? 401 : 202,
          JSON.stringify({ response, restartCalls }),
        );
        assert.equal(restartCalls, revoke ? 0 : 1);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.deepEqual(
          JSON.parse(response.body),
          revoke
            ? { error: "unauthorized" }
            : {
                result: "accepted",
                generation: "fixture-generation",
                state: "online",
              },
        );
      } finally {
        request.destroy();
      }
    } finally {
      await gateway?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
