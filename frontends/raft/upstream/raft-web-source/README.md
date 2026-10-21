# Official source dependency

Private local distribution of six byte-exact Raft Web components, **not** an npm package published by Raft and **not** the complete Raft Web application. `source-lock.json` pins the authorized source commit, paths, license and hashes. Upstream paths and notices are preserved. The exported components and `embed.ts` form the selected source closure; no upstream business store is included.

Product import chain: Loom data/events → compatibility entries in `packages/web/src/components/ui` → this dependency → official `@botiverse/raft-ui` recipes. `PanelHeader` preserves approved compact mobile placement using container data attributes; `SectionEyebrow` drops the retired `uppercase` parameter. Neither adapter renders a second copy of native presentation.

The host installs `@botiverse/raft-ui@0.10.5` under the existing `raft-ui` npm alias. The canonical peer is optional only to prevent npm installing a duplicate; the host's Vite and TypeScript mappings bind canonical and legacy imports to the same mandatory pinned runtime. React is likewise supplied by the host. Tailwind scans this source explicitly.

## Upgrade

1. Obtain the authorized official source checkout at an explicit revision. Do not substitute the production Web asset version for an unavailable source revision.
2. Run `node scripts/official-web/upstream-diff.mjs /path/to/official-source-checkout` from the repository root. `sourceDependency.rows` is the direct official-vs-official comparison; any `unexpectedLocalDrift` is a violation, not an upgrade patch to preserve. Other rows describe the older application intake separately.
3. Review changed exports/import closure and upstream package requirements. Replace the selected upstream files byte-exactly, update source-lock/package version and lockfile together. Add required original dependencies without introducing upstream business state. Never patch files under `packages/`; put necessary Loom adapters outside this package.
4. Run the dependency hash and alias checks, typecheck/build, and focused affected interaction checks. Stable API/style-only upgrades need no page-by-page redesign. Changed composition, responsive behavior, focus or data contracts still need targeted browser verification.

Remaining `loom/` pages and other historical compatibility ports are **not** restored by this slice. They must be migrated by complete presentation/import closure with Loom SDK adapters, not relabeled as official source. The published `raft-ui` package and this selected application source have independent versions.
