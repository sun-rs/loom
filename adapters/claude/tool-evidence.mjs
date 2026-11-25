// Orca b7fd7caa3: src/shared/agent-hook-listener/providers/claude/transcripts/claude-tool-content.ts (lines 6–43, TypeScript erased).
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasText(value) {
  return typeof value === 'string' && value.length > 0
}

export function isClaudeToolUseContent(value) {
  return (
    isRecord(value) &&
    (value.type === 'tool_use' || (hasText(value.id) && hasText(value.name) && 'input' in value))
  )
}

export function isClaudeToolResultContent(value) {
  return isRecord(value) && (value.type === 'tool_result' || hasText(value.tool_use_id))
}

function claudeToolResultFailed(value) {
  const content = value.content
  return (
    value.is_error === true ||
    (isRecord(content) && typeof content.type === 'string' && content.type.endsWith('_error'))
  )
}

function* claudeToolResultTextParts(content) {
  const parts = Array.isArray(content) ? content : [content]
  for (const part of parts) {
    if (typeof part === 'string') {
      yield part
    } else if (part !== undefined && part !== null) {
      const text = isRecord(part) ? (part.text ?? part.content) : undefined
      yield typeof text === 'string' ? text : JSON.stringify(part)
    }
  }
}

export function toolExitCode(block, metadata) {
  const code = block.exitCode ?? block.exit_code ?? block.content?.exitCode ?? block.content?.exit_code ??
    metadata?.exitCode ?? metadata?.exit_code;
  if (Number.isSafeInteger(code)) return code;
  if (!claudeToolResultFailed(block)) return null;

  for (const text of claudeToolResultTextParts(block.content)) {
    const match = /^\s*(?:error:\s*)?exit code(?:\s*:\s*|\s+)(-?\d+)\b/i.exec(text);
    if (match && Number.isSafeInteger(Number(match[1]))) return Number(match[1]);
  }
  return null;
}
