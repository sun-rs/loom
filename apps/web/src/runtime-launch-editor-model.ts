/** Argument text, not a shell script: no expansion, substitution or execution. */
export function formatLaunchArgs(args: readonly string[]): string {
  const lines: string[] = [];
  for (const arg of args) {
    const token = /^[\w./:=+-]+$/u.test(arg) ? arg : JSON.stringify(arg);
    if (!arg.startsWith("-") && lines.length && lines.at(-1)!.startsWith("-"))
      lines[lines.length - 1] += ` ${token}`;
    else lines.push(token);
  }
  return lines.join("\n");
}
export function parseLaunchArgs(text: string): string[] {
  const args: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    if (/\s/u.test(text[offset]!)) {
      offset++;
      continue;
    }
    if (text[offset] === '"') {
      const start = offset++;
      let closed = false;
      while (offset < text.length) {
        if (text[offset] === "\\") {
          offset += 2;
          continue;
        }
        if (text[offset++] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error("双引号未闭合");
      args.push(JSON.parse(text.slice(start, offset)) as string);
      if (offset < text.length && !/\s/u.test(text[offset]!))
        throw new Error("参数之间需要空格或换行");
    } else {
      const start = offset;
      while (offset < text.length && !/\s/u.test(text[offset]!)) offset++;
      const token = text.slice(start, offset);
      if (token.includes('"') || token.includes("'"))
        throw new Error("含空格或引号的参数请使用双引号包住整个参数");
      args.push(token);
    }
    if (args.length > 64) throw new Error("最多 64 个参数");
  }
  return args;
}
export function launchDiff(before: string, after: string) {
  const a = before ? before.split("\n") : [],
    b = after ? after.split("\n") : [];
  const lengths = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i]![j] =
        a[i] === b[j]
          ? 1 + lengths[i + 1]![j + 1]!
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const rows: { kind: "same" | "added" | "removed"; text: string }[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j])
      (rows.push({ kind: "same", text: a[i++]! }), j++);
    else if (
      i < a.length &&
      (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)
    )
      rows.push({ kind: "removed", text: a[i++]! });
    else rows.push({ kind: "added", text: b[j++]! });
  }
  return rows;
}

/** Required argv comes from the daemon's runtime owner, not a UI capability list. */
export function validateRequiredLaunchArgs(
  args: readonly string[],
  required: readonly string[],
): void {
  const remaining = [...args];
  for (let i = 0; i < required.length; i++) {
    const key = required[i]!;
    const value =
      required[i + 1] && !required[i + 1]!.startsWith("-")
        ? required[++i]
        : undefined;
    if (!key.startsWith("-") && args[0] !== key)
      throw new Error(
        `这里只填写参数；请保留开头的 ${key}，不要包含 CLI 命令名。`,
      );
    const at = remaining.indexOf(key);
    if (at < 0 || (value !== undefined && remaining[at + 1] !== value))
      throw new Error(
        `启动通信必需参数不可删除或改值：${key}${value === undefined ? "" : ` ${value}`}。请恢复此项后保存。`,
      );
    remaining.splice(at, value === undefined ? 1 : 2);
  }
}

/** Project legacy full overrides into the new additions-only editor. */
export function launchAdditions(
  defaults: readonly string[],
  effective: readonly string[],
): string[] {
  const remaining = [...effective];
  for (let i = 0; i < defaults.length; i++) {
    const key = defaults[i]!;
    const value =
      defaults[i + 1] && !defaults[i + 1]!.startsWith("-")
        ? defaults[++i]
        : undefined;
    const at = remaining.indexOf(key);
    if (at >= 0 && (value === undefined || remaining[at + 1] === value))
      remaining.splice(at, value === undefined ? 1 : 2);
  }
  return remaining;
}
