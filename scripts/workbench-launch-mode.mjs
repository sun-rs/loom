import { isIP } from "node:net";
import { join } from "node:path";
// Mirror the supported service launcher configuration; Core validates TLS/origin.
// Tailnet and ordinary LAN are separate trust decisions: configuring the Tailnet
// entry never authorizes a LAN interface, and a newly discovered NIC never joins
// the authorized set on its own. Ordinary LAN entries must be named explicitly.
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/u;
// Tailnet owns 100.64.0.0/10 only. An ordinary LAN address must not reach the
// unpaired HTTP entry through the Tailnet variable and bypass the explicit LAN
// contract; the gateway rejects it too, but the launcher refuses it first.
export function assertTailnetHost(host, source) {
  const octets =
    typeof host === "string" && isIP(host) === 4
      ? host.split(".").map(Number)
      : undefined;
  if (
    octets === undefined ||
    octets[0] !== 100 ||
    octets[1] < 64 ||
    octets[1] > 127
  ) {
    throw new Error(
      `${source} accepts only a 100.64.0.0/10 Tailnet IPv4 address; refused ${JSON.stringify(host)}. Ordinary LAN entries must be named explicitly in RAH_TRUSTED_LAN_HOSTS, or served by the authenticated RAH_LAN_ORIGIN gateway.`,
    );
  }
  return host;
}
export function assertTrustedLanHosts(hosts, tailnetHost, source) {
  if (!Array.isArray(hosts)) {
    throw new Error(
      `${source} must be a list of explicit private IPv4 trusted LAN addresses`,
    );
  }
  const seen = new Set();
  for (const host of hosts) {
    if (
      typeof host !== "string" ||
      isIP(host) !== 4 ||
      !PRIVATE_IPV4.test(host)
    ) {
      throw new Error(
        `${source} accepts only RFC1918 IPv4 trusted LAN addresses; refused ${JSON.stringify(host)}`,
      );
    }
    if (host === tailnetHost) {
      throw new Error(
        `${source} must not repeat the Tailnet entry as a trusted LAN address`,
      );
    }
    if (seen.has(host)) {
      throw new Error(
        `${source} lists the trusted LAN address ${host} more than once`,
      );
    }
    seen.add(host);
  }
  return [...hosts];
}
function configuredTrustedLanHosts(value, tailnetHost) {
  if (value === undefined) return [];
  const hosts = value.split(",").map((entry) => entry.trim());
  if (hosts.length === 1 && hosts[0] === "") {
    throw new Error(
      "RAH_TRUSTED_LAN_HOSTS must name at least one trusted LAN address or stay unset",
    );
  }
  return assertTrustedLanHosts(hosts, tailnetHost, "RAH_TRUSTED_LAN_HOSTS");
}
export function workbenchLaunchMode(environment, workbenchHome) {
  const tailnetHost = environment.RAH_TAILNET_HOST?.trim();
  if (tailnetHost)
    return {
      kind: "tailnet",
      bindHost: assertTailnetHost(tailnetHost, "RAH_TAILNET_HOST"),
      additionalBindHosts: [
        "127.0.0.1",
        ...configuredTrustedLanHosts(
          environment.RAH_TRUSTED_LAN_HOSTS,
          tailnetHost,
        ),
      ],
      port: Number(environment.RAH_WEB_PORT ?? "4173"),
    };
  if (environment.RAH_TRUSTED_LAN_HOSTS !== undefined) {
    throw new Error(
      "RAH_TRUSTED_LAN_HOSTS requires an explicit RAH_TAILNET_HOST entry; ordinary LAN exposure without Tailnet must use the authenticated RAH_LAN_ORIGIN gateway",
    );
  }
  const publicOrigin = environment.RAH_LAN_ORIGIN?.trim();
  if (!publicOrigin)
    return {
      kind: "loopback",
      port: Number(environment.RAH_WEB_PORT ?? "4173"),
    };
  return {
    kind: "lan",
    bindHost: environment.RAH_LAN_BIND_HOST?.trim() || "0.0.0.0",
    publicOrigin,
    tlsDirectory: join(workbenchHome, "tls"),
    ...(environment.RAH_LAN_CERT_PATH?.trim()
      ? { certificatePath: environment.RAH_LAN_CERT_PATH.trim() }
      : {}),
    ...(environment.RAH_LAN_KEY_PATH?.trim()
      ? { privateKeyPath: environment.RAH_LAN_KEY_PATH.trim() }
      : {}),
  };
}
