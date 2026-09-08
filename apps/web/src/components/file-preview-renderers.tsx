import { HtmlFilePreview } from "./html-file-preview.tsx";
import type { AttachmentAnchor } from "../attachment-comment-anchors.ts";
import { useLayoutEffect, useRef } from "react";
import type { AttachmentPreviewKind } from "@rah-os/protocol";
import { MessageMarkdown } from "./message-markdown.tsx";

export const MAX_RENDERED_PREVIEW_CHARACTERS = 300_000;
export const MAX_CSV_PREVIEW_ROWS = 200;
const MAX_CSV_PREVIEW_COLUMNS = 50;
const MAX_DIFF_PREVIEW_LINES = 5_000;

export function AttachmentTextPreview({
  filename,
  kind,
  text,
  commentMode = false,
  onAnchor,
}: {
  filename: string;
  kind: Exclude<
    AttachmentPreviewKind,
    "image" | "unsupported" | "pdf" | "video" | "audio"
  >;
  text: string;
  commentMode?: boolean;
  onAnchor?: (anchor: AttachmentAnchor) => void;
}) {
  if (kind === "markdown") {
    const clipped = clipText(text);
    return (
      <MarkdownFilePreview text={clipped.value} truncated={clipped.truncated} />
    );
  }
  if (kind === "html") {
    const clipped = clipText(text);
    return (
      <div className="rah-file-preview-html">
        <PreviewTruncation truncated={clipped.truncated} />
        <HtmlFilePreview
          filename={filename}
          text={clipped.value}
          commentMode={commentMode}
          onAnchor={onAnchor}
        />
      </div>
    );
  }
  if (kind === "diff") return <DiffPreview text={text} />;
  if (kind === "csv") return <CsvPreview filename={filename} text={text} />;
  const clipped = clipText(text);
  const lines = clipped.value.split("\n");
  return (
    <>
      <PreviewTruncation
        truncated={clipped.truncated || lines.length > MAX_DIFF_PREVIEW_LINES}
      />
      <pre className="rah-file-preview-text">
        {lines.slice(0, MAX_DIFF_PREVIEW_LINES).map((line, index) => (
          <span data-anchor-line={index + 1} key={index}>
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
    </>
  );
}

function clipText(text: string) {
  return text.length <= MAX_RENDERED_PREVIEW_CHARACTERS
    ? { truncated: false, value: text }
    : {
        truncated: true,
        value: text.slice(0, MAX_RENDERED_PREVIEW_CHARACTERS),
      };
}

function PreviewTruncation({ truncated }: { truncated: boolean }) {
  return truncated ? (
    <p className="rah-file-preview-truncated" role="status">
      预览已截断；下载文件可查看完整内容。
    </p>
  ) : null;
}

function DiffPreview({ text }: { text: string }) {
  const clipped = clipText(text);
  const allLines = clipped.value.split("\n");
  const lines = allLines.slice(0, MAX_DIFF_PREVIEW_LINES);
  const truncated = clipped.truncated || allLines.length > lines.length;
  return (
    <div className="rah-file-preview-diff">
      <PreviewTruncation truncated={truncated} />
      <pre>
        {lines.map((line, index) => (
          <span
            className={"rah-file-preview-diff-line" + diffLineClass(line)}
            key={index}
            data-anchor-line={index + 1}
          >
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return " is-header";
  if (line.startsWith("+")) return " is-addition";
  if (line.startsWith("-")) return " is-deletion";
  if (line.startsWith("@@")) return " is-range";
  return "";
}

function CsvPreview({ filename, text }: { filename: string; text: string }) {
  const clipped = clipText(text);
  const delimiter = filename.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const parsed = parseDelimited(clipped.value, delimiter);
  return (
    <div className="rah-file-preview-csv">
      <PreviewTruncation truncated={clipped.truncated || parsed.truncated} />
      <table>
        <tbody>
          {parsed.rows.map((row, rowIndex) => (
            <tr key={rowIndex} data-anchor-row={rowIndex + 1}>
              {row.slice(0, MAX_CSV_PREVIEW_COLUMNS).map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;
  while (index < text.length && rows.length < MAX_CSV_PREVIEW_ROWS) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
    index += 1;
  }
  if (rows.length < MAX_CSV_PREVIEW_ROWS && (cell !== "" || row.length > 0)) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, truncated: index < text.length };
}

// Local renderer IDs are deterministic for immutable attachment bytes. They do
// not change the global Markdown renderer or execute HTML attachment content.
function MarkdownFilePreview({
  text,
  truncated,
}: {
  text: string;
  truncated: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current
      ?.querySelectorAll<HTMLElement>("h1, h2, h3")
      .forEach((heading, index) => {
        heading.dataset.anchorHeading = `attachment-section-${index + 1}`;
      });
  }, [text]);
  return (
    <div className="rah-file-preview-markdown" ref={root}>
      <PreviewTruncation truncated={truncated} />
      <MessageMarkdown source={text} />
    </div>
  );
}
