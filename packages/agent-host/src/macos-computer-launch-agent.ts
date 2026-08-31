import { basename, isAbsolute, join, resolve } from "node:path";

import { slotArtifactPath } from "@rah-os/k-carrier";

export type MacOSComputerLaunchAgentPlanOptions = Readonly<{
  kStateDirectory: string;
  label: string;
  logDirectory: string;
  plistPath: string;
  supervisorConfigurationPath: string;
  stateDirectory: string;
  supervisorExecutablePath: string;
}>;

export type MacOSComputerLaunchAgentPlan = Readonly<{
  kStateDirectory: string;
  label: string;
  logDirectory: string;
  plist: string;
  plistPath: string;
  programArguments: readonly string[];
  stateDirectory: string;
  supervisorConfigurationPath: string;
  supervisorExecutablePath: string;
}>;

/**
 * Builds the non-secret per-user launchd contract. launchd owns one constant
 * carrier supervisor; that supervisor owns replaceable K slot children. A
 * plist must never point at the stable slot itself because launchd and K would
 * then race to restart different service generations during handoff.
 */
export function createMacOSComputerLaunchAgentPlan(
  options: MacOSComputerLaunchAgentPlanOptions,
): MacOSComputerLaunchAgentPlan {
  const label = launchdLabel(options.label);
  const kStateDirectory = absolutePath(
    options.kStateDirectory,
    "kStateDirectory",
  );
  const logDirectory = absolutePath(options.logDirectory, "logDirectory");
  const plistPath = absolutePath(options.plistPath, "plistPath");
  const supervisorConfigurationPath = absolutePath(
    options.supervisorConfigurationPath,
    "supervisorConfigurationPath",
  );
  const stateDirectory = absolutePath(options.stateDirectory, "stateDirectory");
  const supervisorExecutablePath = absolutePath(
    options.supervisorExecutablePath,
    "supervisorExecutablePath",
  );
  if (basename(plistPath) !== `${label}.plist`) {
    throw new Error("LaunchAgent plist filename must match its label");
  }
  if (
    supervisorExecutablePath === slotArtifactPath(kStateDirectory, "stable")
  ) {
    throw new Error(
      "LaunchAgent must not execute the replaceable K stable slot directly",
    );
  }
  const programArguments = Object.freeze([
    supervisorExecutablePath,
    "__computer-supervisor",
    "--config-path",
    supervisorConfigurationPath,
  ]);
  const plist = renderPlist({
    label,
    logDirectory,
    programArguments,
    stateDirectory,
    supervisorExecutablePath,
  });
  return Object.freeze({
    kStateDirectory,
    label,
    logDirectory,
    plist,
    plistPath,
    programArguments,
    stateDirectory,
    supervisorConfigurationPath,
    supervisorExecutablePath,
  });
}

function renderPlist(input: {
  label: string;
  logDirectory: string;
  programArguments: readonly string[];
  stateDirectory: string;
  supervisorExecutablePath: string;
}): string {
  const argumentsXml = input.programArguments
    .map((argument) => `      <string>${xml(argument)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(input.label)}</string>
    <key>Program</key>
    <string>${xml(input.supervisorExecutablePath)}</string>
    <key>ProgramArguments</key>
    <array>
${argumentsXml}
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>TimeOut</key>
    <integer>30</integer>
    <key>Umask</key>
    <string>0077</string>
    <key>WorkingDirectory</key>
    <string>${xml(input.stateDirectory)}</string>
    <key>StandardOutPath</key>
    <string>${xml(join(input.logDirectory, "computer.stdout.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(input.logDirectory, "computer.stderr.log"))}</string>
  </dict>
</plist>
`;
}

function launchdLabel(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u.test(value)
  ) {
    throw new Error("LaunchAgent label is invalid");
  }
  return value;
}

function absolutePath(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.length > 4_096
  ) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
