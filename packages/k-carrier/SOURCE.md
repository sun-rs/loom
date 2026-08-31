# K Carrier source record

This package is an in-repository adaptation of the Apache-2.0 licensed
`@botiverse/k-carrier@0.1.6` core published by Botiverse.

- upstream repository: <https://github.com/botiverse/k-carrier>
- upstream npm package: `@botiverse/k-carrier@0.1.6`
- upstream tag/commit: `v0.1.6` / `f0f0aa8722c868fb82a76c0191dc02929cd6a21e`
- upstream tarball SHA-256: `3ee2912a70a1adbee122d457f9b61dc76deba9539f62124ec6e1e18af2b0ca5a`
- frozen npm evidence: `/Users/sun/Code/repos/raft-runtime-forensics/evidence/k-carrier-0.1.6.json`
- frozen full Git source and upstream tests: `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/git/k-carrier-v0.1.6`
- imported scope: upstream production files under `core/src`, `LICENSE`, and
  `NOTICE`; upstream tests and README remain frozen evidence and are not part of
  the workspace package

Why this is a workspace source package rather than a direct npm runtime
dependency: the upstream package exports TypeScript source from
`node_modules`. Node 25 refuses to strip types below `node_modules`, so the
published package cannot execute in RAH_OS's native Node test/runtime path.
Raft's bundled build does not have that constraint. Keeping the source in a
workspace makes the fixed version executable by the same native TypeScript
path as the rest of RAH_OS while preserving source and license evidence.

Local adaptations:

1. Package name, version suffix, private flag, and export path are RAH_OS
   workspace metadata.
2. Type-only `.js` specifiers in `src/upgrader.ts` are changed to `.ts` so the
   source package resolves in native TypeScript execution.
3. `createUpgrader`/`driveUpgrade` accept an optional awaited
   `verifiedArtifactMaterializer`. RAH_OS uses this narrow seam to retain its
   signed, streaming, owner-private downloader and return an exact local path;
   K still solely owns slot staging, WAL, handoff, promote, and rollback. The
   untouched default path remains the upstream K downloader.
4. Stable bootstrap changes the K-owned copied artifact to mode `0700` before
   opening it with `r+` for the upstream durability sync. This lets a normal
   read-only installed release seed the writable K slot without modifying the
   trusted source artifact.
5. Experiment staging makes the verified artifact executable only after it has
   been copied into the K-owned slot. RAH_OS's streaming release materializer
   deliberately publishes a `0600` source file; executable permission is a
   property of the private slot copy, not of the download cache.

Do not silently refresh this directory. Any upstream update must freeze the
new npm tarball and provenance first, then record an explicit source diff and
rerun the K conformance and RAH_OS Computer upgrade gates.

The frozen upstream tag was checked on Node `v25.9.0` with its declared
`pnpm@11.18.0`: typecheck, lint, ratchets, and all `318/318` upstream core and
harness tests passed. This qualifies the imported mechanics; it does not by
itself qualify RAH_OS. Separate RAH_OS gates now cover the production
HostAdapter boundary, authenticated live/control sockets, slot-only launcher,
and a real incumbent-to-successor replacement. Installer/launchd ownership,
reboot recovery, and a signed self-contained executable or dependency bundle
are still not qualified.
