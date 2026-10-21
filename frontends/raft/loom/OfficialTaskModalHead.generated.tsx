// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { PanelHeading, PanelSection, Separator } from "raft-ui";
import type { Task } from "../packages/web/src/store/taskStore";
import ShowMoreToggle from "@loom/raft-web-source/ShowMoreToggle";
import TaskProperties from "./TaskProperties.tsx";
const DESCRIPTION_COLLAPSE_LINE_LIMIT = 3;
const DESCRIPTION_FALLBACK_LINE_HEIGHT_PX = 20;
const DESCRIPTION_COLLAPSE_HEIGHT_EPSILON_PX = 1;
function getDescriptionLineHeightPx(element: HTMLElement): number {
  const computedStyle = window.getComputedStyle(element);
  const lineHeight = Number.parseFloat(computedStyle.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;

  const fontSize = Number.parseFloat(computedStyle.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) return fontSize * 1.4;

  return DESCRIPTION_FALLBACK_LINE_HEIGHT_PX;
}
function descriptionExceedsCollapsedHeight(element: HTMLElement): boolean {
  const collapsedHeight = getDescriptionLineHeightPx(element) * DESCRIPTION_COLLAPSE_LINE_LIMIT;
  return element.scrollHeight > collapsedHeight + DESCRIPTION_COLLAPSE_HEIGHT_EPSILON_PX;
}
export default function TaskModalHead({ task }: { task: Task }) {
  const { formatMessage } = useIntl();
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);
  const [descriptionExpansion, setDescriptionExpansion] = useState({ key: "", expanded: false });
  const [descriptionOverflow, setDescriptionOverflow] = useState({ key: "", collapsible: false });
  const description = task.description?.trim();
  const descriptionKey = `${task.id}:${description ?? ""}`;
  const descriptionExpanded = descriptionExpansion.key === descriptionKey && descriptionExpansion.expanded;
  const descriptionCollapsible =
    description ? descriptionOverflow.key === descriptionKey && descriptionOverflow.collapsible : false;
  const descriptionCollapsed = descriptionCollapsible && !descriptionExpanded;

  useLayoutEffect(() => {
    if (!description) {
      setDescriptionOverflow({ key: "", collapsible: false });
      return;
    }

    const element = descriptionRef.current;
    if (!element) return;

    const measure = () => {
      const nextCollapsible = descriptionExceedsCollapsedHeight(element);
      setDescriptionOverflow((current) =>
        current.key === descriptionKey && current.collapsible === nextCollapsible
          ? current
          : { key: descriptionKey, collapsible: nextCollapsible },
      );
    };

    measure();

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            measure();
          });
    observer?.observe(element);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [description, descriptionKey]);

  const toggleDescriptionExpanded = useCallback(() => {
    setDescriptionExpansion((cur) => ({
      key: descriptionKey,
      expanded: cur.key === descriptionKey ? !cur.expanded : true,
    }));
  }, [descriptionKey]);

  return (
    <>
      <PanelSection className="border-t-0 bg-layer-canvas">
        {/* Number sits inline with the title, GitHub/Linear style: it is part of
            how the task is named, not separate metadata. Kept non-bold and muted
            so it reads as an identifier rather than competing with the title. */}
        {/* The number lives in the persistent bar, not here. Rendering it in both
            places put the same identifier twice within ~30px; the bar's copy is
            the one that survives scrolling, so this one goes. */}
        <PanelHeading className="mb-2 line-clamp-3 break-words" data-testid="task-modal-title">{task.title}</PanelHeading>

        {/* No placeholder when there is no description: nothing to say is not
            worth a line of chrome, and today essentially every task has none. */}
        {description && (
          <div className="mb-3">
            <p
              ref={descriptionRef}
              id={`task-modal-description-${task.id}`}
              className={`whitespace-pre-wrap break-words text-subhead text-foreground-muted ${
                descriptionCollapsed ? "line-clamp-3" : ""
              }`}
              data-testid="task-modal-description"
            >
              {description}
            </p>
            {descriptionCollapsible && (
              <ShowMoreToggle
                expanded={descriptionExpanded}
                collapsedLabel={formatMessage({ id: "message.content.showMore" })}
                expandedLabel={formatMessage({ id: "message.content.collapse" })}
                aria-controls={`task-modal-description-${task.id}`}
                aria-expanded={descriptionExpanded}
                onClick={toggleDescriptionExpanded}
                className="mt-1"
                data-testid="task-modal-description-toggle"
              />
            )}
          </div>
        )}

        <TaskProperties task={task} />
      </PanelSection>
      <Separator />
    </>
  );
}
