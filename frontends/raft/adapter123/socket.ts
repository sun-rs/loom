// Loom has no Raft Socket.IO server. Read-only intake uses native offline fallbacks.
// This port deliberately emits no fabricated business event or delivery acknowledgement.
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
const socket = {
  connected: false,
  auth: {},
  io: { on() {}, off() {} },
  on(name: string, fn: (...args: unknown[]) => void) {
    let set = listeners.get(name);
    if (!set) listeners.set(name, (set = new Set()));
    set.add(fn);
    return socket;
  },
  off(name: string, fn: (...args: unknown[]) => void) {
    listeners.get(name)?.delete(fn);
    return socket;
  },
  onAny() {
    return socket;
  },
  offAny() {
    return socket;
  },
  emit() {
    return socket;
  },
  connect() {
    return socket;
  },
  disconnect() {
    return socket;
  },
  removeAllListeners() {
    listeners.clear();
    return socket;
  },
};
export const getSocket = () => socket;
export const connectSocket = () => socket;
export const disconnectSocket = () => socket;
export const resetSocket = () => socket.removeAllListeners();
export const reconnectSocket = () => socket;
export const ensureSocketConnected = () => socket;
export const isSocketConnected = () => false;
export function updateSocketAuthFromStorage() {}
