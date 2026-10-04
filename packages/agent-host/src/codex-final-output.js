/** Native evidence only. The Host separately validates and submits the command. */
export function createCodexFinalOutput({ threadId, turnId }) {
  let finalItem;
  let invalid = ![threadId, turnId].every(
    (id) => typeof id === "string" && id.trim() !== "",
  );
  let closed = false;
  let completed = false;
  return {
    observe(frame) {
      if (closed) return;
      const p = frame?.params;
      if (!p || p.threadId !== threadId || (p.turnId ?? p.turn?.id) !== turnId)
        return;
      if (frame.method === "error") invalid = true;
      if (frame.method === "turn/completed") {
        closed = true;
        completed =
          p.turn?.id === turnId &&
          p.turn?.status === "completed" &&
          p.turn?.error == null;
        return;
      }
      const item = p.item;
      if (
        frame.method !== "item/completed" ||
        item?.type !== "agentMessage" ||
        item.phase !== "final_answer"
      )
        return;
      if (
        typeof item.id !== "string" ||
        item.id.trim() === "" ||
        typeof item.text !== "string" ||
        item.text.length === 0 ||
        Buffer.byteLength(item.text, "utf8") > 65536
      ) {
        invalid = true;
        return;
      }
      if (
        finalItem &&
        (finalItem.nativeMessageId !== item.id || finalItem.text !== item.text)
      )
        invalid = true;
      else finalItem = { text: item.text, nativeMessageId: item.id };
    },
    candidate() {
      return closed && completed && !invalid ? finalItem : undefined;
    },
  };
}
