import {
  moveSidebarPreview,
  sidebarAccepts,
  type SidebarDragLayout,
} from "../sidebar-drag-layout.ts";
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
  type DragOverEvent,
} from "@dnd-kit/core";
import { useRef, useState, type ReactNode } from "react";
import type { SidebarSectionId } from "../sidebar-order.ts";
export function SidebarDrag({
  children,
  labels,
  layout,
  onCommit,
  disabled = false,
  manualSections,
}: {
  children: (layout: SidebarDragLayout) => ReactNode;
  labels: Record<string, string>;
  layout: SidebarDragLayout;
  onCommit: (layout: SidebarDragLayout) => Promise<boolean>;
  disabled?: boolean;
  manualSections: string[];
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [active, setActive] = useState<string>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<SidebarDragLayout>();
  const draft = useRef<SidebarDragLayout | undefined>(undefined);
  const original = useRef<SidebarDragLayout | undefined>(undefined);
  const saving = useRef(false);
  const shown = preview ?? layout;
  const cancel = () => {
    draft.current = undefined;
    original.current = undefined;
    setPreview(undefined);
    setActive(undefined);
  };
  const save = async (next: SidebarDragLayout) => {
    setActive(undefined);
    saving.current = true;
    draft.current = next;
    setPreview(next);
    try {
      if (!(await onCommit(next))) setError("侧栏排序未保存，请重试");
    } finally {
      saving.current = false;
      cancel();
    }
  };
  const previewMove = ({ active: dragging, over }: DragOverEvent) => {
    const current = draft.current,
      target = over?.data.current;
    if (
      !current ||
      !over ||
      !target ||
      String(dragging.id).startsWith("group:")
    )
      return;
    if (!manualSections.includes(target.section)) return;
    // Same-container displacement belongs to useSortable. Mutating that list
    // here as well restarts its geometry/transition while the pointer moves.
    const source = Object.keys(current.items).find((id) =>
      current.items[id]?.includes(String(dragging.id)),
    );
    if (source === target.section) return;
    const rect =
      dragging.rect.current.translated ?? dragging.rect.current.initial;
    const after = rect
      ? rect.top + rect.height / 2 >= over.rect.top + over.rect.height / 2
      : false;
    const items = moveSidebarPreview(
      current.items,
      String(dragging.id),
      target.section,
      target.key,
      after,
    );
    if (items !== current.items) {
      const next = { ...current, items };
      draft.current = next;
      setPreview(next);
    }
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const key = String(args.active.id),
          group = key.startsWith("group:");
        const scoped = {
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => {
            if (group) return String(c.id).startsWith("group:");
            const section = c.data.current?.section;
            return (
              section &&
              manualSections.includes(section) &&
              sidebarAccepts(key, section)
            );
          }),
        };
        const hits = pointerWithin(scoped);
        const item = hits.find((hit) => !String(hit.id).startsWith("zone:"));
        if (item) return [item];
        if (hits.length) return hits;
        // A disallowed target must not become the nearest valid group instead.
        if (!group && pointerWithin(args).length) return [];
        return closestCenter(scoped);
      }}
      onDragStart={(e) => {
        if (disabled || saving.current) return;
        setError(undefined);
        original.current = layout;
        draft.current = layout;
        setPreview(layout);
        setActive(String(e.active.id));
      }}
      onDragOver={previewMove}
      onDragCancel={cancel}
      onDragEnd={(e) => {
        if (!original.current || !draft.current || !e.over || saving.current) {
          cancel();
          return;
        }
        let next = draft.current;
        if (String(e.active.id).startsWith("group:")) {
          const from = next.sections.indexOf(String(e.active.id).slice(6)),
            to = next.sections.indexOf(String(e.over.id).slice(6));
          if (from >= 0 && to >= 0 && from !== to) {
            const sections = [...next.sections];
            sections.splice(to, 0, sections.splice(from, 1)[0]!);
            next = { ...next, sections };
          }
        }
        if (!String(e.active.id).startsWith("group:")) {
          const target = e.over.data.current;
          if (
            target?.key &&
            target.section &&
            manualSections.includes(target.section)
          ) {
            const items = next.items[target.section] ?? [];
            const from = items.indexOf(String(e.active.id)),
              to = items.indexOf(target.key);
            if (from >= 0 && to >= 0 && from !== to) {
              next = {
                ...next,
                items: moveSidebarPreview(
                  next.items,
                  String(e.active.id),
                  target.section,
                  target.key,
                  from < to,
                ),
              };
            }
          }
        }
        if (next === original.current) {
          cancel();
          return;
        }
        void save(next);
      }}
    >
      <SortableContext
        items={shown.sections.map((id) => `group:${id}`)}
        strategy={verticalListSortingStrategy}
      >
        {children(shown)}
      </SortableContext>
      {error && (
        <p role="status" className="side-hint">
          {error}
        </p>
      )}
      <DragOverlay dropAnimation={null}>
        {active && !active.startsWith("group:") ? (
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
      ref={drag.setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      className={`rah-sidebar-sortable${drag.isDragging ? " is-dragging" : ""}${drag.isOver ? " is-over" : ""}`}
      style={{
        transform: CSS.Transform.toString(drag.transform),
        transition: drag.transition,
        opacity: drag.isDragging ? 0.12 : 1,
        zIndex: drag.isDragging ? 10 : undefined,
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
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const sortable = useSortable({ id: `group:${id}`, disabled });
  return (
    <GroupHandle.Provider value={sortable}>
      <div
        ref={sortable.setNodeRef}
        data-sidebar-group={id}
        style={{
          transform: CSS.Transform.toString(
            sortable.transform ? { ...sortable.transform, x: 0 } : null,
          ),
          transition: sortable.transition,
          opacity: sortable.isDragging ? 0.6 : 1,
          zIndex: sortable.isDragging ? 10 : undefined,
        }}
      >
        {children}
      </div>
    </GroupHandle.Provider>
  );
}
