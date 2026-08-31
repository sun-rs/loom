// OpenCode SDK EventMessageUpdated.info owns role; Part/PartDelta own messageID.
// See packages/sdk/js/src/v2/gen/types.gen.ts in anomalyco/opencode. This filter
// is Host-private observation state, never Room truth or a retry safety proof.
export function scopedOpenCodeEvent(event, activeSessionId) {
  if (!activeSessionId || !record(event) || !record(event.properties)) return;
  const p = event.properties;
  const ids = [p.sessionID, p.info?.sessionID, p.part?.sessionID].filter(
    (id) => id !== undefined,
  );
  if (!ids.length || ids.some((id) => id !== activeSessionId)) return;
  return { ...event, properties: { ...p, sessionID: activeSessionId } };
}

export class OpenCodeEventIdentityFilter {
  #session;
  #roles = new Map();
  #pending = [];
  #pendingBytes = 0;
  #status;

  accept(input, activeSessionId) {
    const event = scopedOpenCodeEvent(input, activeSessionId);
    if (!event) return [];
    if (this.#session !== activeSessionId) {
      this.#session = activeSessionId;
      this.#roles.clear();
      this.#pending = [];
      this.#pendingBytes = 0;
      this.#status = undefined;
    }
    const p = event.properties;
    if (event.type === "session.status" || event.type === "session.idle") {
      const status =
        event.type === "session.idle" ? '"idle"' : JSON.stringify(p.status);
      if (status === this.#status) return [];
      this.#status = status;
      return [event];
    }
    if (event.type === "message.updated") {
      const info = p.info;
      if (
        !record(info) ||
        typeof info.id !== "string" ||
        !["user", "assistant"].includes(info.role)
      )
        return [];
      this.#roles.set(info.id, info.role);
      if (this.#roles.size > 4096)
        this.#roles.delete(this.#roles.keys().next().value);
      const ready = [];
      this.#pending = this.#pending.filter((item) => {
        if (item.messageId !== info.id) return true;
        this.#pendingBytes -= item.bytes;
        if (info.role === "assistant") ready.push(item.event);
        return false;
      });
      return ready;
    }
    if (
      event.type === "message.part.updated" ||
      event.type === "message.part.delta"
    ) {
      const messageId = p.messageID ?? p.part?.messageID;
      if (typeof messageId !== "string") return [];
      const role = this.#roles.get(messageId);
      if (role === "assistant") return [event];
      if (role === "user") return [];
      // Native events normally carry role first. Bound the rare out-of-order
      // case without guessing an unknown role or retaining an entire transcript.
      const bytes = Buffer.byteLength(JSON.stringify(event));
      if (bytes > 65536) return [];
      while (
        this.#pending.length >= 256 ||
        this.#pendingBytes + bytes > 65536
      ) {
        this.#pendingBytes -= this.#pending.shift().bytes;
      }
      this.#pending.push({ messageId, event, bytes });
      this.#pendingBytes += bytes;
      return [];
    }
    return [event];
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
