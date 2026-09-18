import { basename, join, resolve, relative, sep } from "node:path";
import { listComputerReferenceRoot } from "./agent-workspace-browser.ts";
import {
  ComputerFilesListRequestSchema,
  ComputerFilesListResponseSchema,
  type ComputerFilesListRequest,
} from "@rah-os/protocol";

/** Host-owned path references reuse the existing bounded, no-symlink workspace reader. */
export class ComputerFileBrowser {
  readonly hostId: string;
  readonly label: string;
  readonly roots: readonly string[];
  readonly initialPath: string;
  constructor(input: {
    hostId: string;
    label: string;
    roots: readonly string[];
    initialDirectory?: string;
  }) {
    this.hostId = input.hostId;
    this.label = input.label;
    this.roots = [...new Set(input.roots.map((root) => resolve(root)))];
    if (!this.roots.length || this.roots.length > 32)
      throw new Error("Authorized file reference roots required");
    this.initialPath = relative(
      this.roots[0]!,
      resolve(input.initialDirectory ?? this.roots[0]!),
    );
    if (this.initialPath === ".." || this.initialPath.startsWith(`..${sep}`))
      throw new Error("Initial directory is outside the authorized root");
  }
  async list(request: ComputerFilesListRequest) {
    const input = ComputerFilesListRequestSchema.parse(request);
    if (input.hostId && input.hostId !== this.hostId)
      throw new Error("Computer is not connected to this file browser");
    const roots = this.roots.map((absolutePath, i) => ({
      rootId: `root-${i}`,
      absolutePath,
      label: basename(absolutePath) || absolutePath,
    }));
    const root = roots.find(
      (root) => root.rootId === (input.rootId ?? "root-0"),
    );
    if (!root) throw new Error("File reference root is not authorized");
    const listing = await listComputerReferenceRoot({
      rootDirectory: root.absolutePath,
      rootId: "runtime-project",
      rootKind: "runtime-project",
      rootLabel: root.label,
      path: !input.rootId && !input.path ? this.initialPath : input.path,
      includeHidden: input.includeHidden ?? false,
    });
    return ComputerFilesListResponseSchema.parse({
      hostId: this.hostId,
      label: this.label,
      roots,
      rootId: root.rootId,
      path: listing.path,
      absolutePath: join(root.absolutePath, listing.path),
      truncated: listing.truncated,
      entries: listing.entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        absolutePath: join(root.absolutePath, entry.path),
        isDirectory: entry.isDirectory,
      })),
    });
  }
}
