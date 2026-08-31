import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { provisionLanCertificate } from "@rah-os/daemon";

const publicOrigin = parsePublicOrigin(requiredEnvironment("RAH_LAN_ORIGIN"));
const workbenchHome = resolve(
  process.env.RAH_OS_HOME?.trim() || defaultWorkbenchHome(),
);
const provisioned = provisionLanCertificate({
  directory: join(workbenchHome, "tls"),
  publicHostname: publicOrigin.hostname,
});

process.stdout.write(
  `RAH_LAN_TLS ${JSON.stringify({
    caCertificatePath: provisioned.caCertificatePath,
    caFingerprint256: provisioned.caFingerprint256,
    certificateFingerprint256: provisioned.certificateFingerprint256,
    certificatePath: provisioned.certificatePath,
    privateKeyPath: provisioned.privateKeyPath,
    publicOrigin: publicOrigin.origin,
    reused: provisioned.reused,
    validTo: provisioned.validTo,
  })}\n`,
);
process.stdout.write(
  `Trust ${provisioned.caCertificatePath} on each browser/PWA device. Keep ${provisioned.caPrivateKeyPath} only on this Core.\n`,
);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePublicOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("RAH_LAN_ORIGIN must be an exact https origin");
  }
  return { hostname: url.hostname, origin: url.origin };
}

function defaultWorkbenchHome() {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "RAH OS")
    : join(homedir(), ".local", "share", "rah-os");
}
