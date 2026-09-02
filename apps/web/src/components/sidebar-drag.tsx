import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  DragOverlay,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  closestCenter,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";
import type { SidebarSectionId } from "../sidebar-order.ts";
export function SidebarDrag({
  children,
  onDrop,
  labels,
}: {
  children: ReactNode;
  labels: Record<string, string>;
  onDrop: (key: string, section: SidebarSectionId, target?: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const [active, setActive] = useState<string>();
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const hits = pointerWithin(args);
        return hits.length
          ? hits.sort(
              (a, b) =>
                Number(String(a.id).startsWith("zone:")) -
                Number(String(b.id).startsWith("zone:")),
            )
          : closestCenter(args);
      }}
      onDragStart={(e) => setActive(String(e.active.id))}
      onDragCancel={() => setActive(undefined)}
      onDragEnd={(e) => {
        setActive(undefined);
        const over = e.over?.data.current;
        if (over) onDrop(String(e.active.id), over.section, over.key);
      }}
    >
      {children}
      <DragOverlay>
        {active ? (
          <div className="rah-sidebar-drag-preview">{labels[active]}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
export function SidebarDropZone({
  section,
  children,
}: {
  section: SidebarSectionId;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `zone:${section}`,
    data: { section },
  });
  return (
    <div
      ref={setNodeRef}
      data-sidebar-drop={section}
      className={isOver ? "rah-sidebar-drop is-over" : "rah-sidebar-drop"}
    >
      {children}
    </div>
  );
}
export function SidebarDragItem({
  itemKey,
  section,
  disabled,
  children,
  onPin,
  pinned,
}: {
  itemKey: string;
  section: SidebarSectionId;
  disabled: boolean;
  children: ReactNode;
  onPin: () => void;
  pinned: boolean;
}) {
  const drag = useDraggable({
      id: itemKey,
      disabled,
      data: { section, key: itemKey },
    }),
    drop = useDroppable({
      id: `target:${itemKey}`,
      data: { section, key: itemKey },
    });
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      {...drag.attributes}
      {...drag.listeners}
      className={`rah-sidebar-sortable${drag.isDragging ? " is-dragging" : ""}${drop.isOver ? " is-over" : ""}`}
      data-sidebar-key={itemKey}
      aria-label="拖动会话；Alt+P 置顶或取消置顶"
      onKeyDown={(e) => {
        if (e.altKey && e.key.toLowerCase() === "p") {
          e.preventDefault();
          onPin();
        } else drag.listeners?.onKeyDown?.(e);
      }}
    >
      {children}
      <button
        className="rah-sidebar-pin-keyboard rah-interaction-flat"
        type="button"
        disabled={disabled}
        onClick={onPin}
      >
        {pinned ? "取消置顶" : "置顶会话"}
      </button>
    </div>
  );
}
