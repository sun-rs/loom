import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { diagnoseLocalCore, discoverKnownLocalClis } from "@rah-os/daemon";
import { webBuildOutput } from "./workbench-web-assets.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const workbenchHome = resolve(
  process.env.RAH_OS_HOME?.trim() || defaultWorkbenchHome(),
);
const publicOrigin = optionalPublicOrigin(process.env.RAH_LAN_ORIGIN);
const certificatePath = optionalAbsolutePath("RAH_LAN_CERT_PATH");
const privateKeyPath = optionalAbsolutePath("RAH_LAN_KEY_PATH");
const runtimeInventory = await discoverKnownLocalClis();
const report = await diagnoseLocalCore({
  runtimeInventory,
  stateDirectory: join(workbenchHome, "state"),
  staticDirectory:
    optionalAbsolutePath("RAH_WEB_STATIC_DIRECTORY") ??
    join(repositoryDirectory, "apps", "web", webBuildOutput(true)),
  ...(publicOrigin === undefined
    ? {}
    : {
        tls:
          certificatePath === undefined && privateKeyPath === undefined
            ? {
                directory: join(workbenchHome, "tls"),
                kind: "managed",
                publicHostname: publicOrigin.hostname,
              }
            : {
                certificatePath: certificatePath ?? "",
                kind: "external",
                privateKeyPath: privateKeyPath ?? "",
                publicHostname: publicOrigin.hostname,
              },
      }),
  workspaceCwd: resolve(process.env.RAH_WORKSPACE_CWD ?? process.cwd()),
});

process.stdout.write(`RAH_LOCAL_CORE_DOCTOR ${JSON.stringify(report)}\n`);
for (const check of report.checks) {
  process.stdout.write(
    `${check.status === "pass" ? "PASS" : check.status === "notice" ? "NOTE" : "FAIL"} ${check.id}: ${check.detail}\n`,
  );
}
if (report.manualActions.includes("trust-lan-ca-on-client-devices")) {
  process.stdout.write(
    "ACTION lan-tls: verify that every intended macOS/iOS client explicitly trusts the printed local CA certificate.\n",
  );
}
process.exitCode = report.readyToStart ? 0 : 1;

function optionalPublicOrigin(value) {
  if (value?.trim() === "" || value === undefined) return undefined;
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
  return { hostname: url.hostname };
}

function optionalAbsolutePath(name) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  return isAbsolute(value) ? value : "";
}

function defaultWorkbenchHome() {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "RAH OS")
    : join(homedir(), ".local", "share", "rah-os");
}
