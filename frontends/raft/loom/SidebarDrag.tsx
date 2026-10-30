// Full Web1.21.40 owns rows, zones, geometry and collision/projection.
// Loom binds stable IDs and the existing durable sidebar write owner.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  MouseOnlyPointerSensor,
  useHoldThenMoveTouchSensor,
} from "raft-ui/wip";
import type { SidebarPreferences, SidebarPatchRequest } from "@rah-os/protocol";
import {
  groupSortMode,
  isStandaloneChat,
  sidebarDrop,
  type SidebarRoom,
} from "./sidebar-state";
import {
  NativeSidebarDragItem,
  NativeSidebarDropList,
  NativeSidebarDragSection,
  NativeSidebarSectionToggle,
  NativeSidebarDragMeasure,
  NativeSidebarDragLabel,
  nativeSidebarAlgorithms,
  nativeSidebarMeasuring,
  findSidebarDragContainer,
  sidebarDropIndex,
  type SidebarProjection,
} from "./OfficialSidebarDrag140.generated.js";
export { NativeSidebarSectionToggle as SectionToggle };
type Group<T extends SidebarRoom> = { id: string; name: string; rooms: T[] };
const containerId = (id: string) => "sidebar:container:" + id;
export function SidebarDrag<T extends SidebarRoom>({
  children,
  groups,
  visibleIds,
  prefs,
  disabled,
  onDrop,
}: {
  children: (
    groups: Group<T>[],
    drag: { active: boolean; origin: string | null },
  ) => ReactNode;
  groups: Group<T>[];
  visibleIds: string[];
  prefs?: SidebarPreferences;
  disabled: boolean;
  onDrop: (
    patch: SidebarPatchRequest["patch"],
    version: number,
    settled: (result: "ok" | "rejected" | "unknown") => void,
  ) => void;
}) {
  const snapshot = useRef<{
    groups: Group<T>[];
    prefs: SidebarPreferences;
  } | null>(null);
  const startRef = useRef<SidebarProjection | null>(null),
    projectionRef = useRef<SidebarProjection | null>(null);
  const [projection, setProjection] = useState<SidebarProjection | null>(null),
    [activeId, setActiveId] = useState<string | null>(null);
  const [sectionOrder, setSectionOrder] = useState<string[] | null>(null);
  const pendingVisual = useRef<{ version: number } | null>(null);
  useEffect(() => {
    if (
      pendingVisual.current &&
      prefs?.version !== pendingVisual.current.version
    ) {
      pendingVisual.current = null;
      setProjection(null);
      setSectionOrder(null);
    }
  }, [prefs?.version]);
  const base = useMemo(
    () =>
      Object.fromEntries(
        groups.map((g) => [containerId(g.id), g.rooms.map((r) => r.roomId)]),
      ),
    [groups],
  );
  const items = useMemo(
    () => new Map(groups.flatMap((g) => g.rooms).map((r) => [r.roomId, r])),
    [groups],
  );
  const sectionIds = useMemo(
    () => groups.map((g) => "group:" + g.id),
    [groups],
  );
  const sensors = useSensors(
    useSensor(MouseOnlyPointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useHoldThenMoveTouchSensor(),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const canDrop = useCallback(
    (id: string, container: string) => {
      const g = groups.find((g) => containerId(g.id) === container),
        r = items.get(id);
      if (
        disabled ||
        !prefs ||
        !g ||
        !r ||
        groupSortMode(prefs, g.id) !== "manual"
      )
        return false;
      return (
        g.id === "pinned" ||
        g.id.startsWith("custom:") ||
        (g.id === "dms"
          ? isStandaloneChat(r, prefs)
          : !isStandaloneChat(r, prefs))
      );
    },
    [disabled, prefs, groups, items],
  );
  const algorithms = useMemo(
    () =>
      nativeSidebarAlgorithms({
        canDrop,
        sectionIds,
        projectionRef,
        startRef,
        base,
      }),
    [canDrop, sectionIds, base],
  );
  const reset = () => {
    startRef.current = null;
    projectionRef.current = null;
    setProjection(null);
    setActiveId(null);
    setSectionOrder(null);
  };
  const end = (event: DragEndEvent) => {
    const initial = snapshot.current;
    snapshot.current = null;
    const from = startRef.current,
      current = projectionRef.current;
    const final =
      event.over && current
        ? algorithms.project(
            event.active,
            event.over,
            current,
            sidebarDropIndex(event.collisions, event.over.id),
          )
        : current;
    reset();
    if (!initial || !event.over || disabled) return;
    const id = String(event.active.id);
    let patch: SidebarPatchRequest["patch"] = {};
    if (id.startsWith("group:"))
      patch = sidebarDrop(
        initial.prefs,
        initial.groups.filter((g) => visibleIds.includes(g.id)),
        id,
        String(event.over.id),
        false,
      );
    else if (from && final) {
      const target = findSidebarDragContainer(final, id);
      if (
        !target ||
        !canDrop(id, target) ||
        JSON.stringify(from) === JSON.stringify(final)
      )
        return;
      const destination = final[target]!,
        index = destination.indexOf(id);
      patch = sidebarDrop(
        initial.prefs,
        initial.groups,
        id,
        destination[index + 1] ??
          "group:" + target.slice("sidebar:container:".length),
        false,
      );
    }
    if (Object.keys(patch).length) {
      // Native optimistic presentation only: one existing WriteIntent still owns
      // the mutation. Keep the dropped location until authoritative reconciliation.
      const pending = { version: initial.prefs.version };
      pendingVisual.current = pending;
      setProjection(final);
      setSectionOrder(patch.sectionOrder ?? null);
      onDrop(patch, initial.prefs.version, (result) => {
        if (result === "rejected" && pendingVisual.current === pending) {
          pendingVisual.current = null;
          setProjection(null);
          setSectionOrder(null);
        }
      });
    }
  };
  const displayed = projection
    ? groups.map((g) => ({
        ...g,
        rooms: (projection[containerId(g.id)] ?? [])
          .map((id) => items.get(id)!)
          .filter(Boolean),
      }))
    : groups;
  const ordered = sectionOrder
    ? [...displayed].sort(
        (a, b) => sectionOrder.indexOf(a.id) - sectionOrder.indexOf(b.id),
      )
    : displayed;
  return (
    <DndContext
      measuring={nativeSidebarMeasuring}
      sensors={disabled ? [] : sensors}
      collisionDetection={algorithms.collision}
      onDragStart={({ active }) => {
        snapshot.current = !disabled && prefs ? { groups, prefs } : null;
        const data = active.data.current;
        if (!disabled && data?.type === "item") {
          startRef.current = base;
          projectionRef.current = base;
          setProjection(base);
          setActiveId(String(active.id));
        } else reset();
      }}
      onDragOver={({ active, over, collisions }) => {
        if (!over || !startRef.current) return;
        const current = projectionRef.current ?? base;
        const next = algorithms.project(
          active,
          over,
          current,
          sidebarDropIndex(collisions, over.id),
        );
        if (next !== current) {
          projectionRef.current = next;
          setProjection(next);
        }
      }}
      onDragCancel={() => {
        snapshot.current = null;
        reset();
      }}
      onDragEnd={end}
    >
      <NativeSidebarDragMeasure projection={activeId ? projection : null} />
      <SortableContext
        items={sectionIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col" data-testid="sidebar-section-list">
          {children(ordered, {
            active: !!activeId,
            origin:
              activeId && startRef.current
                ? (findSidebarDragContainer(startRef.current, activeId)?.slice(
                    "sidebar:container:".length,
                  ) ?? null)
                : null,
          })}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeId && items.has(activeId) ? (
          <NativeSidebarDragLabel
            activeId={activeId}
            labels={
              new Map([...items].map(([id, r]) => [id, { label: r.name }]))
            }
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
export function DragSection({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <NativeSidebarDragSection
      id={"group:" + id}
      testId={"sidebar-section-block-" + id}
    >
      {children}
    </NativeSidebarDragSection>
  );
}
export function DragList({
  id,
  manual,
  items,
  children,
}: {
  id: string;
  manual: boolean;
  items: string[];
  children: ReactNode;
}) {
  return (
    <NativeSidebarDropList
      id={containerId(id)}
      kind={id.startsWith("custom:") ? "custom" : id}
      manual={manual}
      itemIds={items}
      empty={!items.length}
    >
      {children}
    </NativeSidebarDropList>
  );
}
export function DragRow({
  id,
  groupId,
  children,
}: {
  id: string;
  groupId: string;
  children: ReactNode;
}) {
  return (
    <NativeSidebarDragItem id={id} containerId={containerId(groupId)}>
      {children}
    </NativeSidebarDragItem>
  );
}
