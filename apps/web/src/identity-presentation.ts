import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

export function workspaceInitial(name: string): string {
  return [...name.trim()][0]?.toLocaleUpperCase() ?? "?";
}

export function insertMention(
  body: string,
  handle: string,
  start: number,
  end: number,
) {
  const before = body.slice(0, start);
  const after = body.slice(end).replace(/^ /, "");
  const prefix = before && !/\s$/.test(before) ? `${before} ` : before;
  const inserted = `${prefix}@${handle.replace(/^@/, "")} `;
  return { text: inserted + after, caret: inserted.length };
}

// Presentation only; never infer a Room reply or Task transition from diagnostics.
// Tool labels follow Raft Computer 1.0.18 TOOL_DISPLAY_METADATA.
export function activityPresentation(entry: RuntimeTrajectoryRecord["entry"]) {
  if (entry.kind === "thinking" || entry.kind === "text") {
    return {
      label: entry.kind === "text" ? "输出" : "思考中",
      detail: entry.text,
      block: true,
    };
  }
  if (entry.kind === "tool_start") {
    const labels: Record<string, string> = {
      bash: "Running command",
      shell: "Running command",
      exec_command: "Running command",
      运行命令: "Running command",
      read: "Reading file",
      Read: "Reading file",
      读取文件: "Reading file",
      write: "Writing file",
      Write: "Writing file",
      edit: "Editing file",
      Edit: "Editing file",
      修改文件: "Editing file",
      grep: "Searching files",
      glob: "Finding files",
      网页搜索: "Searching web",
    };
    let detail = entry.toolInput ?? "";
    try {
      const input: unknown = JSON.parse(detail);
      if (input && typeof input === "object" && !Array.isArray(input)) {
        const record = input as Record<string, unknown>;
        const summary =
          record.command ??
          record.cmd ??
          record.filePath ??
          record.file_path ??
          record.path ??
          record.query ??
          record.pattern;
        if (typeof summary === "string") detail = summary;
      }
    } catch {
      /* Unknown inputs remain visible diagnostics. */
    }
    return {
      label: labels[entry.toolName] ?? entry.toolName,
      detail,
      block: false,
    };
  }
  if (entry.kind === "system" || entry.kind === "slock_action")
    return { label: entry.title, detail: entry.text, block: true };
  if (entry.kind === "status") {
    const labels: Record<string, string> = {
      error: "运行错误",
      offline: "离线",
      online: "空闲",
      thinking: "思考中",
      working: "工作中",
    };
    return {
      label: labels[entry.activity] ?? entry.activity,
      detail: entry.detail ?? "",
      block: false,
    };
  }
  return {
    label:
      entry.kind === "compaction_started" ? "压缩上下文" : "上下文压缩完成",
    detail: "",
    block: false,
  };
}
