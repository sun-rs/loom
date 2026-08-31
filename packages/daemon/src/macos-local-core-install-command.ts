import { isAbsolute, resolve } from "node:path";

export const MACOS_LOCAL_CORE_INSTALL_USAGE = `Usage:
  rah-os-core install --quick-start
  rah-os-core install --mode <loopback|lan> --workspace <absolute-path> [options]
  rah-os-core uninstall [--home <absolute-path>] [--purge-data]

Source-checkout operator:
  npm run install:core:macos -- --mode <loopback|lan> --workspace <absolute-path> [options]
  npm run uninstall:core:macos -- [--home <absolute-path>] [--purge-data]

Options:
  --quick-start                     Create ~/RAH OS Workspace and activate loopback
  --mode <loopback|lan>             Public client edge to run
  --workspace <absolute-path>       Workspace mounted into local Agent runtimes
  --home <absolute-path>            Persistent RAH OS home (default: Application Support)
  --product-directory <absolute>   Immutable Local Core product directory
  --web-port <1-65535>              Loopback Web port (default: 4173)
  --origin <https-origin>           Required exact LAN origin
  --bind-host <host>                LAN bind host (default: 0.0.0.0)
  --certificate-path <absolute>     External LAN certificate; requires private key
  --private-key-path <absolute>     External LAN private key; requires certificate
  --ca-certificate-path <absolute>  CA used only for post-launch readiness proof
  --activate                        Bootstrap launchd after staging
  --replace-loaded                  Explicitly replace a loaded Core; requires activation
  --replace-staged                  Replace a different staged plist
  --uninstall                       Unload Core and remove its LaunchAgent plist
  --purge-data                      Also remove persistent Core data; requires --uninstall
  --help                            Show this help
`;

export type MacOSLocalCoreInstallArguments =
  | Readonly<{ help: true }>
  | Readonly<{
      home?: string;
      purgeData: boolean;
      uninstall: true;
    }>
  | Readonly<{
      activate: true;
      home?: undefined;
      mode: "loopback";
      productDirectory?: undefined;
      quickStart: true;
      replaceLoaded: false;
      replaceStaged: false;
      webPort: 4173;
    }>
  | Readonly<{
      activate: boolean;
      bindHost?: string;
      caCertificatePath?: string;
      certificatePath?: string;
      home?: string;
      mode: "lan" | "loopback";
      origin?: string;
      privateKeyPath?: string;
      productDirectory?: string;
      replaceLoaded: boolean;
      replaceStaged: boolean;
      webPort?: number;
      workspace: string;
    }>;

export function parseMacOSLocalCoreInstallArguments(
  arguments_: readonly string[],
): MacOSLocalCoreInstallArguments {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueOptions = new Set([
    "--bind-host",
    "--ca-certificate-path",
    "--certificate-path",
    "--home",
    "--mode",
    "--origin",
    "--private-key-path",
    "--product-directory",
    "--web-port",
    "--workspace",
  ]);
  const flagOptions = new Set([
    "--activate",
    "--help",
    "--purge-data",
    "--quick-start",
    "--replace-loaded",
    "--replace-staged",
    "--uninstall",
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (flagOptions.has(argument)) {
      if (flags.has(argument)) throw new Error(`${argument} was repeated`);
      flags.add(argument);
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new Error(`unknown local Core install option: ${argument}`);
    }
    if (values.has(argument)) throw new Error(`${argument} was repeated`);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }
  if (flags.has("--help")) {
    if (flags.size !== 1 || values.size !== 0) {
      throw new Error("--help must be used alone");
    }
    return Object.freeze({ help: true });
  }
  if (flags.has("--quick-start")) {
    if (flags.size !== 1 || values.size !== 0) {
      throw new Error("--quick-start must be used alone");
    }
    return Object.freeze({
      activate: true,
      mode: "loopback",
      quickStart: true,
      replaceLoaded: false,
      replaceStaged: false,
      webPort: 4173,
    });
  }

  if (flags.has("--uninstall")) {
    const forbiddenFlags = [...flags].filter(
      (flag) => flag !== "--uninstall" && flag !== "--purge-data",
    );
    const forbiddenValues = [...values.keys()].filter(
      (option) => option !== "--home",
    );
    if (forbiddenFlags.length > 0 || forbiddenValues.length > 0) {
      throw new Error("--uninstall cannot be combined with install options");
    }
    const home = absoluteOption(values, "--home", false);
    return Object.freeze({
      ...(home === undefined ? {} : { home }),
      purgeData: flags.has("--purge-data"),
      uninstall: true,
    });
  }
  if (flags.has("--purge-data")) {
    throw new Error("--purge-data requires --uninstall");
  }

  const mode = values.get("--mode");
  if (mode !== "loopback" && mode !== "lan") {
    throw new Error("--mode must be loopback or lan");
  }
  const workspace = absoluteOption(values, "--workspace", true)!;
  const home = absoluteOption(values, "--home", false);
  const certificatePath = absoluteOption(values, "--certificate-path", false);
  const privateKeyPath = absoluteOption(values, "--private-key-path", false);
  const caCertificatePath = absoluteOption(
    values,
    "--ca-certificate-path",
    false,
  );
  const productDirectory = absoluteOption(values, "--product-directory", false);
  if ((certificatePath === undefined) !== (privateKeyPath === undefined)) {
    throw new Error(
      "--certificate-path and --private-key-path must be provided together",
    );
  }
  const activate = flags.has("--activate");
  const replaceLoaded = flags.has("--replace-loaded");
  if (replaceLoaded && !activate) {
    throw new Error("--replace-loaded requires --activate");
  }
  const common = {
    activate,
    ...(caCertificatePath === undefined ? {} : { caCertificatePath }),
    ...(home === undefined ? {} : { home }),
    mode,
    ...(productDirectory === undefined ? {} : { productDirectory }),
    replaceLoaded,
    replaceStaged: flags.has("--replace-staged"),
    workspace,
  } as const;
  if (mode === "loopback") {
    for (const option of [
      "--bind-host",
      "--origin",
      "--certificate-path",
      "--private-key-path",
      "--ca-certificate-path",
    ]) {
      if (values.has(option)) {
        throw new Error(`${option} is only valid in LAN mode`);
      }
    }
    return Object.freeze({
      ...common,
      mode,
      webPort: portOption(values.get("--web-port") ?? "4173", "--web-port"),
    });
  }
  if (values.has("--web-port")) {
    throw new Error("--web-port is only valid in loopback mode");
  }
  const origin = values.get("--origin");
  if (origin === undefined) throw new Error("--origin is required in LAN mode");
  return Object.freeze({
    ...common,
    bindHost: nonEmpty(values.get("--bind-host") ?? "0.0.0.0", "--bind-host"),
    ...(certificatePath === undefined
      ? {}
      : {
          certificatePath,
          privateKeyPath: requiredValue(privateKeyPath, "--private-key-path"),
        }),
    mode,
    origin: exactHttpsOrigin(origin),
  });
}

function absoluteOption(
  values: ReadonlyMap<string, string>,
  name: string,
  required: boolean,
): string | undefined {
  const value = values.get(name);
  if (value === undefined) {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }
  if (!isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${name} must be absolute`);
  }
  return resolve(value);
}

function exactHttpsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--origin must be an exact https origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("--origin must be an exact https origin");
  }
  portOption(parsed.port === "" ? "443" : parsed.port, "--origin port");
  return parsed.origin;
}

function portOption(value: string, name: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} is invalid`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }
  return parsed;
}

function nonEmpty(value: string, name: string): string {
  if (value.trim().length === 0 || value.includes("\0") || value.length > 255) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function requiredValue(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}
