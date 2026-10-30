# Complete release intake

These are immutable dependency archives. They are not new product entrypoints.

- `raft-web-1.21.40-distribution.tar.gz`: complete captured first-party executable
  resource graph rooted at the official release HTML. **Compiled distribution,
  not the original authored TSX project.** The adjacent JSON records release,
  SHA-256, static closure and unresolved runtime/UI/backend boundaries.
- `raft-design-0.52.2-source.tar.gz`: the entire official `v0.52.2` Git tree,
  including MIT license, source, documentation and build tooling. Its adjacent
  JSON identifies commit/tree, archive hash and file count.

Web notices/license reference: [`../raft-web-source/LICENSE`](../raft-web-source/LICENSE).
Owner authorized direct deployed-code extraction and private reuse. Original
Web modules/HTML/CSS/fonts remain byte exact; external telemetry is not imported
as a product dependency. The Google font files/CSS preserve their original bytes.

From the repository root:

```sh
node scripts/official-web/pinned-release.mjs
node scripts/official-web/native-release-browser.mjs
```

The second command uses synthetic identities and **fixture API responses only**,
blocks external requests and WebSockets, and writes screenshots/API-gap evidence
under `/tmp/loom-native-release-evidence`. It does not connect Loom production,
install the official server, or certify backend adaptation. Existing product
builds still use their recorded legacy baseline until a complete adapter passes.

See [the current migration contract](../../../../docs/design/full-official-frontend-baseline.zh-CN.md).
