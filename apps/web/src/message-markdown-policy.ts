export type MessageUrlClassification =
  | { kind: "blocked" }
  | { kind: "external"; url: string }
  | { kind: "file"; path: string }
  | { kind: "relative"; url: string };

const externalLinkProtocols = new Set([
  "http:",
  "https:",
  "irc:",
  "ircs:",
  "mailto:",
  "xmpp:",
]);
const imageProtocols = new Set(["http:", "https:"]);
const schemePattern = /^([a-z][a-z\d+.-]*):/iu;
const unsafeCharactersPattern = /[\u0000-\u001f\u007f]/u;

export function classifyMessageUrl(url: string): MessageUrlClassification {
  const normalized = url.trim();
  if (normalized === "" || unsafeCharactersPattern.test(normalized)) {
    return { kind: "blocked" };
  }
  const scheme = normalized.match(schemePattern)?.[1]?.toLowerCase();
  if (scheme === "file") {
    try {
      const parsed = new URL(normalized);
      if (parsed.hostname !== "" && parsed.hostname !== "localhost") {
        return { kind: "blocked" };
      }
      return {
        kind: "file",
        path: `${decodeURIComponent(parsed.pathname)}${parsed.hash}`,
      };
    } catch {
      return { kind: "blocked" };
    }
  }
  if (scheme !== undefined) {
    const protocol = `${scheme}:`;
    return externalLinkProtocols.has(protocol)
      ? { kind: "external", url: normalized }
      : { kind: "blocked" };
  }
  if (normalized.startsWith("//")) {
    return { kind: "external", url: normalized };
  }
  return { kind: "relative", url: normalized };
}

export function transformMessageUrl(
  url: string,
  key: string,
): string | undefined {
  const classified = classifyMessageUrl(url);
  if (classified.kind === "blocked") return "";
  if (key === "src") {
    if (classified.kind === "file") return "";
    if (classified.kind === "external") {
      const scheme = classified.url.match(schemePattern)?.[1]?.toLowerCase();
      if (scheme !== undefined && !imageProtocols.has(`${scheme}:`)) return "";
    }
  }
  if (classified.kind === "file") return url;
  return classified.url;
}

/** Mirrors the security and light-theme inputs extracted from Raft's bundle. */
export const mermaidConfiguration = Object.freeze({
  startOnLoad: false,
  suppressErrorRendering: true,
  securityLevel: "strict" as const,
  theme: "base" as const,
  htmlLabels: false,
  themeVariables: Object.freeze({
    background: "#ffffff",
    primaryColor: "#ffffff",
    primaryTextColor: "#141111",
    primaryBorderColor: "#141111",
    lineColor: "#141111",
    secondaryColor: "#f5f0e8",
    tertiaryColor: "#ffffff",
  }),
});

/**
 * Mermaid output is never inserted into the application DOM. It is projected
 * through a scriptless sandboxed iframe with the same CSP boundary used by
 * Raft's current web renderer.
 */
export function buildMermaidDocument(svg: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" ',
    "content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\">",
    "<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}",
    "svg{display:block;width:100%;max-width:none!important;height:auto}</style></head>",
    `<body>${svg}</body></html>`,
  ].join("");
}
