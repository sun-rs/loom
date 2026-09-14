import { networkInterfaces } from "node:os";
import { join } from "node:path";
// Mirror the supported service launcher configuration; Core validates TLS/origin.
export function workbenchLaunchMode(
  environment,
  workbenchHome,
  interfaces = networkInterfaces(),
) {
  const tailnetHost = environment.RAH_TAILNET_HOST?.trim();
  if (tailnetHost)
    return {
      kind: "tailnet",
      bindHost: tailnetHost,
      additionalBindHosts: [
        "127.0.0.1",
        ...new Set(
          Object.values(interfaces)
            .flat()
            .filter(
              (address) =>
                address &&
                !address.internal &&
                address.family === "IPv4" &&
                /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(
                  address.address,
                ),
            )
            .map((address) => address.address),
        ),
      ],
      port: Number(environment.RAH_WEB_PORT ?? "4173"),
    };
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
