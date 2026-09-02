/** Raft's portable seeded pixel recipe, structurally ported from index-BoAC7nSE
 * o$e/l$e/c$e (1855676–1856375). See room-members-and-avatar contract.
 * Color slots resolve through the existing generated avatar pack in the UI.
 * No rendering, random allocation, or unbounded cache belongs here.
 */
export function randomAgentAvatarPattern(seed: string): {
  colorPair: number;
  rows: string[];
} {
  let state = 0;
  for (let i = 0; i < seed.length; i++) {
    state = ((state << 5) - state + seed.charCodeAt(i)) | 0;
  }
  const next = () => {
    state = (state + 1831565813) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const colorPair = Math.floor(next() * 12);
  const rows = Array.from({ length: 8 }, () => {
    const half = Array.from({ length: 4 }, () => (next() < 0.45 ? "1" : "_"));
    return [...half, ...half.slice().reverse()].join("");
  });
  return { colorPair, rows };
}
