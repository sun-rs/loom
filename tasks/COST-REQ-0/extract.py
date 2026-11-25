"""Extract request usage and purpose labels from cwd-scoped, read-only sources."""
from collections import Counter, deque
import csv
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import unquote, urlparse

HOME = Path.home()
OUT = Path(__file__).resolve().parent
REPO = HOME / 'Code/repos'
RUNS = HOME / '.loom-next/runs/loom-next'
RELAY = HOME / 'Code/exp-relay'
ROOTS = (REPO / 'loom-next', REPO / 'loom_new', RELAY, HOME / 'Code/exp-csvstat', RUNS)
NATIVE = {'codex': HOME / '.codex/sessions', 'claude': HOME / '.claude/projects',
          'agy': HOME / '.gemini/antigravity-cli/brain'}
CUTOFF = datetime.fromisoformat('2026-11-25T02:40:00+00:00').timestamp()
RELAY_END = {'20261124151218-59651': '2026-11-24T16:00:00Z',
             '20261124165640-99591': '2026-11-24T18:00:00Z'}
UUID = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', re.I)
PROCESS = {'report_write', 'completion_send', 'protocol_query', 'line_count'}
COORD = {'poll', 'worker_read', 'completion_send', 'coordinate', 'protocol_query', 'verify_snapshot'}
SUBSTANTIVE = {'edit', 'test'}
SOURCE_SUFFIX = r'(?:[cm]?[jt]sx?|py|go|rs|sh|json|toml|ya?ml|md|txt)'


def allowed(path):
    path = Path(path).resolve()
    return any(path.is_relative_to(r) for r in ROOTS) and not any(
        part == 'provider-homes' or part.startswith('.env') for part in path.parts)


def native_path(path, provider):
    path = Path(path)
    if (path.is_symlink() or not path.resolve().is_relative_to(NATIVE[provider]) or
            any(p == 'provider-homes' or p.startswith('.env') for p in path.parts)):
        return False
    if provider == 'agy':
        return path.name == 'transcript_full.jsonl' and bool(UUID.fullmatch(path.parents[2].name))
    if provider == 'claude':
        return bool(UUID.fullmatch(path.stem))
    return path.name.startswith('rollout-') and path.suffix == '.jsonl'


def read_index(path):
    return sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)


def load_json(path):
    return json.loads(path.read_text())


def records(path):
    with path.open() as f:
        for line, raw in enumerate(f, 1):
            try:
                yield line, json.loads(raw)
            except json.JSONDecodeError:
                continue


def project(cwd):
    return next(r.name if r != RUNS else 'loom-next-runs'
                for r in ROOTS if Path(cwd).resolve().is_relative_to(r))


def utc(time):
    return datetime.fromisoformat(time.strip().replace('Z', '+00:00')).timestamp()


def relay_entries():
    for folder in sorted((RELAY / 'runs').glob('2026*')):
        pf = folder / 'sessions.json'
        if not (pf.is_file() and (folder / 'tokens.json').is_file()):
            continue
        for m in load_json(pf)['sessions']:
            if not allowed(m['cwd']):
                continue
            yield dict(m, cohort='relay', run=folder.name)


def scoped_entries():
    # SQL retrieves only path/ID metadata for the allowed workspace prefixes.
    conditions = ' or '.join("cwd=? or substr(cwd,1,?)=?" for _ in ROOTS)
    args = [x for r in ROOTS for x in (str(r), len(str(r)) + 1, str(r) + '/')]
    with read_index(HOME / '.codex/state_5.sqlite') as db:
        for id_, p, cwd, updated in db.execute(
                'select id, rollout_path, cwd, updated_at from threads where (' + conditions +
                ') and updated_at < ? order by id', [*args, int(CUTOFF)]):
            if allowed(cwd) and native_path(p, 'codex'):
                yield dict(provider='codex', path=p, cwd=cwd, session_id=id_, index_at=updated)
    # Claude's directory is the initial gate. Require native cwd metadata too.
    slugs = tuple(re.sub(r'[^A-Za-z0-9-]', '-', str(r)) for r in ROOTS)
    for folder in sorted(NATIVE['claude'].iterdir()):
        if not any(folder.name == s or folder.name.startswith(s + '-') for s in slugs):
            continue
        for path in sorted(folder.glob('*.jsonl')):
            if not native_path(path, 'claude') or path.stat().st_mtime >= CUTOFF:
                continue
            cwd = claude_cwd(path)
            if cwd and allowed(cwd):
                yield dict(provider='claude', path=str(path), cwd=cwd, session_id=path.stem)
    conditions = ' or '.join('instr(workspace_uris, ?) > 0' for _ in ROOTS)
    with read_index(HOME / '.gemini/antigravity-cli/conversation_summaries.db') as db:
        for id_, raw, updated in db.execute(
                'select conversation_id,workspace_uris,last_modified_time from conversation_summaries'
                ' where ' + conditions + ' order by conversation_id',
                [r.as_uri() for r in ROOTS]):
            uris = [urlparse(u) for u in json.loads(raw)]
            cwds = [unquote(u.path) for u in uris if u.scheme == 'file' and not u.netloc]
            if not cwds or len(cwds) != len(uris) or not all(allowed(c) for c in cwds):
                continue
            if utc(updated) >= CUTOFF or not UUID.fullmatch(id_):
                continue
            p = NATIVE['agy'] / id_ / '.system_generated/logs/transcript_full.jsonl'
            yield dict(provider='agy', path=str(p), cwd=cwds[0], session_id=id_)


def claude_cwd(path):
    # Initial native records may be mode/owner/permission markers without cwd.
    pattern = re.compile(r'(?:^\{|,)\s*"cwd"\s*:\s*("(?:[^"\\]|\\.)*")')
    with path.open() as file:
        for line in range(24):
            raw = file.readline()
            if not raw:
                break
            if match := pattern.search(raw):
                return json.loads(match.group(1))
    return None


def get_json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value or {}


def block_text(content):
    if isinstance(content, str):
        return content
    return '\n'.join(c.get('text', '') for c in content or [] if
                     isinstance(c, dict) and c.get('type') in {'text', 'input_text'})


def wake_reason(text):
    head = text.lstrip()[:650]
    if re.search(r'(?im)^\s*(?:\[?(?:loom|relay|hc)[- :][^\n]{0,160}|<loom\b[^>]*>)', head):
        if re.search(r'(?i)\b(?:report|done|result|failed|batch|完成|结果)\b', head):
            return 'worker_wake'
        return 'external_wake'
    if re.search(r'(?i)worker_done|relay batch|wave completion', head):
        return 'worker_wake'
    return 'external_wake'


@dataclass
class Tool:
    name: str
    labels: set = field(default_factory=set)
    keys: set = field(default_factory=set)


def path_label(path):
    if re.search(r'(?i)(?:^|[/\\])(?:RESULT[^/\\]*\.md|REPORT[^/\\]*\.md|\.project/(?:journal[^/]*|evidence/[^/]+)|(?:out|output)/[^/]+)$', path):
        return 'result_read'
    if re.search(r'(?i)(?:^|[/\\])(?:SKILL\.md|AGENTS\.md|WORKERS\.md)$', path):
        return 'protocol_read'
    return 'read'


def command_parts(command):
    # Ignore shell heredocs: their payload is document/code, not executed commands.
    active = []
    stop = None
    for ln in command.splitlines()[:150]:
        if stop:
            if ln.strip() == stop:
                stop = None
            continue
        m = re.search(r"<<-?\s*['\"]?([A-Za-z_]\w*)['\"]?", ln)
        if m:
            stop = m[1]
            ln = ln[:m.start()]
        active.append(ln)
    text = '\n'.join(active).replace('\\\n', ' ')
    quote = None
    escaped = False
    start = 0
    for i, char in enumerate(text):
        if escaped:
            escaped = False
        elif char == '\\' and quote != "'":
            escaped = True
        elif quote:
            if char == quote:
                quote = None
        elif char in ("'", '"', '`'):
            quote = char
        elif char in '\n;&|':
            if char == '&' and i and text[i-1] in '<>':
                continue
            if char == '&' and i + 1 < len(text) and text[i+1] == '>':
                continue
            yield text[start:i]
            start = i + 1
    yield text[start:]


def classify_command(command, tool):
    for cmd in command_parts(command):
        cmd = cmd.strip()
        if not cmd:
            continue
        report = re.search(r'(?i)(?:RESULT|REPORT)[\w.-]*\.md|HANDOVER\.md', cmd)
        if re.search(r'(?i)\b(?:loom(?:_new)?|loom\.mjs)\s+(?:report|result (?:publish|collect))\b', cmd):
            tool.labels.add('completion_send')
        elif re.search(r'\b(?:hc|herdr|loom)\s+(?:send|notify)\b|\borchestration\s+(?:send|worker-done)\b', cmd) and '--help' not in cmd:
            if re.search(r'(?i)worker_done|STATUS[:= ]+done|\b(?:DONE|RESULT\.md|completed|完成|pass(?:ed)?|verdict)\b', cmd):
                tool.labels.add('completion_send')
            else:
                tool.labels.add('coordinate')
        elif re.search(r'\b(?:sleep|wait_agent|wait_for|write_stdin)\b|\b(?:hc|herdr)\s+(?:wait|list|ps|status)\b|\b(?:orca\s+)?orchestration\s+(?:status|run-list|dispatch-list|mailbox|inbox|check)\b|\bloom\s+(?:status|wait|ps|inbox(?!\s+ack))\b', cmd):
            tool.labels.add('poll')
            tool.keys.add('poll:' + re.sub(r'\b\d+\b', '#', cmd)[:130])
        elif re.search(r'\b(?:hc|herdr)\s+(?:read|tail)\b|\borchestration\s+(?:read|log|task-output)\b', cmd):
            tool.labels.add('worker_read')
            tool.keys.add('worker:' + cmd[:130])
        elif re.search(r'\b(?:loom\s+(?:task\s+(?:show|list)|inbox\s+ack)|(?:loom|orca|hc|herdr)\b.*--(?:skill|help))\b', cmd):
            tool.labels.add('protocol_query')
        elif re.search(r'\b(?:loom\s+(?:task\s+(?:approve|reject|claim|add)|lead|up|keys)|(?:hc|herdr)\s+(?:run|new|keys|label|rm)|\borchestration\s+(?:start|dispatch)|\b(?:git\s+(?:commit|merge|cherry-pick|add|push)))\b', cmd):
            tool.labels.add('coordinate')
        elif re.search(r'\bwc\s+-[a-zA-Z]*l\b', cmd):
            tool.labels.add('line_count')
        elif re.search(r'\bgit\s+(?:-[cC]\s+\S+\s+)*(?:status|diff|log|show|rev-parse)\b', cmd):
            tool.labels.add('verify_snapshot')
            tool.keys.add('snapshot:' + re.search(r'\bgit\b.*', cmd).group(0)[:150])
        elif re.search(r'(?i)(?:\b(?:pytest|vitest|jest|unittest|bats|ctest|ruff|mypy|tsc)\b|\b(?:npm|pnpm|yarn|bun|cargo|go|node|deno|make)\s+(?:--test|test|check|lint|typecheck|build|verify)\b|\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:test[\w:-]*|lint|check|typecheck|build|verify)\b|\b(?:verify|accept|test)[\w.-]*\.(?:sh|mjs|py|js)\b|\b(?:accept|grader)\b[^\n]*\.(?:mjs|js|py)|\bpython3?\b[^\n]*\bpy_compile\b)', cmd):
            tool.labels.add('test')
        elif report and re.search(r'(?:\s>>?\s*|\b(?:tee|mv|cp|touch)\b|\bsed\s+-i|\bwrite_text\b)', cmd):
            tool.labels.add('report_write')
        elif re.search(r'\b(?:apply_patch|tee|touch|mkdir|mv|cp|chmod|rm)\b|(?:^|\s)(?:>|>>)\s*(?!&|/dev/null)\S|\bsed\s+-i\b', cmd):
            tool.labels.add('edit')
        elif re.search(r'(?i)\b(?:cat|head|tail|sed|rg|grep|ls|find|readlink|jq|nl|awk|stat)\b', cmd):
            paths = re.findall(r"[\w.~/+-]+\." + SOURCE_SUFFIX, cmd)
            tool.labels.update(path_label(p) for p in paths)
            if not paths:
                tool.labels.add('read')
            tool.keys.update('read:' + p.removeprefix('./') for p in paths)
        else:
            tool.labels.add('other')


def wrap_commands(source):
    # functions.exec uses JS literals for shell commands, with tools as Promise batches.
    pattern = r'''\b(?:cmd|command)\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1'''
    for m in re.finditer(pattern, source):
        yield m.group(2).replace(r'\n', '\n').replace(r'\"', '"').replace(r"\'", "'")
    # Also support const cmds = ["..."]; cmds.map(cmd => tools.exec_command({cmd})).
    pattern = r'\bconst\s+cmds\s*=\s*(\[[\s\S]+?\])\s*;'
    match = re.search(pattern, source)
    if match:
        value = get_json(match.group(1))
        if isinstance(value, list):
            yield from (cmd for cmd in value if isinstance(cmd, str))


def classify_tool(name, raw):
    tool = Tool(name)
    obj = get_json(raw)
    if not isinstance(obj, dict):
        obj = {}
    low = name.lower()
    command = next((obj[k] for k in ('cmd', 'command', 'CommandLine', 'command_line', 'Command')
                    if isinstance(obj.get(k), str)), None)
    paths = [str(obj[k]) for k in ('Path', 'path', 'file_path', 'FilePath', 'TargetFile', 'target_file', 'AbsolutePath')
             if isinstance(obj.get(k), str)]
    patch = str(raw) if isinstance(raw, str) else ''
    patches = re.findall(r'\*\*\* (?:Add|Update|Delete|Move to)(?: File)?: ([^\r\n\\]+)', patch)
    if patches:
        tool.labels.update('report_write' if path_label(p) == 'result_read' else 'edit' for p in patches)
    if command:
        classify_command(command, tool)
        # Some agy Leader calls wrap hc in a Python subprocess inside a heredoc.
        # Require an explicit argument vector rather than matching the body of a report.
        for verb, label in (('wait', 'poll'), ('read', 'worker_read')):
            if re.search(r'\[\s*["\']hc["\']\s*,\s*["\']' + verb + r'["\']', command):
                tool.labels.add(label)
    elif low in {'exec', 'functions.exec'}:
        for command in wrap_commands(patch):
            classify_command(command, tool)
        if re.search(r'\btools\.write_stdin\s*\(', patch):
            tool.labels.add('tool_wait')
        if re.search(r'\btools\.(?:send_message_to_user_async|update_goal)\s*\(', patch):
            tool.labels.add('coordinate')
    elif 'edit' in low or low in {'write', 'write_file', 'apply_patch', 'replace_file_content', 'multi_replace_file_content'}:
        tool.labels.update('report_write' if path_label(p) == 'result_read' else 'edit' for p in paths or ['?'])
    elif low in {'read', 'read_file', 'cat', 'glob', 'grep', 'list_dir', 'list_directory',
                 'view_file', 'view_file_outline'} or 'search' in low:
        if low in {'grep', 'glob'} or 'search' in low or 'list' in low:
            tool.labels.add('read')
        else:
            tool.labels.update(path_label(p) for p in paths or ['?'])
            tool.keys.update('read:' + p.removeprefix('./') for p in paths)
    elif low in {'update_plan', 'update_steps', 'todowrite', 'taskupdate', 'tasklist', 'taskget'}:
        tool.labels.add('plan')
    elif re.search(r'write_stdin|command_status', low):
        tool.labels.add('tool_wait')
    elif re.search(r'wait|poll', low):
        tool.labels.add('poll')
    elif re.search(r'(?:send|notify|report)', low):
        tool.labels.add('coordinate')
    elif re.search(r'task|spawn_agent', low):
        tool.labels.add('coordinate')
    if not tool.labels:
        tool.labels.add('other')
    return tool


@dataclass
class Request:
    line: int
    time: str
    turn: int
    trigger: str
    model: str
    usage_source: str
    request_id: str
    fresh: int
    cached: int
    write: int
    output: int
    outgoing: list = field(default_factory=list)
    incoming: list = field(default_factory=list)
    incoming_line: int = 0
    reason: str = ''
    tail: str = ''
    origin: str = ''
    repeated: bool = False
    cache_1h: int = 0

    @property
    def context(self):
        return self.fresh + self.cached + self.write

    @property
    def weighted(self):
        return self.fresh + .1 * self.cached + 1.25 * self.write + .75 * self.cache_1h + 5 * self.output


def usage(u, provider, includes_reasoning=True):
    if provider == 'codex':
        n = u.get('input_tokens', 0)
        c = u.get('cached_input_tokens', 0)
        w = u.get('cache_write_input_tokens', 0)
        o = u.get('output_tokens', 0)
        if not includes_reasoning:
            o += u.get('reasoning_output_tokens', 0)
        return n - c - w, c, w, o
    if provider == 'claude':
        return tuple(u.get(k, 0) or 0 for k in
                     ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'))
    return tuple(u.get(k, 0) or 0 for k in ('input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens'))


def make_req(line, time, turn, trigger, model, source, ident, numbers, outgoing, incoming, at=0):
    if any(type(n) is not int or n < 0 for n in numbers):
        raise ValueError(f'Invalid usage in line {line} of {source}')
    return Request(line, time, turn, trigger, model, source, str(ident or ''), *numbers,
                   outgoing=list(outgoing), incoming=list(incoming), incoming_line=at)


def codex(path, meta, counts):
    requests = []
    legacy = []
    seen_ids = set()
    totals = None
    pending, outgoing, results = {}, [], []
    turn, trigger, at, model = 0, '', 0, ''
    for line, row in records(path):
        p = row.get('payload', {})
        typ, sub = row['type'], p.get('type')
        ts = row.get('timestamp', '')
        if typ == 'session_meta':
            if not allowed(p.get('cwd', '')) or Path(p['cwd']).resolve() != Path(meta['cwd']).resolve():
                counts['cwd_mismatch'] += 1
                return []
            model = p.get('model', model)
        elif typ == 'turn_context':
            if p.get('cwd') and not allowed(p['cwd']):
                counts['cwd_mismatch'] += 1
                return []
            model = p.get('model', model)
        elif typ == 'event_msg' and sub in {'task_started', 'turn_started'}:
            turn += 1
            trigger = 'start' if not requests and not legacy else 'external_wake'
            at, results, outgoing = line, [], []
        elif typ == 'response_item':
            if sub in {'function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call', 'mcp_tool_call'}:
                tool = classify_tool(p.get('name', sub), p.get('arguments') or p.get('input') or p.get('action'))
                pending[p.get('call_id') or p.get('id') or f'line:{line}'] = tool
                outgoing.append(tool)
            elif sub in {'function_call_output', 'custom_tool_call_output', 'mcp_tool_call_output'}:
                if p.get('call_id') in pending:
                    results.append(pending.pop(p['call_id']))
                at = line
            elif sub == 'message' and p.get('role') == 'user':
                if turn == 0:
                    turn = 1
                if trigger == 'external_wake':
                    trigger = wake_reason(block_text(p.get('content')))
                if not requests and not legacy:
                    trigger = 'start'
                at = line
        elif typ == 'token_usage_record' and isinstance(p.get('usage'), dict):
            ident = p.get('response_id')
            if not ident or ident not in seen_ids:
                if ident:
                    seen_ids.add(ident)
                requests.append(make_req(line, ts, max(1, turn), trigger or ('tool' if results else 'continuation'),
                                         model, typ, ident, usage(p['usage'], 'codex'), outgoing, results, at))
                outgoing, trigger, results, at = [], '', [], 0
        elif typ == 'event_msg' and sub == 'token_count' and isinstance(p.get('info'), dict):
            info = p['info']
            total = info.get('total_token_usage')
            if total == totals:
                counts['codex_duplicate_cumulative_marker'] += 1
                continue
            delta = info.get('last_token_usage')
            if not delta and total and totals:
                delta = {k: v - totals.get(k, 0) for k, v in total.items() if isinstance(v, int)}
            totals = total
            if not delta or not any(delta.values()):
                continue
            legacy.append(make_req(line, ts, max(1, turn), trigger or ('tool' if results else 'continuation'),
                                   model, 'token_count', '', usage(delta, 'codex',
                                   info.get('last_usage_includes_reasoning', True)), outgoing, results, at))
            if not requests:
                outgoing, trigger, results, at = [], '', [], 0
    if requests and legacy:
        counts['codex_native_and_legacy'] += 1
        counts['codex_usage_stream_count_difference'] += abs(len(requests) - len(legacy))
    return requests or legacy


def claude(path, meta, counts):
    cwd = claude_cwd(path)
    if not cwd or Path(cwd).resolve() != Path(meta['cwd']).resolve():
        counts['cwd_mismatch'] += 1
        return []
    groups, anchors, tools = {}, {}, {}
    results = []
    turn, trigger, at = 0, '', 0
    last_anchor = None
    for line, row in records(path):
        if row.get('cwd') and not allowed(row['cwd']):
            counts['cwd_mismatch'] += 1
            return []
        if row.get('isSidechain'):
            continue
        msg = row.get('message', {})
        kind = row['type']
        ts = row.get('timestamp', '')
        if kind == 'user':
            content = msg.get('content')
            tool_results = [c for c in content if isinstance(c, dict) and c.get('type') == 'tool_result'] if isinstance(content, list) else []
            if tool_results:
                results.extend(tools[c['tool_use_id']] for c in tool_results if c.get('tool_use_id') in tools)
                at = line
            elif not row.get('isMeta') and block_text(content).strip():
                turn += 1
                trigger = 'start' if turn == 1 else wake_reason(block_text(content))
                if (meta.get('cohort') == 'relay' and meta['run'] == '20261124151218-59651' and
                        meta['arm'] == 'h1' and meta['role'] == 'auditor' and turn in {4, 5, 6, 8}):
                    trigger = 'worker_wake'
                at, results = line, []
                # Concurrent JSONL writes can put a prompt immediately after its
                # API request even though the prompt's timestamp came first.
                if last_anchor and last_anchor not in groups and ts:
                    ln, request_time, _, _, incoming, _ = anchors[last_anchor]
                    if request_time and 0 <= utc(request_time) - utc(ts) <= 1:
                        anchors[last_anchor] = (ln, request_time, turn, trigger, incoming, line)
                        counts['claude_prompt_reordered'] += 1
                        trigger, at = '', 0
        elif kind == 'api-request':
            last_anchor = row.get('id')
            anchors[last_anchor] = (line, ts, max(1, turn), trigger, list(results), at)
            trigger, results, at = '', [], 0
        elif kind == 'assistant' and msg.get('usage') and msg.get('model') != '<synthetic>':
            ident = row.get('requestRef') or row.get('requestId') or msg.get('id') or f'line:{line}'
            ref = row.get('requestRef')
            if ident not in groups:
                anchor = anchors.get(ref, (line, ts, max(1, turn), trigger, list(results), at))
                ln, ts, group_turn, why, incoming, trigger_line = anchor
                groups[ident] = make_req(ln, ts, group_turn, why or ('tool' if incoming else 'continuation'),
                                         msg.get('model', ''), 'assistant.usage', ident, usage(msg['usage'], 'claude'),
                                         [], incoming, trigger_line)
                if ref not in anchors:
                    trigger, results, at = '', [], 0
            req = groups[ident]
            req.fresh, req.cached, req.write, req.output = usage(msg['usage'], 'claude')
            req.cache_1h = (msg['usage'].get('cache_creation') or {}).get('ephemeral_1h_input_tokens') or 0
            for block in msg.get('content', []):
                if block['type'] == 'tool_use' and block.get('id') not in tools:
                    tool = classify_tool(block['name'], block.get('input'))
                    tools[block.get('id')] = tool
                    req.outgoing.append(tool)
    counts['claude_api_request_without_usage'] += len(set(anchors) - set(groups))
    return sorted(groups.values(), key=lambda r: r.line)


def agy(path, meta, counts):
    requests, previous = [], []
    pending, async_tools, received = deque(), {}, []
    turn, trigger, at = 0, '', 0
    for line, row in records(path):
        kind = row['type']
        if kind == 'USER_INPUT':
            turn += 1
            trigger = 'start' if turn == 1 else wake_reason(row.get('content', ''))
            if meta.get('cohort') == 'relay' and meta['role'] == 'leader':
                # EXP-STATS ties these later user turns to relay batches/worker_done.
                if meta['arm'] in {'h1', 'orca'} and turn >= 3:
                    trigger = 'worker_wake'
            at = line
        elif kind == 'GENERIC' and pending:
            tool = pending.popleft()
            async_tools[row.get('step_index')] = tool
            received.append(tool)
            at = line
        elif kind == 'SYSTEM_MESSAGE':
            sender = re.search(r'(?m)^\[Message\][^\n]*?sender=\S+/task-(\d+)\b',
                               row.get('content', '')[:600])
            if sender and not trigger:
                trigger, at = 'async', line
                if tool := async_tools.get(int(sender.group(1))):
                    if all(t is not tool for t in received):
                        received.append(tool)
                else:
                    counts['agy_async_task_unmapped'] += 1
        elif kind == 'PLANNER_RESPONSE' and any(k in row for k in ('input_tokens', 'output_tokens')):
            outgoing = [classify_tool(t.get('name', ''), t.get('args')) for t in row.get('tool_calls', [])]
            requests.append(make_req(line, row.get('created_at', ''), max(1, turn),
                                     trigger or ('tool' if previous else 'continuation'), row.get('model', ''),
                                     'PLANNER_RESPONSE', row.get('step_index'), usage(row, 'agy'), outgoing,
                                     (received or previous) if trigger not in
                                     {'start', 'worker_wake', 'external_wake'} else [], at))
            trigger, at, previous, received = '', 0, outgoing, []
            pending = deque(outgoing)
    return requests


def labels(tools):
    useful = set().union(*(t.labels for t in tools))
    if len(useful) > 1:
        useful.discard('other')
    return useful


def analyze(requests, meta):
    last = max((i for i, r in enumerate(requests) if labels(r.outgoing) & SUBSTANTIVE), default=-1)
    seen = Counter()
    for i, req in enumerate(requests):
        inc, out = labels(req.incoming), labels(req.outgoing)
        all_keys = set().union(*(t.keys for t in req.incoming))
        req.repeated = bool(all_keys) and any(seen[k] for k in all_keys)
        seen.update(all_keys)
        if req.trigger in {'start', 'external_wake', 'worker_wake'}:
            req.reason = req.trigger
        elif inc:
            req.reason = '+'.join(sorted(inc))
        else:
            req.reason = req.trigger
        if last >= 0 and i > last:
            req.tail = 'post_work'
        if req.trigger in {'start', 'external_wake', 'worker_wake'}:
            req.origin = 'wake'
        elif inc & SUBSTANTIVE:
            req.origin = 'substantive_result'
        elif 'tool_wait' in inc:
            req.origin = 'tool_wait'
        elif inc and inc <= {'plan'}:
            req.origin = 'habit'
        elif inc and inc <= PROCESS:
            req.origin = 'process'
        elif inc and inc <= {'poll', 'worker_read'}:
            req.origin = 'coordination'
        elif inc and inc <= {'read', 'result_read', 'verify_snapshot', 'protocol_read'}:
            if req.repeated or (req.tail and inc == {'verify_snapshot'} and meta['role'] == 'worker'):
                req.origin = 'habit'
            else:
                req.origin = 'read_or_confirm'
        elif inc and inc <= PROCESS | COORD | {'plan'}:
            req.origin = 'coordination'
        elif inc and inc <= PROCESS | {'plan', 'verify_snapshot', 'read', 'result_read', 'protocol_read'}:
            req.origin = 'mixed_admin_read'
        elif inc:
            req.origin = 'mixed_tool'
        else:
            req.origin = 'unattributed'
        # A real edit/test produced by this response still needs a model request.
        if out & SUBSTANTIVE and req.origin in {'process', 'habit', 'coordination'}:
            req.origin = 'resumed_work'
    return last


def normalize_role(m, rs):
    if 'role' not in m:
        cwd = Path(m['cwd'])
        worktree = (m['provider'] == 'codex' or m['provider'] == 'claude') and any(
            label in cwd.parts for label in ('worktrees', 'worktree'))
        named_run = cwd.is_relative_to(RUNS) and bool(re.match(r'^[A-Z][A-Z0-9.]+-[0-9]', cwd.relative_to(RUNS).parts[0] if cwd != RUNS else ''))
        report_signal = any('report_write' in labels(r.outgoing) for r in rs)
        result = next((p for p in (cwd / 'RESULT.md', cwd.parent / 'RESULT.md')
                       if p.is_relative_to(RUNS) and allowed(p) and p.is_file()), None)
        if named_run and report_signal and result:
            m['role'], m['role_basis'] = 'worker_candidate', 'named_run+report_write+RESULT_artifact'
            m['result_artifact'] = str(result)
        elif named_run and report_signal:
            m['role'], m['role_basis'] = 'worker_candidate', 'named_run+report_write'
        elif worktree and report_signal:
            m['role'], m['role_basis'] = 'worker_candidate', 'worktree+report_write'
        else:
            m['role'], m['role_basis'] = 'unverified', 'cwd_only'
        m.update(cohort='scoped', run=project(cwd), arm='', task='')
    else:
        m['role_basis'] = 'EXP-STATS manifest'


def write_csv(name, rows):
    with (OUT / name).open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    counts = Counter()
    rows, sessions, missing = [], [], []
    seen = set()
    entries = [*relay_entries(), *scoped_entries()]
    for m in entries:
        provider, path, sid = m['provider'], Path(m['path']), m['session_id']
        if (provider, sid) in seen:
            continue
        seen.add((provider, sid))
        counts['candidate_' + m.get('cohort', 'scoped') + '_' + provider] += 1
        if not native_path(path, provider) or not path.is_file():
            missing.append((provider, sid, 'file_missing_or_outside_native_root'))
            continue
        if m.get('cohort') != 'relay' and path.stat().st_mtime >= CUTOFF:
            missing.append((provider, sid, 'file_modified_at_or_after_cutoff'))
            continue
        # Codex index/manifest and Claude slug are preliminary filters. The native
        # cwd is checked before decoding any request records.
        if provider == 'codex':
            first = next(records(path), (0, {}))[1]
            header_cwd = first.get('payload', {}).get('cwd')
            if (first.get('type') != 'session_meta' or not header_cwd or not allowed(header_cwd) or
                    Path(header_cwd).resolve() != Path(m['cwd']).resolve()):
                missing.append((provider, sid, 'header_cwd_unverified'))
                continue
        local_counts = Counter()
        requests = {'codex': codex, 'claude': claude, 'agy': agy}[provider](path, m, local_counts)
        counts.update(local_counts)
        normalize_role(m, requests)
        in_window, after_window = requests, []
        if m['cohort'] == 'relay' and m['run'] in RELAY_END:
            end = utc(RELAY_END[m['run']])
            in_window = [r for r in requests if not r.time or utc(r.time) < end]
            after_window = [r for r in requests if r not in in_window]
        last = analyze(in_window, m)
        analyze(after_window, m)
        key = {k: m.get(k, '') for k in ('cohort', 'run', 'arm', 'role', 'task',
                                        'provider', 'session_id')}
        for i, req in enumerate(requests, 1):
            row = asdict(req)
            row.pop('incoming')
            row.pop('outgoing')
            phase = 'later' if i > len(in_window) else 'main'
            rows.append(dict(key, request=i, phase=phase, **row, context=req.context, weighted=req.weighted,
                             incoming='+'.join(sorted(labels(req.incoming))),
                             outgoing='+'.join(sorted(labels(req.outgoing))),
                             incoming_tools='+'.join(t.name for t in req.incoming),
                             outgoing_tools='+'.join(t.name for t in req.outgoing)))
        ctx = [r.context for r in requests]
        sessions.append(dict(key, cwd=m['cwd'], path=str(path), role_basis=m['role_basis'],
                             result_artifact=m.get('result_artifact', ''),
                             calls=len(requests), main_calls=len(in_window),
                             fresh=sum(r.fresh for r in requests),
                             cached=sum(r.cached for r in requests), write=sum(r.write for r in requests),
                             cache_1h=sum(r.cache_1h for r in requests), output=sum(r.output for r in requests),
                             context=sum(ctx), weighted=sum(r.weighted for r in requests),
                             first=ctx[0] if ctx else '', final=ctx[-1] if ctx else '',
                             peak=max(ctx) if ctx else '', last_work_request=last+1 if last >= 0 else '',
                             parse_checks=json.dumps(dict(local_counts), sort_keys=True)))
    write_csv('requests.csv', rows)
    write_csv('sessions.csv', sessions)
    (OUT / 'coverage.json').write_text(json.dumps({'cutoff_utc': datetime.fromtimestamp(CUTOFF, timezone.utc).isoformat(),
                                                   'checks': dict(counts), 'missing': missing}, indent=2) + '\n')
    print(json.dumps({'sessions': len(sessions), 'requests': len(rows), 'checks': counts,
                      'missing_by_reason': Counter(x[2] for x in missing)}, indent=2))


if __name__ == '__main__':
    main()
