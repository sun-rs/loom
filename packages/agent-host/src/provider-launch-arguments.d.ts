export const PROVIDER_LAUNCH_ARGS_ENV: string;
export function validateProviderLaunchArgs(args: unknown): string[];
export function providerLaunchDefaults(runtimeId: string): string[];
export function providerLaunchArguments(
  runtimeId: string,
  environment?: NodeJS.ProcessEnv,
): string[];

export function validateProviderLaunchOverride(
  runtimeId: string,
  args: unknown,
): string[];

export function providerMemoryConfig(
  runtimeId: string,
): Record<string, boolean>;
export function codexUserMcpServerNames(
  environment?: NodeJS.ProcessEnv,
  options?: { executable?: string; cwd?: string },
): string[];
export function providerLaunchSwitches(runtimeId: string): {
  args: string[];
  environment: Record<string, string>;
};
export function providerLaunchPolicy(
  runtimeId: string,
  environment?: NodeJS.ProcessEnv,
  options?: { codexExecutable?: string; cwd?: string },
): {
  args: string[];
  /** Codex only: the user MCP server names disabled by this launch. */
  codexMcpServerNames?: string[];
  environment: Record<string, string>;
};

export function providerLaunchRequiredArgs(runtimeId: string): string[];
