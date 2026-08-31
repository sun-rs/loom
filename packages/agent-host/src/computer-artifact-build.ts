import { COMPUTER_ARTIFACT_BUILD_VERSION } from "./computer-artifact-build-version.ts";

/**
 * Undefined in source/test execution and replaced with an immutable literal
 * by the Computer SEA build. The service entry uses it to stop a signed
 * artifact from claiming a version supplied only by mutable configuration.
 */
export function computerArtifactBuildVersion(): string | undefined {
  return COMPUTER_ARTIFACT_BUILD_VERSION;
}
