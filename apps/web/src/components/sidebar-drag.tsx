import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createContext, useContext } from "react";
import {
  DndContext,
  MouseSensor,
  KeyboardSensor,
  DragOverlay,
  useSensor,
  useSensors,
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
  sections,
  onReorder,
}: {
  children: ReactNode;
  sections: string[];
  onReorder: (order: string[]) => void;
  labels: Record<string, string>;
  onDrop: (key: string, section: SidebarSectionId, target?: string) => void;
}) {
  const sensors = useSensors(
    // Touch belongs to native scrolling and the context-menu long press.
    // PointerSensor also captures touch and competes with those gestures.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [active, setActive] = useState<string>();
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const group = String(args.active.id).startsWith("group:");
        const scoped = {
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (c) => String(c.id).startsWith("group:") === group,
          ),
        };
        const hits = pointerWithin(scoped);
        return hits.length
          ? hits.sort(
              (a, b) =>
                Number(String(a.id).startsWith("zone:")) -
                Number(String(b.id).startsWith("zone:")),
            )
          : closestCenter(scoped);
      }}
      onDragStart={(e) => setActive(String(e.active.id))}
      onDragCancel={() => setActive(undefined)}
      onDragEnd={(e) => {
        setActive(undefined);
        if (String(e.active.id).startsWith("group:")) {
          const from = sections.indexOf(String(e.active.id).slice(6)),
            to = sections.indexOf(String(e.over?.id).slice(6));
          if (from >= 0 && to >= 0 && from !== to) {
            const order = [...sections];
            order.splice(to, 0, order.splice(from, 1)[0]!);
            onReorder(order);
          }
          return;
        }
        const over = e.over?.data.current;
        if (over) onDrop(String(e.active.id), over.section, over.key);
      }}
    >
      <SortableContext
        items={sections.map((s) => `group:${s}`)}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
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
  items,
}: {
  items: string[];
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
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
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
  const drag = useSortable({
    id: itemKey,
    disabled,
    data: { section, key: itemKey },
  });
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
      }}
      {...drag.attributes}
      {...drag.listeners}
      className={`rah-sidebar-sortable${drag.isDragging ? " is-dragging" : ""}${drag.isOver ? " is-over" : ""}`}
      style={{
        transform: CSS.Transform.toString(drag.transform),
        transition: drag.transition,
        opacity: drag.isDragging ? 0.12 : 1,
      }}
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

const GroupHandle = createContext<ReturnType<typeof useSortable> | null>(null);
export function useSidebarGroupHandle() {
  return useContext(GroupHandle);
}
export function SidebarSortableGroup({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const sortable = useSortable({ id: `group:${id}` });
  return (
    <GroupHandle.Provider value={sortable}>
      <div
        ref={sortable.setNodeRef}
        data-sidebar-group={id}
        style={{
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
          opacity: sortable.isDragging ? 0.6 : 1,
        }}
      >
        {children}
      </div>
    </GroupHandle.Provider>
  );
}
