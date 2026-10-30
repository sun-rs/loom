/** Parser-owned chrome, before app/CSS chunks; native page surfaces stay in React.
 * Six-digit fallback values match the pinned official frame resolver. No CSP
 * weakening or inline script: this is critical CSS plus one noninteractive edge.
 */
export function pwaChromeHtml(html: string) {
  const marker = '<script src="/app-theme-bootstrap.js"></script>';
  if (
    html.split(marker).length !== 2 ||
    html.split('<div id="root"').length !== 2
  )
    throw Error("PWA parser shell seam changed");
  const css = `
html { --loom-browser-chrome: #FFD440; background-color: var(--layer-frame, var(--loom-browser-chrome)); }
html.dark { --loom-browser-chrome: #0D0D0B; }
@media (prefers-color-scheme: dark) { html:not(.light) { --loom-browser-chrome: #0D0D0B; } }
[data-testid="pwa-status-bar-surface"] {
  display: var(--loom-installed-edge, none); position: fixed; inset: 0 0 auto;
  height: max(5px, env(safe-area-inset-top, 0px));
  background-color: var(--layer-frame, var(--loom-browser-chrome));
  pointer-events: none; z-index: 101;
}
html[data-loom-installed="true"] { --loom-installed-edge: block; }
html[data-loom-installed="true"] body { background-color: var(--layer-frame, var(--loom-browser-chrome)); }
@media (display-mode: standalone), (display-mode: fullscreen) {
  html { --loom-installed-edge: block; }
  body { background-color: var(--layer-frame, var(--loom-browser-chrome)); }
}
`;
  const appleStatus =
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />';
  if (html.split(appleStatus).length !== 2)
    throw Error("PWA Apple metadata seam changed");
  // The external bootstrap is parser-blocking. Apple fullscreen/status metadata
  // must already exist when a slow network pauses at that script.
  return html
    .replace(marker, "")
    .replace(
      appleStatus,
      appleStatus +
        `\n<style id="loom-pwa-first-paint">${css}</style>\n${marker}`,
    )
    .replace(
      '<div id="root"',
      '<div aria-hidden="true" data-testid="pwa-status-bar-surface"></div>\n    <div id="root"',
    );
}
