import type { AttachmentPreviewKind } from "@rah-os/protocol";
import { MessageMarkdown } from "./message-markdown.tsx";

export const MAX_RENDERED_PREVIEW_CHARACTERS = 300_000;
export const MAX_CSV_PREVIEW_ROWS = 200;
const MAX_CSV_PREVIEW_COLUMNS = 50;
const MAX_DIFF_PREVIEW_LINES = 5_000;
const HTML_PREVIEW_CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'\">";

export function AttachmentTextPreview({
  filename,
  kind,
  text,
}: {
  filename: string;
  kind: Exclude<AttachmentPreviewKind, "image" | "unsupported">;
  text: string;
}) {
  if (kind === "markdown") {
    const clipped = clipText(text);
    return (
      <div className="rah-file-preview-markdown">
        <PreviewTruncation truncated={clipped.truncated} />
        <MessageMarkdown source={clipped.value} />
      </div>
    );
  }
  if (kind === "html") {
    const clipped = clipText(text);
    return (
      <div className="rah-file-preview-html">
        <PreviewTruncation truncated={clipped.truncated} />
        <iframe
          sandbox=""
          srcDoc={hardenHtmlPreview(clipped.value)}
          title={"HTML 预览 " + filename}
        />
      </div>
    );
  }
  if (kind === "diff") return <DiffPreview text={text} />;
  if (kind === "csv") return <CsvPreview filename={filename} text={text} />;
  const clipped = clipText(text);
  return (
    <>
      <PreviewTruncation truncated={clipped.truncated} />
      <pre className="rah-file-preview-text">{clipped.value}</pre>
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

function hardenHtmlPreview(source: string): string {
  return /<head(?:\s[^>]*)?>/iu.test(source)
    ? source.replace(/<head(?:\s[^>]*)?>/iu, (head) => head + HTML_PREVIEW_CSP)
    : HTML_PREVIEW_CSP + source;
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
            <tr key={rowIndex}>
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
