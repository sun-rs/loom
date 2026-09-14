/** Display alias for Raft's CLI-home-relative Codex groups. Never a read path. */
export function skillSourceLabel(sourcePath: string): string {
  return sourcePath.replace(/^~\/\.codex\/skills(?=\/|$)/u, "~/skills");
}
