import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function CollapsibleMessage({
  children,
  collapse,
  messageId,
}: {
  children: ReactNode;
  collapse: boolean;
  messageId: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const [overflow, setOverflow] = useState(false);
  expandedRef.current = expanded;

  useEffect(() => {
    setExpanded(false);
  }, [collapse, messageId]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null || !collapse) {
      setOverflow(false);
      return;
    }
    let frame = 0;
    const measure = () => {
      if (expandedRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setOverflow(content.scrollHeight > content.clientHeight + 1);
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(content);
    if (content.firstElementChild instanceof HTMLElement)
      resize.observe(content.firstElementChild);
    const mutation = new MutationObserver(measure);
    mutation.observe(content, { childList: true, subtree: true });
    content.addEventListener("load", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      content.removeEventListener("load", measure, true);
    };
  }, [collapse, messageId]);

  return (
    <div
      className="rah-collapsible-message"
      data-collapsed={collapse && !expanded}
      data-long-message={overflow}
    >
      <div className="rah-collapsible-message-content" ref={contentRef}>
        {children}
      </div>
      {collapse && overflow ? (
        <button
          className="rah-long-message-toggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "收起" : "展开全文"}
        </button>
      ) : null}
    </div>
  );
}
