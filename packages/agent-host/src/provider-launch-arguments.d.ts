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
export function providerLaunchPolicy(runtimeId: string): {
  args: string[];
  environment: Record<string, string>;
};

export function providerLaunchRequiredArgs(runtimeId: string): string[];
