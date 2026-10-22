import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { provisionLanCertificate } from "./lan-certificate-provisioning.ts";
import { LanWorkbenchAccessStore } from "./lan-workbench-access-store.ts";
import { LanWorkbenchGateway } from "./lan-workbench-gateway.ts";
import type { WorkbenchServiceControl } from "./workbench-service-control.ts";

// An additional TLS edge never authorizes another interface or another Core.
export function additionalHttpsAddress(
  origin: string,
  hosts: readonly string[],
  httpPort: number,
) {
  const url = new URL(origin);
  const port = Number(url.port || 443);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    isIP(url.hostname) !== 4 ||
    !/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(url.hostname) ||
    !hosts.includes(url.hostname) ||
    port === httpPort ||
    port === (httpPort === 65535 ? 65534 : httpPort + 1) ||
    port < 1
  ) {
    throw new Error(
      "Additional HTTPS must use an explicitly authorized LAN IPv4 origin and a port distinct from HTTP and its PDF listener",
    );
  }
  return { hostname: url.hostname, port };
}

export async function startAdditionalLanHttps(input: {
  origin: string;
  hosts: readonly string[];
  httpPort: number;
  workbenchHome: string;
  accessToken: string;
  daemonOrigin: string;
  staticDirectory: string;
  serviceControl?: WorkbenchServiceControl;
}) {
  const { hostname, port } = additionalHttpsAddress(
    input.origin,
    input.hosts,
    input.httpPort,
  );
  const identity = provisionLanCertificate({
    directory: join(input.workbenchHome, "tls"),
    publicHostname: hostname,
  });
  const gateway = new LanWorkbenchGateway({
    accessStore: new LanWorkbenchAccessStore({
      path: join(input.workbenchHome, "state", "lan-access.json"),
    }),
    accessToken: input.accessToken,
    daemonOrigin: input.daemonOrigin,
    staticDirectory: input.staticDirectory,
    bindHost: hostname,
    publicHostname: hostname,
    port,
    ...(input.serviceControl ? { serviceControl: input.serviceControl } : {}),
    tls: {
      certificate: readFileSync(identity.certificatePath),
      privateKey: readFileSync(identity.privateKeyPath),
    },
  });
  try {
    await gateway.start();
    const pairing = gateway.issuePairingCode();
    return {
      gateway,
      descriptor: {
        webOrigin: gateway.origin,
        pairingUrl: `${gateway.origin}/_rah/pair`,
        pairingCode: pairing.code,
        pairingExpiresAt: pairing.expiresAt,
        caCertificatePath: identity.caCertificatePath,
        certificateFingerprint256: identity.certificateFingerprint256,
      },
    };
  } catch (error) {
    await gateway.stop();
    throw error;
  }
}

export async function stopWorkbenchGateways(
  gateways: ReadonlyArray<{ stop(): Promise<void> } | undefined>,
) {
  const results = await Promise.allSettled(
    gateways.map((gateway) => gateway?.stop()),
  );
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (errors.length)
    throw new AggregateError(errors, "Workbench gateway shutdown failed");
}
