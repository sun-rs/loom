import type {
  AttachmentPreviewKind,
  AttachmentCommentsResponse,
} from "@rah-os/protocol";

export type AttachmentAnchor = NonNullable<
  AttachmentCommentsResponse["comments"][number]["anchor"]
>;
type Target =
  | { kind: "lines" | "rows"; start: number; end: number }
  | { kind: "heading"; id: string }
  | { kind: "time"; seconds: number }
  | { kind: "html-region" };

// Structural port of Raft Web Q8e: immutable rendered locations, at most 201
// highlighted rows. Unknown metadata never becomes a selector or executable URL.
export function attachmentAnchorTarget(
  anchor: AttachmentAnchor,
  kind: AttachmentPreviewKind,
): Target | undefined {
  const { type, data } = anchor;
  if (type === "html-region" && kind === "html") {
    const valid = [
      data.x,
      data.y,
      data.w,
      data.h,
      data.viewportWidth,
      data.documentWidth,
      data.documentHeight,
    ].every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 10_000_000,
    );
    if (
      valid &&
      (data.quote === undefined ||
        (typeof data.quote === "string" && data.quote.length <= 1000))
    )
      return { kind: "html-region" };
    return;
  }
  if (
    (type === "lines" && (kind === "text" || kind === "diff")) ||
    (type === "csv-rows" && kind === "csv")
  ) {
    const start = data.start,
      end = data.end ?? start;
    if (
      typeof start !== "number" ||
      !Number.isSafeInteger(start) ||
      start < 1 ||
      typeof end !== "number" ||
      !Number.isSafeInteger(end) ||
      end < start
    )
      return;
    return {
      kind: type === "lines" ? "lines" : "rows",
      start,
      end: Math.min(end, start + 200),
    };
  }
  if (
    type === "md-section" &&
    kind === "markdown" &&
    typeof data.headingId === "string" &&
    data.headingId.length > 0 &&
    data.headingId.length <= 512
  )
    return { kind: "heading", id: data.headingId };
  if (
    type === "video-timestamp" &&
    kind === "video" &&
    typeof data.time === "number" &&
    Number.isFinite(data.time) &&
    data.time >= 0
  )
    return { kind: "time", seconds: data.time };
  return;
}

export function attachmentAnchorLabel(anchor: AttachmentAnchor): string {
  const { type, data } = anchor;
  if (type === "lines" || type === "csv-rows")
    return `第 ${String(data.start)}${data.end !== undefined && data.end !== data.start ? `–${String(data.end)}` : ""} 行`;
  if (type === "md-section")
    return `§ ${String(data.headingTitle ?? data.headingId).slice(0, 200)}`;
  if (
    type === "video-timestamp" &&
    typeof data.time === "number" &&
    Number.isFinite(data.time) &&
    data.time >= 0
  )
    return `${Math.floor(data.time / 60)}:${String(Math.floor(data.time % 60)).padStart(2, "0")}`;
  if (type === "html-region") return "HTML 区域";
  return "位置不可用";
}

export function orderAttachmentComments<
  T extends { createdAt: string; anchor: AttachmentAnchor | null },
>(comments: readonly T[]): T[] {
  const position = (anchor: AttachmentAnchor | null) => {
    if (!anchor) return -1;
    const value = anchor.data.start ?? anchor.data.time ?? anchor.data.y;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  return [...comments].sort(
    (a, b) =>
      position(a.anchor) - position(b.anchor) ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

export function jumpToAttachmentAnchor(
  scope: HTMLElement,
  anchor: AttachmentAnchor,
  kind: AttachmentPreviewKind,
): boolean {
  const target = attachmentAnchorTarget(anchor, kind);
  if (!target) return false;
  if (target.kind === "html-region") {
    const frame = scope.querySelector("iframe");
    if (!frame || frame.dataset.rahHtmlReady !== "true") return false;
    frame.dispatchEvent(new CustomEvent("rah-html-jump", { detail: anchor }));
    return true;
  }
  if (target.kind === "time") {
    const video = scope.querySelector("video");
    if (
      !video ||
      Number.isNaN(video.duration) ||
      (Number.isFinite(video.duration) && target.seconds > video.duration)
    )
      return false;
    video.pause();
    video.currentTime = target.seconds;
    return true;
  }
  const elements: HTMLElement[] = [];
  if (target.kind === "heading") {
    const element = scope.querySelector<HTMLElement>(
      `[data-anchor-heading="${CSS.escape(target.id)}"]`,
    );
    if (element) elements.push(element);
  } else {
    const attr =
      target.kind === "lines" ? "data-anchor-line" : "data-anchor-row";
    for (let i = target.start; i <= target.end; i++) {
      const element = scope.querySelector<HTMLElement>(`[${attr}="${i}"]`);
      if (element) elements.push(element);
    }
  }
  if (!elements.length) return false;
  elements[0]!.scrollIntoView({ behavior: "smooth", block: "center" });
  for (const element of elements) {
    element.classList.remove("rah-anchor-flash");
    void element.offsetWidth;
    element.classList.add("rah-anchor-flash");
    element.addEventListener(
      "animationend",
      () => element.classList.remove("rah-anchor-flash"),
      { once: true },
    );
  }
  return true;
}

export function attachmentAnchorAt(
  scope: HTMLElement,
  node: Node | null,
  kind: AttachmentPreviewKind,
): AttachmentAnchor | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element || !scope.contains(element)) return;
  const line = element.closest<HTMLElement>(
    "[data-anchor-line], [data-anchor-row]",
  );
  if (line) {
    const csv = line.hasAttribute("data-anchor-row"),
      start = Number(csv ? line.dataset.anchorRow : line.dataset.anchorLine);
    return {
      type: csv ? "csv-rows" : "lines",
      data: {
        start,
        end: start,
        quote: (line.textContent ?? "").trim().slice(0, 1000),
      },
    };
  }
  if (kind === "markdown") {
    const headings = [
      ...scope.querySelectorAll<HTMLElement>("[data-anchor-heading]"),
    ];
    const heading = headings
      .reverse()
      .find(
        (h) =>
          h === element ||
          h.contains(element) ||
          !!(
            h.compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
      );
    if (heading)
      return {
        type: "md-section",
        data: {
          headingId: heading.dataset.anchorHeading,
          headingTitle: heading.textContent ?? "",
          quote: (element.textContent ?? "").slice(0, 1000),
        },
      };
  }
  return;
}
