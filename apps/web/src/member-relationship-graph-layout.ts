import type {
  MemberGraphAgent,
  MemberGraphEdge,
  MemberGraphHuman,
} from "@rah-os/protocol";

type Member = MemberGraphHuman | MemberGraphAgent;
export type MemberGraphPoint = { x: number; y: number };
type Region = {
  center: MemberGraphPoint;
  keys: string[];
  radiusX: number;
  radiusY: number;
};

export const MEMBER_GRAPH_WIDTH = 920;
export const MEMBER_GRAPH_HEIGHT = 560;
export const MEMBER_GRAPH_PADDING = 58;
const CENTER = {
  x: MEMBER_GRAPH_WIDTH / 2,
  y: MEMBER_GRAPH_HEIGHT / 2,
};

export function computeMemberGraphLayout(
  members: readonly Member[],
  edges: readonly MemberGraphEdge[],
  dense: boolean,
): {
  degrees: Map<string, number>;
  positions: Map<string, MemberGraphPoint>;
} {
  const positions = new Map<string, MemberGraphPoint>();
  const degrees = new Map<string, number>();
  const memberKeys = members.map(memberKey);
  const neighbors = new Map<string, Set<string>>();
  members.forEach((member, index) => {
    const key = memberKey(member);
    positions.set(key, outerPoint(key, index, members.length));
    neighbors.set(key, new Set());
  });
  for (const edge of edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }
  for (const key of memberKeys) degrees.set(key, neighbors.get(key)?.size ?? 0);
  if (memberKeys.length <= 1) return { degrees, positions };
  const regions = componentRegions(
    connectedComponents(memberKeys, neighbors),
    dense,
  );
  const regionByKey = new Map<string, Region>();
  for (const region of regions) {
    region.keys.forEach((key, index) => {
      regionByKey.set(key, region);
      positions.set(key, regionPoint(key, index, region.keys.length, region));
    });
  }
  const area = MEMBER_GRAPH_WIDTH * MEMBER_GRAPH_HEIGHT;
  const repulsion = Math.min(
    8200,
    Math.max(2800, area / Math.max(memberKeys.length, 1) / 1.9),
  );
  const iterations = dense ? 150 : 128;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations;
    const delta = new Map(memberKeys.map((key) => [key, { x: 0, y: 0 }]));
    for (let left = 0; left < memberKeys.length; left += 1) {
      const leftKey = memberKeys[left]!;
      const leftPoint = positions.get(leftKey)!;
      for (let right = left + 1; right < memberKeys.length; right += 1) {
        const rightKey = memberKeys[right]!;
        if (
          regions.length > 1 &&
          regionByKey.get(leftKey) !== regionByKey.get(rightKey)
        )
          continue;
        const rightPoint = positions.get(rightKey)!;
        const x = leftPoint.x - rightPoint.x;
        const y = leftPoint.y - rightPoint.y;
        const squared = Math.max(100, x * x + y * y);
        const force = (repulsion / squared) * cooling;
        const distance = Math.sqrt(squared);
        const forceX = (x / distance) * force;
        const forceY = (y / distance) * force;
        delta.get(leftKey)!.x += forceX;
        delta.get(leftKey)!.y += forceY;
        delta.get(rightKey)!.x -= forceX;
        delta.get(rightKey)!.y -= forceY;
      }
    }
    for (const edge of edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) continue;
      const x = target.x - source.x;
      const y = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(x * x + y * y));
      const force =
        (distance - (dense ? 112 : 210)) *
        (0.018 + Math.min(edge.weight, 4) * 0.004) *
        cooling;
      const forceX = (x / distance) * force;
      const forceY = (y / distance) * force;
      delta.get(edge.source)!.x += forceX;
      delta.get(edge.source)!.y += forceY;
      delta.get(edge.target)!.x -= forceX;
      delta.get(edge.target)!.y -= forceY;
    }
    for (const key of memberKeys) {
      const point = positions.get(key)!;
      const movement = delta.get(key)!;
      const degree = degrees.get(key) ?? 0;
      const center = regionByKey.get(key)?.center ?? CENTER;
      const pull = degree === 0 ? 0.04 : 0.014;
      movement.x += (center.x - point.x) * pull * cooling;
      movement.y += (center.y - point.y) * pull * cooling;
      point.x = clamp(
        point.x + movement.x,
        MEMBER_GRAPH_PADDING,
        MEMBER_GRAPH_WIDTH - MEMBER_GRAPH_PADDING,
      );
      point.y = clamp(
        point.y + movement.y,
        MEMBER_GRAPH_PADDING,
        MEMBER_GRAPH_HEIGHT - MEMBER_GRAPH_PADDING,
      );
    }
  }
  return { degrees, positions };
}

function connectedComponents(
  keys: readonly string[],
  neighbors: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    const stack = [key];
    const component: string[] = [];
    seen.add(key);
    while (stack.length > 0) {
      const next = stack.pop()!;
      component.push(next);
      for (const neighbor of neighbors.get(next) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component.sort());
  }
  return components.sort(
    (left, right) =>
      right.length - left.length || left[0]!.localeCompare(right[0]!),
  );
}

function componentRegions(
  components: readonly string[][],
  dense: boolean,
): Region[] {
  if (components.length <= 1) {
    return [
      {
        center: CENTER,
        keys: components[0] ?? [],
        radiusX: 326,
        radiusY: 198,
      },
    ];
  }
  const largest = components[0]?.length ?? 0;
  const second = components[1]?.length ?? 0;
  const useGrid = largest <= 1 || second >= Math.max(4, largest * 0.45);
  const width = MEMBER_GRAPH_WIDTH - MEMBER_GRAPH_PADDING * 2;
  const height = MEMBER_GRAPH_HEIGHT - MEMBER_GRAPH_PADDING * 2;
  if (useGrid) {
    const columns = Math.ceil(Math.sqrt(components.length * 1.45));
    const rows = Math.ceil(components.length / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    return components.map((keys, index) => {
      const scale = clamp(Math.sqrt(keys.length) / 3, 0.42, 1);
      return {
        center: {
          x: MEMBER_GRAPH_PADDING + cellWidth * ((index % columns) + 0.5),
          y:
            MEMBER_GRAPH_PADDING +
            cellHeight * (Math.floor(index / columns) + 0.5),
        },
        keys,
        radiusX: Math.max(28, Math.min(cellWidth * 0.34 * scale, 150)),
        radiusY: Math.max(24, Math.min(cellHeight * 0.34 * scale, 104)),
      };
    });
  }
  const secondary = components.slice(1);
  const columns = secondary.length > 7 ? 2 : 1;
  const rows = Math.ceil(secondary.length / columns);
  const sideWidth = dense ? 296 : 260;
  const primaryWidth =
    MEMBER_GRAPH_WIDTH - sideWidth - MEMBER_GRAPH_PADDING * 2;
  const cellWidth = sideWidth / columns;
  const cellHeight = height / Math.max(rows, 1);
  const result: Region[] = [
    {
      center: {
        x: MEMBER_GRAPH_PADDING + primaryWidth * 0.5,
        y: CENTER.y,
      },
      keys: components[0]!,
      radiusX: Math.min(primaryWidth * 0.38, dense ? 250 : 282),
      radiusY: dense ? 190 : 206,
    },
  ];
  secondary.forEach((keys, index) => {
    const scale = clamp(Math.sqrt(keys.length) / 2.2, 0.44, 1);
    result.push({
      center: {
        x:
          MEMBER_GRAPH_WIDTH -
          MEMBER_GRAPH_PADDING -
          sideWidth +
          cellWidth * ((index % columns) + 0.5),
        y:
          MEMBER_GRAPH_PADDING +
          cellHeight * (Math.floor(index / columns) + 0.5),
      },
      keys,
      radiusX: Math.max(18, Math.min(cellWidth * 0.28 * scale, 56)),
      radiusY: Math.max(14, Math.min(cellHeight * 0.24 * scale, 40)),
    });
  });
  return result;
}

function outerPoint(
  key: string,
  index: number,
  total: number,
): MemberGraphPoint {
  const angle =
    (index / Math.max(total, 1)) * Math.PI * 2 +
    stableAngle(key) * 0.08 -
    Math.PI / 2;
  return {
    x: CENTER.x + Math.cos(angle) * 326,
    y: CENTER.y + Math.sin(angle) * 198,
  };
}

function regionPoint(
  key: string,
  index: number,
  total: number,
  region: Region,
): MemberGraphPoint {
  if (total <= 1) return { ...region.center };
  const angle =
    (index / total) * Math.PI * 2 + stableAngle(key) * 0.1 - Math.PI / 2;
  const scale = total <= 3 ? 0.46 : 0.78;
  return {
    x: region.center.x + Math.cos(angle) * region.radiusX * scale,
    y: region.center.y + Math.sin(angle) * region.radiusY * scale,
  };
}

function stableAngle(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash / 4294967295) * Math.PI * 2;
}

function memberKey(member: Member): string {
  return `${member.type}:${member.id}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
