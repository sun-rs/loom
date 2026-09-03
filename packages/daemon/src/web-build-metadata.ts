import { readFileSync } from "node:fs";
import { join } from "node:path";

export const WEB_BUILD_HEADER = "x-rah-web-build-id";
export const WEB_BUILD_METADATA_FILE = ".rah-web-build.json";

export function readWebBuildId(staticDirectory: string): string | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(join(staticDirectory, WEB_BUILD_METADATA_FILE), "utf8"),
    ) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
    ) {
      return undefined;
    }
    const webBuildId = (parsed as { webBuildId?: unknown }).webBuildId;
    return typeof webBuildId === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/u.test(webBuildId)
      ? webBuildId
      : undefined;
  } catch {
    return undefined;
  }
}
