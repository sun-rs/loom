# Local delivery of official fonts

`raft-ui` 0.5.64 `dist/fonts.css` defines Hanken Grotesk for Brutal,
Geist/Inter for Elegant and Geist Mono for monospace. `faces.css` is the
Google Fonts response to that exact stylesheet URL, fetched 2026-10-16 with a
modern Chromium User-Agent. Family, weight, display and unicode ranges are
preserved. `provenance.json` records each original URL and SHA-256.

The additional Hanken Grotesk v12 asset preserves the official Web
`src/index.css` `Raft Quote Glyphs` U+0022 fallback. Its existing face rule is
retained; only delivery changes. Do not substitute the old Space Grotesk assets.

All four font families use the SIL Open Font License, included alongside the
assets. License sources: `https://github.com/google/fonts/tree/main/ofl/`
(`geist`, `geistmono`, `hankengrotesk`, `inter`). Upstream web source remains
unchanged. Loom's PostCSS integration replaces external font references with
these files; Vite hashes/emits them into the same-origin product bundle. Builds
perform no network fetch, and unmapped Google font references fail the build.
