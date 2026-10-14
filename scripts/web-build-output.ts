/** One build-path contract for Vite, local runners and release packaging. */
export function webBuildOutput(trustedProxy: boolean): string {
  return trustedProxy ? "dist-workbench" : "dist";
}
