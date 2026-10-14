// Local contract adapter for the official Sidebar.tsx dnd-kit interaction.
// Upstream source/revision and differences are recorded in adoption.json.
import { useRef, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SidebarPreferences, SidebarPatchRequest } from "@rah-os/protocol";
import { sidebarDrop } from "./sidebar-state.ts";
type Group = { id: string; rooms: { roomId: string; name: string }[] };
export function SidebarDrag({
  children,
  groups,
  prefs,
  disabled,
  onDrop,
}: {
  children: ReactNode;
  groups: Group[];
  prefs?: SidebarPreferences;
  disabled: boolean;
  onDrop: (patch: SidebarPatchRequest["patch"], version: number) => void;
}) {
  const snapshot = useRef<{
    groups: Group[];
    prefs: SidebarPreferences;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 500, tolerance: 10 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const sections = String(args.active.id).startsWith("group:");
        const droppableContainers = args.droppableContainers.filter(
          (c) => !sections || String(c.id).startsWith("group:"),
        );
        const hits = pointerWithin({ ...args, droppableContainers });
        return hits.length
          ? [...hits].sort(
              (a, b) =>
                Number(String(a.id).startsWith("group:")) -
                Number(String(b.id).startsWith("group:")),
            )
          : args.pointerCoordinates
            ? []
            : closestCenter({ ...args, droppableContainers });
      }}
      onDragStart={() => {
        snapshot.current = !disabled && prefs ? { groups, prefs } : null;
      }}
      onDragCancel={() => {
        snapshot.current = null;
      }}
      onDragEnd={({ active, over }) => {
        const start = snapshot.current;
        snapshot.current = null;
        if (!start || !over) return;
        const translated = active.rect.current.translated;
        const after =
          !!translated &&
          translated.top + translated.height / 2 >
            over.rect.top + over.rect.height / 2;
        const patch = sidebarDrop(
          start.prefs,
          start.groups,
          String(active.id),
          String(over.id),
          after,
        );
        if (Object.keys(patch).length) onDrop(patch, start.prefs.version);
      }}
    >
      <SortableContext
        items={groups.map((g) => `group:${g.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}
export function DragSection({
  id,
  items,
  disabled,
  children,
}: {
  id: string;
  items: string[];
  disabled: boolean;
  children: ReactNode;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `group:${id}`, disabled });
  return (
    <section
      ref={setNodeRef}
      data-sidebar-section={id}
      className="mb-3"
      style={{
        transform: CSS.Transform.toString(
          transform ? { ...transform, x: 0 } : null,
        ),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      onPointerDownCapture={(e) => {
        if ((e.target as HTMLElement).closest("[data-section-handle]"))
          listeners?.onPointerDown?.(e);
      }}
      onTouchStartCapture={(e) => {
        if ((e.target as HTMLElement).closest("[data-section-handle]"))
          listeners?.onTouchStart?.(e);
      }}
      onKeyDownCapture={(e) => {
        if ((e.target as HTMLElement).closest("[data-section-handle]"))
          listeners?.onKeyDown?.(e);
      }}
      {...attributes}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </section>
  );
}
export function DragRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      data-channel-row={id}
      className="relative flex min-w-0 cursor-grab items-center active:cursor-grabbing"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.12 : 1,
      }}
      {...attributes}
      onPointerDownCapture={(e) => listeners?.onPointerDown?.(e)}
      onTouchStartCapture={(e) => listeners?.onTouchStart?.(e)}
      onKeyDownCapture={(e) => listeners?.onKeyDown?.(e)}
    >
      {children}
    </div>
  );
}
