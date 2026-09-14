/** A user-requested reload gets a fresh module URL graph, including relative imports.
 * WebKit can retain failed modules across normal navigation to the same asset URLs.
 * This aliases frozen assets only; it never exposes API or filesystem paths. */
export function recoveryAssetPath(path: string): string | undefined {
  const match =
    /^\/_rah\/recover\/[0-9]{10,20}\/assets\/([A-Za-z0-9_./-]+)$/.exec(path);
  if (
    !match ||
    match[1]!
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  )
    return undefined;
  return `/assets/${match[1]}`;
}
export function recoveryShell(html: string, nonce: string | null): string {
  if (!nonce || !/^[0-9]{10,20}$/.test(nonce)) return html;
  return html.replace(
    /(<script\b[^>]*\bsrc=")\/assets\//g,
    `$1/_rah/recover/${nonce}/assets/`,
  );
}
