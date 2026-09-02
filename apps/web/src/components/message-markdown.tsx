import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import "katex/dist/katex.min.css";

import {
  buildMermaidDocument,
  classifyMessageUrl,
  mermaidConfiguration,
  remarkBareCjkAutolinks,
  transformMessageUrl,
} from "../message-markdown-policy.ts";

const markdownSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./u, "math-inline", "math-display"],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
};

const remarkPlugins = [
  remarkGfm,
  remarkBareCjkAutolinks,
  remarkBreaks,
  remarkMath,
];
const rehypePlugins: NonNullable<
  Parameters<typeof Markdown>[0]["rehypePlugins"]
> = [
  [rehypeSanitize, markdownSchema],
  [rehypeKatex, { output: "htmlAndMathml", strict: "warn" }],
];

type OpenFile = (path: string) => void | Promise<void>;
const OpenFileContext = createContext<OpenFile | undefined>(undefined);

function MarkdownLink({ children, href }: ComponentPropsWithoutRef<"a">) {
  const onOpenFile = useContext(OpenFileContext);
  return (
    <MessageLink href={href} onOpenFile={onOpenFile}>
      {children}
    </MessageLink>
  );
}

// These are React component types, not formatting callbacks. Recreating them
// during polling remounts images, code blocks and sandboxed Mermaid iframes.
// Context keeps file actions current without changing any component identity.
const markdownComponents: Components = {
  a: MarkdownLink,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  code: ({ children, className }) => (
    <code className={className}>{children}</code>
  ),
  img: ({ alt, src, title }) =>
    typeof src === "string" && src !== "" ? (
      <img
        alt={alt ?? ""}
        decoding="async"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={src}
        title={title ?? undefined}
      />
    ) : (
      <span className="rah-markdown-image-blocked">[图片地址已阻止]</span>
    ),
  pre: ({ children }) => <MarkdownPre>{children}</MarkdownPre>,
  table: ({ children }) => (
    <div className="rah-markdown-table-scroll">
      <table>{children}</table>
    </div>
  ),
};

export function MessageMarkdown({
  onOpenFile,
  source,
}: {
  onOpenFile?: OpenFile;
  source: string;
}) {
  return (
    <OpenFileContext.Provider value={onOpenFile}>
      <div
        className="rah-message-markdown"
        data-raft-markdown-content=""
        translate="no"
      >
        <Markdown
          components={markdownComponents}
          rehypePlugins={rehypePlugins}
          remarkPlugins={remarkPlugins}
          skipHtml
          urlTransform={transformMessageUrl}
        >
          {source}
        </Markdown>
      </div>
    </OpenFileContext.Provider>
  );
}

function MessageLink({
  children,
  href,
  onOpenFile,
}: {
  children: ReactNode;
  href: string | undefined;
  onOpenFile: ((path: string) => void | Promise<void>) | undefined;
}) {
  if (href === undefined) return <span>{children}</span>;
  const classified = classifyMessageUrl(href);
  if (classified.kind === "blocked") return <span>{children}</span>;
  if (classified.kind === "file") {
    return (
      <FileReference onOpenFile={onOpenFile} path={classified.path}>
        {children}
      </FileReference>
    );
  }
  return (
    <a href={classified.url} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  );
}

function FileReference({
  children,
  onOpenFile,
  path,
}: {
  children: ReactNode;
  onOpenFile: ((path: string) => void | Promise<void>) | undefined;
  path: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );
  async function activate() {
    if (onOpenFile !== undefined) {
      await onOpenFile(path);
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1_200);
    } catch {
      // The visible path remains selectable when clipboard access is denied.
    }
  }
  return (
    <button
      className="rah-markdown-file"
      data-file-path={path}
      onClick={() => void activate()}
      title={
        onOpenFile === undefined ? `复制文件路径：${path}` : `打开 ${path}`
      }
      type="button"
    >
      {children}
      {copied ? <span aria-live="polite"> 已复制</span> : null}
    </button>
  );
}

function MarkdownPre({ children }: { children: ReactNode }) {
  const codeElement = singleCodeElement(children);
  if (codeElement === undefined) return <pre>{children}</pre>;
  const className = codeElement.props.className ?? "";
  if (/\b(?:math-display|language-math)\b/u.test(className)) {
    return <div className="rah-markdown-math-display">{children}</div>;
  }
  const code = nodeText(codeElement.props.children).replace(/\n$/u, "");
  const language = className.match(/\blanguage-([^\s]+)/u)?.[1];
  if (language?.toLowerCase() === "mermaid") {
    return <MermaidDiagram code={code} />;
  }
  return <HighlightedCode code={code} language={language} />;
}

type CodeElement = ReactElement<{
  children?: ReactNode;
  className?: string;
}>;

function singleCodeElement(children: ReactNode): CodeElement | undefined {
  const values = Children.toArray(children);
  if (values.length !== 1 || !isValidElement(values[0])) return undefined;
  const element = values[0] as CodeElement;
  return typeof element.props.className === "string" || element.type === "code"
    ? element
    : undefined;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

const highlightedCodeCache = new Map<string, Promise<string>>();

function highlightCode(code: string, language: string | undefined) {
  const key = `${language ?? "text"}\0${code}`;
  const cached = highlightedCodeCache.get(key);
  if (cached !== undefined) return cached;
  const highlighted = import("shiki")
    .then(({ codeToHtml }) =>
      codeToHtml(code, {
        lang: language ?? "text",
        theme: "github-dark",
      }),
    )
    .catch(() => "");
  highlightedCodeCache.set(key, highlighted);
  if (highlightedCodeCache.size > 64) {
    const oldest = highlightedCodeCache.keys().next().value;
    if (oldest !== undefined) highlightedCodeCache.delete(oldest);
  }
  return highlighted;
}

function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string | undefined;
}) {
  const [html, setHtml] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let current = true;
    setHtml(undefined);
    void highlightCode(code, language).then((result) => {
      if (current) setHtml(result);
    });
    return () => {
      current = false;
    };
  }, [code, language]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_200);
    } catch {
      // The code remains selectable when clipboard access is denied.
    }
  }
  return (
    <div className="rah-markdown-code">
      <button onClick={() => void copy()} type="button">
        {copied ? "已复制" : "复制"}
      </button>
      {html === undefined || html === "" ? (
        <pre>
          <code
            className={
              language === undefined ? undefined : `language-${language}`
            }
          >
            {code}
          </code>
        </pre>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

type MermaidResult = {
  height: number;
  srcDoc: string;
  width: number;
};

const mermaidCache = new Map<string, Promise<MermaidResult>>();
let mermaidSequence = 0;

function renderMermaid(code: string): Promise<MermaidResult> {
  const cached = mermaidCache.get(code);
  if (cached !== undefined) return cached;
  const rendered = import("mermaid")
    .then(async ({ default: mermaid }) => {
      mermaid.initialize(mermaidConfiguration);
      mermaid.detectType(code);
      await mermaid.parse(code);
      const { svg } = await mermaid.render(
        `rah-mermaid-${String(++mermaidSequence)}`,
        code,
      );
      const { height, width } = svgDimensions(svg);
      return { height, srcDoc: buildMermaidDocument(svg), width };
    })
    .catch((error: unknown) => {
      mermaidCache.delete(code);
      throw error;
    });
  mermaidCache.set(code, rendered);
  if (mermaidCache.size > 48) {
    const oldest = mermaidCache.keys().next().value;
    if (oldest !== undefined) mermaidCache.delete(oldest);
  }
  return rendered;
}

function MermaidDiagram({ code }: { code: string }) {
  const titleId = useId();
  const [result, setResult] = useState<MermaidResult>();
  const [error, setError] = useState(false);
  const [view, setView] = useState<"diagram" | "source">("diagram");
  useEffect(() => {
    let current = true;
    setResult(undefined);
    setError(false);
    void renderMermaid(code).then(
      (next) => {
        if (current) setResult(next);
      },
      () => {
        if (current) setError(true);
      },
    );
    return () => {
      current = false;
    };
  }, [code]);
  const status = error ? "error" : result === undefined ? "loading" : "valid";
  return (
    <figure
      aria-labelledby={titleId}
      className="rah-mermaid-diagram"
      data-mermaid-status={status}
    >
      <figcaption id={titleId}>
        <span>拓扑图</span>
        <span role="group" aria-label="拓扑图预览模式">
          <button
            aria-pressed={view === "diagram"}
            onClick={() => setView("diagram")}
            type="button"
          >
            图表
          </button>
          <button
            aria-pressed={view === "source"}
            onClick={() => setView("source")}
            type="button"
          >
            源码
          </button>
        </span>
      </figcaption>
      {view === "source" ? (
        <pre className="rah-mermaid-source">
          <code>{code}</code>
        </pre>
      ) : error ? (
        <p role="alert">无法渲染此 Mermaid 图表。</p>
      ) : result === undefined ? (
        <p role="status">正在渲染图表…</p>
      ) : (
        <iframe
          sandbox=""
          srcDoc={result.srcDoc}
          style={{
            aspectRatio: `${String(result.width)} / ${String(result.height)}`,
          }}
          title="Mermaid 拓扑图"
        />
      )}
    </figure>
  );
}

function svgDimensions(svg: string): { height: number; width: number } {
  const viewBox = svg.match(
    /viewBox\s*=\s*["']\s*[\d.eE+-]+\s+[\d.eE+-]+\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s*["']/u,
  );
  if (viewBox !== null) {
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    if (width > 0 && height > 0) return { height, width };
  }
  const width = Number(svg.match(/\bwidth\s*=\s*["']\s*([\d.]+)/u)?.[1]);
  const height = Number(svg.match(/\bheight\s*=\s*["']\s*([\d.]+)/u)?.[1]);
  return width > 0 && height > 0 ? { height, width } : { height: 3, width: 4 };
}
