export type RahMessageSize = "small" | "medium" | "large";
export type RahTimeFormat = "12" | "24";

const MESSAGE_SIZE_KEY = "rah:settings:message-size";
const LIVE_ACTIVITY_KEY = "rah:settings:live-agent-activity";
const AGENT_MODEL_KEY = "rah:settings:agent-model-name";
const TIME_FORMAT_KEY = "rah:settings:time-format";

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readMessageSize(storage: Storage): RahMessageSize {
  const value = read(storage, MESSAGE_SIZE_KEY);
  return value === "small" || value === "large" ? value : "medium";
}

export function writeMessageSize(storage: Storage, value: RahMessageSize) {
  const saved = write(storage, MESSAGE_SIZE_KEY, value);
  document.documentElement.dataset.rahMessageSize = value;
  return saved;
}

export function readLiveAgentActivity(storage: Storage): boolean {
  return read(storage, LIVE_ACTIVITY_KEY) !== "false";
}

export function writeLiveAgentActivity(storage: Storage, value: boolean) {
  const saved = write(storage, LIVE_ACTIVITY_KEY, String(value));
  document.documentElement.dataset.rahLiveAgentActivity = String(value);
  return saved;
}

// Web/PWA follow Raft's browser default. Native desktop defaults belong to a
// future explicit shell capability, never viewport width or user-agent sniffing.
export function readAgentModelName(storage: Storage): boolean {
  return read(storage, AGENT_MODEL_KEY) === "true";
}

export function writeAgentModelName(storage: Storage, value: boolean) {
  const saved = write(storage, AGENT_MODEL_KEY, String(value));
  document.documentElement.dataset.rahAgentModelName = String(value);
  return saved;
}

export function readTimeFormat(storage: Storage): RahTimeFormat {
  return read(storage, TIME_FORMAT_KEY) === "12" ? "12" : "24";
}

export function writeTimeFormat(storage: Storage, value: RahTimeFormat) {
  const saved = write(storage, TIME_FORMAT_KEY, value);
  document.documentElement.dataset.rahTimeFormat = value;
  return saved;
}

export function applySettingsPreferences(storage: Storage) {
  document.documentElement.dataset.rahAgentModelName = String(
    readAgentModelName(storage),
  );
  document.documentElement.dataset.rahMessageSize = readMessageSize(storage);
  document.documentElement.dataset.rahLiveAgentActivity = String(
    readLiveAgentActivity(storage),
  );
  document.documentElement.dataset.rahTimeFormat = readTimeFormat(storage);
}
