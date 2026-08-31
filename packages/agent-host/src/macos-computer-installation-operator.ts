import { NodeComputerServiceSupervisorControlClient } from "./computer-service-supervisor-control.ts";
import {
  activateMacOSComputerLaunchAgent,
  deactivateMacOSComputerLaunchAgent,
  inspectMacOSComputerLaunchAgent,
  NodeMacOSLaunchCtl,
  proveMacOSComputerLaunchAgentServiceReady,
  type MacOSLaunchCtlPort,
} from "./macos-computer-launch-agent-controller.ts";
import {
  installMacOSComputerLaunchAgentFiles,
  verifyMacOSComputerInstallArtifacts,
  type MacOSComputerLaunchAgentInstallInput,
  type MacOSComputerLaunchAgentInstallResult,
  type VerifiedMacOSComputerInstallArtifact,
} from "./macos-computer-installer.ts";
import {
  resolveMacOSComputerProvisioning,
  type MacOSComputerProvisioning,
  type MacOSComputerProvisioningInput,
} from "./macos-computer-provisioning.ts";
import { computerServiceSupervisorControlSocketPath } from "./node-k-carrier-computer-supervisor-process.ts";

export type MacOSComputerInstallationOptions = Readonly<{
  activate?: boolean;
  provisioning: MacOSComputerProvisioningInput;
  replaceLoaded?: boolean;
  serviceArtifact: VerifiedMacOSComputerInstallArtifact;
  serviceVersion: string;
  supervisorArtifact: VerifiedMacOSComputerInstallArtifact;
  userId?: number;
}>;

export type MacOSComputerInstallationResult = Readonly<{
  kind: "activated" | "replaced" | "staged";
  serviceTarget: string;
  staged: MacOSComputerLaunchAgentInstallResult;
}>;

export type MacOSComputerInstallationRuntime = Readonly<{
  installFiles?: typeof installMacOSComputerLaunchAgentFiles;
  launchctl?: MacOSLaunchCtlPort;
  proveReady?: (provisioning: MacOSComputerProvisioning) => Promise<void>;
  verifyArtifacts?: typeof verifyMacOSComputerInstallArtifacts;
  wait?: (delayMs: number) => Promise<void>;
}>;

/**
 * Explicit operator composition for a per-user Computer. A registration probe
 * happens before any file mutation. A loaded service is never modified unless
 * replacement and subsequent activation are both explicitly requested.
 */
export async function installMacOSComputer(
  options: MacOSComputerInstallationOptions,
  runtime: MacOSComputerInstallationRuntime = {},
): Promise<MacOSComputerInstallationResult> {
  const activate = optionalBoolean(options.activate, "activate") ?? false;
  const replaceLoaded =
    optionalBoolean(options.replaceLoaded, "replaceLoaded") ?? false;
  if (replaceLoaded && !activate) {
    throw new Error("Computer replacement requires activation");
  }
  const provisioning = await resolveMacOSComputerProvisioning(
    options.provisioning,
  );
  const launchctl = runtime.launchctl ?? new NodeMacOSLaunchCtl();
  const inspection = await inspectMacOSComputerLaunchAgent({
    launchctl,
    plan: provisioning.plan,
    ...(options.userId === undefined ? {} : { userId: options.userId }),
  });
  const wasLoaded = inspection.kind === "loaded";
  if (wasLoaded && !replaceLoaded) {
    throw new Error(
      "Computer LaunchAgent is already loaded; explicit replacement is required",
    );
  }
  await (runtime.verifyArtifacts ?? verifyMacOSComputerInstallArtifacts)([
    options.supervisorArtifact,
    options.serviceArtifact,
  ]);
  if (wasLoaded) {
    await deactivateMacOSComputerLaunchAgent({
      launchctl,
      plan: provisioning.plan,
      ...(options.userId === undefined ? {} : { userId: options.userId }),
      ...(runtime.wait === undefined ? {} : { wait: runtime.wait }),
    });
  }

  const installInput: MacOSComputerLaunchAgentInstallInput = {
    plan: provisioning.plan,
    serviceArtifact: options.serviceArtifact,
    serviceConfiguration: provisioning.serviceConfiguration,
    serviceVersion: options.serviceVersion,
    supervisorArtifact: options.supervisorArtifact,
    supervisorConfiguration: provisioning.supervisorConfiguration,
    upgradeConfiguration: provisioning.upgradeConfiguration,
  };
  const staged = await (
    runtime.installFiles ?? installMacOSComputerLaunchAgentFiles
  )(installInput);
  if (!activate) {
    return Object.freeze({
      kind: "staged",
      serviceTarget: inspection.serviceTarget,
      staged,
    });
  }

  const proveReady =
    runtime.proveReady ??
    (async (value: MacOSComputerProvisioning) => {
      const supervisor = new NodeComputerServiceSupervisorControlClient({
        controlToken: value.supervisorConfiguration.controlToken,
        socketPath: computerServiceSupervisorControlSocketPath(
          value.supervisorConfiguration.socketDirectory,
        ),
        timeoutMs: value.upgradeConfiguration.supervisorControlTimeoutMs,
      });
      await proveMacOSComputerLaunchAgentServiceReady({
        expectedBuildVersion: options.serviceVersion,
        ownershipControlToken: value.upgradeConfiguration.ownershipControlToken,
        ownershipSocketPath: value.upgradeConfiguration.ownershipSocketPath,
        supervisor,
      });
    });
  const activation = await activateMacOSComputerLaunchAgent({
    launchctl,
    plan: provisioning.plan,
    proveReady: async () => await proveReady(provisioning),
    ...(options.userId === undefined ? {} : { userId: options.userId }),
    ...(runtime.wait === undefined ? {} : { wait: runtime.wait }),
  });
  if (activation.kind !== "activated") {
    throw new Error(
      "Computer installation activation observed an unexpected loaded service",
    );
  }
  return Object.freeze({
    kind: wasLoaded ? "replaced" : "activated",
    serviceTarget: activation.serviceTarget,
    staged,
  });
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}
