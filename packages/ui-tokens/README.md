# RAH OS UI tokens and generated assets

This package is the product-owned output boundary between the immutable Raft UI
reference and RAH OS renderers. `apps/web` may consume these exports; it must not
import `@rah-os/raft-ui-snapshot` directly.

Regenerate after intentionally updating the reference snapshot:

```bash
npm run ui:tokens:generate
npm run ui:tokens:check
```

`generated/generated-manifest.json` records the exact reference Git identity,
dirty state, source paths, output paths, byte counts, and SHA-256 digests. A dirty
snapshot is acceptable for development evidence but not for a release provenance
gate.

Global Tasks/Activity/Search reuse 14 allowlisted reference assets, with the
original bytes verified by the generated manifest. `src/discovery-icons.svg`
adds the exact `at-sign` (`fFe`) and `refresh-cw` (`lUe`) paths from Raft Web
`index-WTraJnrd.js` (SHA-256
`fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`). Its own digest
is pinned in the token test. These are supplementary exports; the frozen
reference is not edited. Full provenance and adaptations are described in
`docs/product/global-discovery-design.zh-CN.md`.

`src/interaction-icons.svg` also carries Raft's current `bell-off` (`pUe` / `Bw`)
geometry for muted channel rows. The complete supplementary sprite is SHA-256
pinned by `packages/ui-tokens/test/ui-tokens.test.ts`; product code never redraws
that glyph.
