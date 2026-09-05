import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

function validateRoomRoot(roomRoot: string): string {
  if (!path.isAbsolute(roomRoot) || roomRoot.includes("\u0000")) {
    throw new Error("roomRoot must be an absolute path");
  }
  const resolved = path.resolve(roomRoot);
  if (path.dirname(resolved) === resolved) {
    throw new Error("roomRoot must not be a filesystem root");
  }
  return resolved;
}

function canonicalizePathFromNearestAncestor(targetPath: string): string {
  let existing = targetPath;
  const missingSegments: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new Error("roomRoot has no existing filesystem ancestor");
    }
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  const physicalAncestor = realpathSync.native(existing);
  return path.resolve(physicalAncestor, ...missingSegments);
}

/**
 * Canonicalize an existing path or its nearest existing ancestor. This makes
 * a not-yet-created Room root share one physical identity through symlinked
 * parent aliases before it is used for a cross-process owner lease.
 */
export function canonicalizeRoomRoot(roomRoot: string): string {
  return canonicalizePathFromNearestAncestor(validateRoomRoot(roomRoot));
}

/**
 * Return both identities that must stay exclusively owned:
 *
 * - the stable public location, resolving only its parent so replacement of
 *   the Room root cannot move the lock; and
 * - the current physical target, so a second path/symlink cannot alias the
 *   same database under a different public location.
 */
export function roomRootLeaseIdentities(roomRoot: string): readonly string[] {
  const resolved = validateRoomRoot(roomRoot);
  const locationIdentity = path.join(
    canonicalizePathFromNearestAncestor(path.dirname(resolved)),
    path.basename(resolved),
  );
  const physicalIdentity = canonicalizePathFromNearestAncestor(resolved);
  return Object.freeze(
    [...new Set([locationIdentity, physicalIdentity])].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
}
