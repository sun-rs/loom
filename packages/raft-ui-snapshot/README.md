# Raft UI reference snapshot

This private package is an immutable, evidence-only snapshot imported from the
separate `raft-ui` repository. `snapshot-manifest.json` records the source Git
HEAD, dirty state, byte length, and SHA-256 of every imported file.

- `reference/*.html` and its JavaScript remain runnable comparison surfaces.
- Product code may consume allowlisted CSS, fonts, icons, and protocol metadata.
- Product code must not load the reference adapter, reference HTML, or Raft
  fixture state.
- RAH OS never imports from a sibling checkout at runtime.

Refresh deliberately from the repository root:

```bash
npm run ui:snapshot:import -- /absolute/path/to/raft-ui
npm run ui:snapshot:check
```

The source checkout may be dirty; file hashes, rather than Git HEAD alone, are
the exact captured identity.
