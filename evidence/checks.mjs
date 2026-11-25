import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const shellWords = /#[^\r\n]*|&&|\|\||[;|&\n]|(?:'[^']*'|"(?:\\.|[^"\\])*"|[^\s'";|&])+/g;
const operators = new Set(['&&', '||', ';', '|', '&', '\n']);
const assignment = /^[A-Za-z_]\w*=/;
const clean = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const unquote = word => word?.replace(/^(['"])([\s\S]*)\1$/, '$2');

export function clip(text, limit) {
  if (limit < Buffer.byteLength('…')) return '';
  if (Buffer.byteLength(text) <= limit) return text;
  let result = '';
  let remaining = limit - Buffer.byteLength('…');
  for (const character of text) {
    remaining -= Buffer.byteLength(character);
    if (remaining < 0) break;
    result += character;
  }
  return result.trimEnd() + '…';
}

function runner(words) {
  const [exe, ...args] = words;
  const name = basename(exe ?? '');
  if (name === 'node' && args.includes('--test') &&
    !args.slice(0, args.indexOf('--test')).some(arg => ['--', '-e', '--eval', '-p', '--print'].includes(arg))) return name;
  if (name === 'pytest' || (/^python(?:[23](?:\.\d+)?)?$/.test(name) && args[0] === '-m' && ['pytest', 'unittest'].includes(args[1]))) return 'pytest';
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name) &&
    (/^(?:test(?::[^ ]+)?|t)$/.test(args[0]) || args[0] === 'run' && /^test(?::[^ ]+)?$/.test(args[1]))) return name;
  if (['go', 'cargo', 'deno', 'swift', 'gradle', 'gradlew', 'mvn'].includes(name) && args[0] === 'test') return name;
  if (['jest', 'vitest', 'mocha', 'ctest', 'rspec'].includes(name)) return name;
  if (['npx', 'uv'].includes(name) || (['pnpm', 'npm'].includes(name) && args[0] === 'exec')) {
    const first = args.findIndex(arg => !arg.startsWith('-') && !['exec', 'run', '--'].includes(arg));
    if (first >= 0 && ['jest', 'vitest', 'mocha', 'pytest'].includes(basename(args[first]))) return basename(args[first]);
  }
}

function normalizedWords(words) {
  const normalized = words.map(unquote);
  let offset = 0;
  while (assignment.test(normalized[offset]) || ['env', 'command', 'time'].includes(normalized[offset])) offset++;
  return normalized.slice(offset);
}

export function shellBody(command) {
  // Native command arrays are printed as "/bin/zsh -lc <command>" without quoting.
  const match = /^(?:[^\s]*\/)?(?:ba|da|z|k)?sh\s+-[a-z]*c[a-z]*\s+([\s\S]+)$/i.exec(command.trim());
  return match ? unquote(match[1]) : command;
}

function inspectCommand(command) {
  const tokens = shellBody(command).match(shellWords) ?? [];
  const groups = [[]];
  const separators = [];
  for (const word of tokens) {
    if (operators.has(word)) {
      separators.push(word);
      groups.push([]);
    } else if (!word.startsWith('#')) groups.at(-1).push(word);
  }
  while (groups.at(-1)?.length === 0 && separators.at(-1) === '\n') {
    groups.pop();
    separators.pop();
  }
  const stages = groups.map(normalizedWords);
  const first = stages.findIndex(words => runner(words));
  if (first < 0 || /<<[-]?\s*\S/.test(command)) return null;
  // A compound shell exit is attribution only when there is no other possible exit source.
  const direct = stages.length === 1;
  const checksAfterCd = first === stages.length - 1 && separators.every(operator => operator === '&&') &&
    stages.slice(0, first).every(words => words[0] === 'cd');
  return { runner: runner(stages[first]), direct, checksAfterCd, selective: stages[first].includes('--test-only') };
}

function summary(output) {
  const counts = { passed: null, failed: null, skipped: null };
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    const tap = /^(?:#|ℹ)\s*(pass|fail|skipped)\s+(\d+)\s*$/.exec(line);
    if (tap) {
      const field = { pass: 'passed', fail: 'failed', skipped: 'skipped' }[tap[1]];
      counts[field] = Number(tap[2]);
      continue;
    }
    if (/^(?:Tests:\s*|=+\s*)?\d+\s+(?:passed|failed|skipped|xfailed|deselected)\b/.test(line) ||
      /^test result: (?:ok|FAILED)\./.test(line)) {
      for (const [, number, kind] of line.matchAll(/\b(\d+)\s+(passed|failed|skipped|ignored|deselected)\b/g)) {
        if (['ignored', 'deselected'].includes(kind)) counts.skipped = (counts.skipped ?? 0) + Number(number);
        else counts[kind] = Number(number);
      }
    }
  }
  return counts;
}

// Only callers with a provider result envelope pass a command to this function.
export function checkEvidence({ command, cwd, exitCode, output, sandboxed, source, started = false }) {
  if (typeof command !== 'string' || !started && !Number.isSafeInteger(exitCode)) return null;
  const check = inspectCommand(command);
  if (!check) return null;
  const normalized = typeof output === 'string' ? output.replace(/\r\n/g, '\n').replace(/\n+$/, '') : null;
  const tail = normalized?.split('\n').slice(-5).join('\n') ?? null;
  const cleanOutput = clean(normalized ?? '').replace(/ \| (?=ℹ\s+)/g, '\n');
  const counts = summary(cleanOutput);
  const reportedTotal = [...cleanOutput.matchAll(/^(?:#|ℹ)\s*tests\s+(\d+)\s*$/gm)].at(-1)?.[1];
  const total = reportedTotal == null ? (counts.passed !== null && counts.failed !== null ?
    counts.passed + counts.failed + (counts.skipped ?? 0) : null) : Number(reportedTotal);
  const code = Number.isSafeInteger(exitCode) ? exitCode : null;
  const result = counts.failed > 0 || check.direct && code !== null && code !== 0 ? 'failed' :
    code === 0 && (check.direct || check.checksAfterCd || counts.passed > 0) ? 'passed' : 'unknown';
  return {
    command: clip(clean(command), 1024), cwd: cwd ?? null, runner: check.runner, exitCode: code,
    sandboxed: sandboxed ?? null, source, result, counts, total, countStatus: counts.passed === null ? 'count unrecognised' : 'recognised', selective: check.selective,
    tailSha256: tail === null ? null : createHash('sha256').update(tail).digest('hex'),
    tail: tail === null ? null : clip(clean(tail), 1024),
  };
}
