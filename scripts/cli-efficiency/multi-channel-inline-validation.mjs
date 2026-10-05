/** Validates delivery into a session, not model comprehension of that material. */
export function validateInlineChannelRound({
  round,
  previousRounds,
  events,
  expectedAnswer,
  evidenceText,
}) {
  if (round.answer !== expectedAnswer)
    throw new Error("answer differs from exact expected answer");
  if (typeof evidenceText !== "string" || !evidenceText.length)
    throw new Error("material must be nonempty");
  const start = Date.parse(round.startedAt);
  const end = Date.parse(round.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    throw new Error("invalid round time bounds");
  for (const [index, previous] of previousRounds.entries()) {
    if (
      previous === round ||
      previous.speaker !== round.speaker ||
      !round.sessionId ||
      previous.sessionId !== round.sessionId ||
      !Number.isFinite(Date.parse(previous.finishedAt)) ||
      Date.parse(previous.finishedAt) >= start ||
      previous.validation?.answer !== "exact" ||
      previous.validation?.readProof !==
        (index === 0 ? "complete-inline-input" : "previous-turn-only") ||
      previous.validationError
    )
      throw new Error("invalid previous continuation proof");
  }
  const inputs = [];
  for (const event of events) {
    if (event.type !== "response_item") continue;
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time))
      throw new Error("response item missing valid time");
    if (time < start || time > end) continue;
    const payload = event.payload;
    if (!["message", "reasoning"].includes(payload?.type))
      throw new Error("tool or unsupported response item in zero-tool profile");
    if (payload.type === "message" && payload.role === "user") {
      for (const item of payload.content ?? [])
        if (item.type === "input_text" && typeof item.text === "string")
          inputs.push(item.text);
    }
  }
  if (!inputs.length) throw new Error("current user input missing");
  const copies = inputs.reduce(
    (sum, input) => sum + input.split(evidenceText).length - 1,
    0,
  );
  if (previousRounds.length === 0) {
    if (copies !== 1)
      throw new Error(
        "first user input must contain complete material exactly once",
      );
    return { answer: "exact", readProof: "complete-inline-input" };
  }
  if (copies !== 0)
    throw new Error("continued user input repeats complete material");
  return { answer: "exact", readProof: "previous-turn-only" };
}
