export function parseAttachedDirectory(value: unknown): string;
export function claudeAttachedDirectoryArgs(
  directories: readonly string[],
): string[];
export function codexWorkspaceRoots(
  cwd: string,
  directories: readonly string[],
): { runtimeWorkspaceRoots?: string[] };
/**
 * Throws an Error whose `code` is KIMI_LOCAL_CONFIG_FOREIGN,
 * KIMI_LOCAL_CONFIG_MODIFIED or KIMI_LOCAL_CONFIG_UNSAFE when the existing
 * file is kept.
 */
export function writeKimiWorkspaceConfig(
  cwd: string,
  directories: readonly string[],
): void;
