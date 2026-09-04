# RAH Neo-Brutalist UI — visual resources

This existing package is the maintained visual resource owner for RAH OS.
Read the [design standard](../../docs/design/neo-brutalist-ui.md) and
[library catalog](./neo-brutalist-library.json).

## Use

```ts
import "@rah-os/ui-tokens/neo-brutalist.css";
```

The entry loads adopted base/family styles and shared interaction/panel protocols
once. Asset exports remain available for sprites, fonts and avatars. Pages must
not assemble a second CSS stack. `apps/web/src/product-styles.ts` adds remaining
page styles until those families migrate. No sibling checkout is required.

## Maintain

Edit `src/neo-brutalist` directly. No generator overwrites it from `raft-ui`.
`adoption.json` records initial snapshot identity and per-file origin hashes
separately from local changes. `maintained-source` files may change with a reason
and tests. `immutable-asset` files retain byte identity; a new asset requires new
source evidence instead of silently changing an old one.

Historical extraction comments in `extracted/` identify origin, not an available
generator or a ban on maintaining adopted CSS. Reference reconstruction is not
official source. Frozen evidence retains the original provenance and notices.

`src/discovery-icons.svg` and `src/interaction-icons.svg` preserve additional
paths from Raft bundles. Their digests/landmarks remain pinned in token tests.
There is no procedural avatar generator or replacement icon style.

Run `npm run ui:tokens:check` and `npm run check:ui-library`, then the browser
matrix for visual changes. Never modify frozen reference evidence to pass a test.
