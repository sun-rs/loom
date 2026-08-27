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
