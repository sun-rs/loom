"""Analyze the immutable COST-REQ-0 extract and replay senior-role cache policies."""

import csv
import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from itertools import islice
from pathlib import Path
from statistics import median

OUT = Path(__file__).resolve().parent
SOURCE = OUT.parent / "COST-REQ-0"
HOME = Path.home()
LOOM_ROOTS = (HOME / "Code/repos/loom-next", HOME / ".loom-next/runs/loom-next")
RELAY = HOME / "Code/exp-relay/runs"
NATIVE = {
    "codex": HOME / ".codex/sessions",
    "agy": HOME / ".gemini/antigravity-cli/brain",
    "claude": HOME / ".claude/projects",
}
BINS = ("<1", "1–3", "3–5", "5–10", "10–20", "20–40", "40–60", "60–120", ">120")
EDGES = (60, 180, 300, 600, 1200, 2400, 3600, 7200)
FIELDS = ("fresh", "cached", "write", "cache_1h", "output", "context")
WAKES = {"external_wake", "worker_wake"}
ROLES = {"leader", "auditor"}
PROMPT_INPUT = 32
PING_OUTPUT = 16
HISTORY = PROMPT_INPUT + PING_OUTPUT
NEON_TAIL = 2050
DIGEST = 128
MIN_PREFIX = 50_000
# Snapshot of public standard API rates on 2026-11-25, USD per million.
# Tuple: base input, read multiplier, regular write multiplier, long write multiplier.
OPENAI = {
    "gpt-6.2-sol": (2, .05, 1.25, 2.5),
    "gpt-6.2-astra": (8, .05, 1.25, 2.5),
    "gpt-6.1-terra": (.5, .05, 1.25, 2.5),
    "gpt-6-luna": (.05, .1, 1.25, 2.5),
}
GEMINI = {
    "gemini-4-neon": (3, .05, 1, 1),
    "gemini-4-argon": (2, .05, 1, 1),
    "gemini-4-hydrogen": (1.5, .05, 1, 1),
    "gemini-3.8-flash": (.75, .1, 1, 1),
}
AUDITOR = re.compile(
    r"(?im)^\s*(?:role\s*:\s*(?:audit(?:or)?|lead\.auditor)\b"
    r"|you are\s+[^\n.!?]{0,115}?\bauditor\b"
    r"|cross-audit\b|round-\d+ read-only code audit\b|audit [\w.-]+ \(round\s*\d+\b"
    r"|[^\n]{0,140}\bperform an independent read-only audit\b)"
)
LEADER = re.compile(
    r"(?im)^\s*(?:role\s*:\s*(?:leader|driver|lead\.driver)\b"
    r"|you are\s+(?:the |a )?(?:loom-next |project )?(?:leader|driver|lead\.driver)"
    r"(?=\s*[,.!]|\s+for\b|\s+of\b|\s*$))"
)
SKIP_PROMPT = ("# AGENTS.md", "<environment_context>", "<permissions instructions>",
               "<collaboration_mode>", "<command-name>")
SECOND_RUN = "20261124165640-99591"
FIRST_RUN = "20261124151218-59651"


@dataclass(frozen=True)
class Usage:
    fresh: float
    cached: float
    write: float
    long: float
    output: float

    @classmethod
    def recorded(cls, row):
        return cls(row["fresh"], row["cached"], row["write"] - row["cache_1h"],
                   row["cache_1h"], row["output"])

    @property
    def raw(self):
        return self.fresh + self.cached + self.write + self.long + self.output

    @property
    def input(self):
        return self.raw - self.output

    @property
    def legacy(self):
        return self.fresh + .1 * self.cached + 1.25 * self.write + 2 * self.long + 5 * self.output

    def usd(self, price):
        base, read, write, long = price
        return base * (self.fresh + read * self.cached + write * self.write +
                       long * self.long + 5 * self.output) / 1e6


def read_csv(name):
    with (SOURCE / name).open(newline="") as file:
        return list(csv.DictReader(file))


def write_csv(name, rows):
    with (OUT / name).open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def price(model, context):
    if model in OPENAI:
        return OPENAI[model]
    if model.startswith("gemini"):
        return GEMINI[model.rsplit("-", 1)[0]]
    base = {"claude-sonnet-5-5": 2, "claude-opus-5-5": 4,
            "claude-haiku-5-5": .5 if context > 100_000 else .1}[model]
    return base, .1 if model == "claude-haiku-5-5" else .05, 1.25, 2


def scoped(path, roots):
    return (any(path.is_relative_to(root) for root in roots) and
            all(part != "provider-homes" and not part.startswith(".env") for part in path.parts))


def user_text(row):
    payload = row.get("payload", {})
    kind = row.get("type")
    if (kind, payload.get("type"), payload.get("role")) == ("response_item", "message", "user"):
        content = payload.get("content", [])
    elif kind == "USER_INPUT":
        content = row.get("content", "")
    elif kind == "user" and not row.get("isMeta") and not row.get("isSidechain"):
        content = row.get("message", {}).get("content", [])
        if isinstance(content, list) and any(block.get("type") == "tool_result" for block in content):
            return ""
    else:
        return ""
    if isinstance(content, str):
        return content.strip()
    return "\n".join(block.get("text", "") for block in content or []
                     if block.get("type") in {"text", "input_text"}).strip()


def identify_role(session):
    """Only inspect the original startup input from the listed native transcript."""
    if session["cohort"] != "scoped" or not int(session["calls"]):
        return None
    if not scoped(Path(session["cwd"]).resolve(), LOOM_ROOTS):
        return None
    path = Path(session["path"])
    provider, sid = session["provider"], session["session_id"]
    named_record = {
        "codex": path.name.startswith("rollout-") and path.name.endswith(f"-{sid}.jsonl"),
        "agy": path.name == "transcript_full.jsonl" and path.parents[2].name == sid,
        "claude": path.name == f"{sid}.jsonl",
    }[provider]
    if not named_record or path.is_symlink() or not scoped(path.resolve(), (NATIVE[provider],)):
        raise ValueError(f"Unexpected session path for {session['session_id']}")
    with path.open() as file:
        for line, raw in enumerate(islice(file, 160), 1):
            try:
                prompt = user_text(json.loads(raw))
            except json.JSONDecodeError:
                continue
            if not prompt or prompt.startswith(SKIP_PROMPT):
                continue
            matches = [role for role, pattern in (("leader", LEADER), ("auditor", AUDITOR))
                       if pattern.search(prompt[:1200])]
            if len(matches) == 1:
                return {"provider": session["provider"], "session_id": session["session_id"],
                        "role": matches[0], "cwd": session["cwd"], "native_prompt_line": line,
                        "basis": "startup assignment or direct independent audit mandate"}
            break
    return None


def load():
    sessions = {(s["provider"], s["session_id"]): s for s in read_csv("sessions.csv")}
    roles = {key: found for key, session in sessions.items() if (found := identify_role(session))}
    groups = defaultdict(list)
    for row in read_csv("requests.csv"):
        for key in (*FIELDS, "request", "turn", "line"):
            row[key] = int(row[key])
        key = row["provider"], row["session_id"]
        row["original_role"] = row["role"]
        if key in roles:
            row["role"] = roles[key]["role"]
        row["sample"] = "loom-next" if scoped(Path(sessions[key]["cwd"]), LOOM_ROOTS) else row["cohort"]
        row["time"] = datetime.fromisoformat(row["time"].replace("Z", "+00:00"))
        row["usage"] = Usage.recorded(row)
        row["price"] = price(row["model"], row["context"])
        assert row["usage"].input == row["context"] and row["cache_1h"] <= row["write"]
        groups[key].append(row)
    for key, rows in groups.items():
        rows.sort(key=lambda row: row["request"])
        meta = sessions[key]
        assert len(rows) == int(meta["calls"])
        assert sum(r["phase"] == "main" for r in rows) == int(meta["main_calls"])
        assert all(sum(r[field] for r in rows) == int(meta[field]) for field in FIELDS)
        assert math.isclose(sum(r["usage"].legacy for r in rows), float(meta["weighted"]), abs_tol=.0001)
    return sessions, roles, groups


def gap(previous, row):
    return (row["time"] - previous["time"]).total_seconds()


def bucket(seconds):
    return BINS[sum(seconds >= edge for edge in EDGES[:-1]) + (seconds > EDGES[-1])]


def series(pairs, scope):
    """Series use request mean, median, token ratio and presence over the same rows."""
    for (provider, model, role), bins in sorted(pairs.items()):
        for label in BINS:
            batch = bins[label]
            ratios = [row["cached"] / row["context"] for row in batch]
            yield dict(scope=scope, provider=provider, model=model, role=role, gap_minutes=label,
                       requests=len(batch), sessions=len({r["session_id"] for r in batch}),
                       mean_cache_ratio=sum(ratios) / len(batch) if batch else "",
                       median_cache_ratio=median(ratios) if batch else "",
                       token_cache_ratio=sum(r["cached"] for r in batch) / sum(r["context"] for r in batch)
                       if batch else "", any_hit_requests=sum(x > 0 for x in ratios),
                       half_hit_requests=sum(x >= .5 for x in ratios),
                       write_1h_requests=sum(r["cache_1h"] > 0 for r in batch),
                       write_1h_tokens=sum(r["cache_1h"] for r in batch),
                       write_5m_or_other_tokens=sum(r["write"] - r["cache_1h"] for r in batch))


def empirical(groups):
    stats = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    warm = defaultdict(list)
    exclusions = Counter()
    for rows in groups.values():
        exclusions["first_request"] += 1
        for previous, row in zip(rows, rows[1:]):
            seconds = gap(previous, row)
            if seconds < 0 or previous["model"] != row["model"] or not row["context"]:
                exclusions["negative_or_model_change_or_empty"] += 1
                continue
            p, m = row["provider"], row["model"]
            label = bucket(seconds)
            for scope in ("all", row["sample"]):
                if row["phase"] == "later" and scope == "relay":
                    continue
                for model, role in {("*", "*"), (m, "*"), ("*", row["role"]), (m, row["role"])}:
                    stats[scope][p, model, role][label].append(row)
            if row["trigger"] in WAKES:
                stats["external_wake"][p, m, row["role"]][label].append(row)
            if p == "agy" and m.startswith("gemini-4-neon"):
                date = row["time"].date().isoformat()
                stats[date][p, "*", "*"][label].append(row)
            if seconds < 60 and row["context"] >= .8 * previous["context"]:
                warm[p, m].append(min(1, row["cached"] / min(row["context"], previous["context"])))
    result = [row for scope, pairs in sorted(stats.items()) for row in series(pairs, scope)]
    return result, {key: median(values) for key, values in warm.items()}, dict(exclusions)


def aggregate(rows):
    return {"calls": len(rows), "context": sum(r["context"] for r in rows),
            "usd": sum(r["usage"].usd(r["price"]) for r in rows),
            "raw": sum(r["usage"].raw for r in rows),
            "legacy": sum(r["usage"].legacy for r in rows)}


def worker_share(groups):
    parts = defaultdict(list)
    for rows in groups.values():
        if rows[0]["sample"] != "relay":
            continue
        main = [row for row in rows if row["phase"] == "main"]
        start = main[0]
        directory = RELAY / start["run"]
        with (directory / "tokens.json").open() as file:
            records = json.load(file)["arms"][start["arm"]]
        record = (next(w for w in records["workers"] if w["task"] == start["task"])
                  if start["role"] == "worker" else records[start["role"]])["usage"]
        keys = ("calls", "inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens")
        # EXP-STATS reports full input, with cache reads and writes also itemized.
        actual = [len(main), sum(r["context"] for r in main), sum(r["cached"] for r in main),
                  sum(r["write"] for r in main), sum(r["output"] for r in main)]
        assert actual == [record[k] for k in keys], (start["run"], start["arm"], start["role"])
        for label in (f'{start["run"]}/{start["arm"]}', start["run"], "all/main"):
            parts[label].extend(main)
        parts["all/including-later"].extend(rows)
    return {label: {role: aggregate([r for r in rows if r["role"] == role])
                    for role in ("worker", "leader", "auditor")}
            for label, rows in sorted(parts.items())}


def regime(rows):
    previous = rows[0]
    provider = previous["provider"]
    if provider == "codex":
        return 30, 25
    if provider == "agy":
        return 5, 4
    writes = sum(r["write"] for r in rows)
    return (60, 55) if sum(r["cache_1h"] for r in rows) > writes / 2 else (5, 4)


def ping_usage(prefix, carried, p):
    tail = min(prefix, NEON_TAIL) if p == "agy" else 0
    return Usage(tail + PROMPT_INPUT, prefix - tail + carried, 0, 0, PING_OUTPUT)


def break_even():
    cases = (
        ("Codex GPT-6.2 Sol fresh", "codex", "gpt-6.2-sol", 30, 25, 1),
        ("Codex GPT-6.2 Sol 30m write", "codex", "gpt-6.2-sol", 30, 25, 1.25),
        ("agy Neon 5m scenario", "agy", "gemini-4-neon-xhigh", 5, 4, 1),
        ("agy Neon 3m sensitivity", "agy", "gemini-4-neon-xhigh", 3, 2, 1),
        ("Claude Sonnet 5.5 5m", "claude", "claude-sonnet-5-5", 5, 4, 1.25),
        ("Claude Sonnet 5.5 1h", "claude", "claude-sonnet-5-5", 60, 55, 2),
    )
    prefix = MIN_PREFIX
    results = []
    for name, provider, model, ttl, interval, miss in cases:
        rate = price(model, prefix)
        base, read, _, _ = rate
        value = (prefix - (NEON_TAIL if provider == "agy" else 0)) * (miss - read)
        ping = ping_usage(prefix, 0, provider).usd(rate) * 1e6 / base
        def incremental(count):
            return count * (ping + miss * HISTORY) + read * HISTORY * count * (count - 1) / 2
        max_pings = max(n for n in range(100) if incremental(n) < value)
        horizon = min((max_pings + 1) * interval, max_pings * interval + ttl)
        min_interval = ttl / (max_pings + 1)
        results.append(dict(case=name, ttl_minutes=ttl, interval_minutes=interval,
                            prefix=prefix, uncached_tail=NEON_TAIL if provider == "agy" else 0,
                            miss_weight=miss, read_weight=read, avoidable_cost_weighted=value,
                            first_ping_weighted=ping, raw_first_ping_plus_grown_real=prefix+2*HISTORY,
                            max_pings=max_pings, profitable_gap_starts_minutes=ttl,
                            profitable_gap_ends_minutes=horizon, minimum_viable_interval_minutes=min_interval,
                            required_coverage_probability_one_ping=incremental(1)/value,
                            raw_profitable_gap=None, raw_profitable_interval=None))
    return results


def possible_reuse(previous, row, warm):
    if (previous["model"] != row["model"] or row["context"] < .8 * previous["context"]):
        return row["cached"]
    fraction = warm.get((row["provider"], row["model"]), 0)
    expected = min(row["context"], previous["context"]) * fraction
    return max(row["cached"], expected)


def restore(row, restored):
    """Propagate the observed split of the misses that can become cache reads."""
    old = row["usage"]
    uncached = old.input - old.cached
    fraction = min(1, restored / uncached) if uncached else 0
    return Usage(old.fresh * (1-fraction), old.cached + uncached*fraction,
                 old.write * (1-fraction), old.long * (1-fraction), old.output)


def input_history_cost(tokens, usage, rate):
    """Charge persistent extra input in the same proportions as this real request."""
    base, read, write, long = rate
    blended = (usage.fresh + read * usage.cached + write * usage.write + long * usage.long) / usage.input
    return tokens * base * blended / 1e6


def ping_delta(previous, row, ttl, interval, carried, warm, cap=None):
    # Turn boundary with neither an outstanding logged tool from the last response
    # nor an incoming tool result on this request.
    waiting = (row["trigger"] in WAKES and row["turn"] > previous["turn"] and
               not previous["outgoing_tools"] and not row["incoming_tools"])
    minutes = gap(previous, row)/60
    pings = max(0, math.ceil(minutes/interval) - 1) if waiting else 0
    if cap is not None:
        pings = min(pings, cap)
    warm_cap = possible_reuse(previous, row, warm)
    if row["provider"] == "agy" and pings:
        warm_cap = max(row["cached"], min(warm_cap, previous["context"] - NEON_TAIL))
    bridgeable = ttl <= minutes <= pings * interval + ttl and pings > 0
    saved = (row["usage"].usd(row["price"]) - restore(row, warm_cap - row["cached"]).usd(row["price"])
             if bridgeable else 0)
    costs = [ping_usage(previous["context"], carried + i * HISTORY, row["provider"])
             for i in range(pings)]
    carried += pings * HISTORY
    usd = sum(c.usd(row["price"]) for c in costs) + input_history_cost(carried, row["usage"], row["price"])
    raw = sum(c.raw for c in costs) + carried
    return pings, waiting, bridgeable, carried, usd, raw, saved


def coalesced(rows):
    """Merge only documented successful intermediate Relay worker notices."""
    first = rows[0]
    if first["sample"] != "relay":
        return {}, {}
    arm, role = first["arm"], first["role"]
    wakes = [r for r in rows if r["trigger"] == "worker_wake"]
    if arm in {"h1", "orca"} and role == "leader":
        # Last two are the T1–T4 dependency gate and then T5 completion.
        removed, kept = wakes[:-2], wakes[-2:-1]
    elif first["run"] == FIRST_RUN and arm == "h1" and role == "auditor":
        # Four success copies including T5. Pool earlier findings with T5.
        removed, kept = wakes[:-1], wakes[-1:]
    else:
        return {}, {}
    if not (removed and kept):
        return {}, {}
    return {row["request"]: row for row in removed}, {kept[0]["request"]: len(removed)*DIGEST}


def clock(value):
    return datetime.fromisoformat(f"2026-11-24T{value}+00:00")


def shorter_wave(rows):
    """Move the actual run-2 H1 W1 delivery with its three prerequisites intact."""
    first = rows[0]
    if (first["run"], first["arm"], first["role"]) != (SECOND_RUN, "h1", "leader"):
        return {}
    wake = next(r for r in rows if r["trigger"] == "worker_wake")
    latest_ready = max(clock(t) for t in ("17:03:44.123", "17:04:00.475", "17:07:03.043"))
    new_wake = max(clock("17:03:20.441"), latest_ready)
    shift = wake["time"] - new_wake
    return {r["request"]: r["time"] - shift for r in rows if r["turn"] == wake["turn"]}


def wave_delta(previous, row, timings, warm, threshold):
    if not timings:
        return 0
    old = gap(previous, row)
    new = (timings.get(row["request"], row["time"]) -
           timings.get(previous["request"], previous["time"])).total_seconds()
    if new < threshold*60 <= old:
        return restore(row, possible_reuse(previous, row, warm) - row["cached"]).usd(row["price"]) - row["usage"].usd(row["price"])
    if old < threshold*60 <= new:
        u = row["usage"]
        cold = Usage(u.fresh + u.cached, 0, u.write, u.long, u.output)
        return cold.usd(row["price"]) - u.usd(row["price"])
    return 0


def change_provider(previous, row, ttl, warm, recovery):
    if row["provider"] == "claude":
        return row["usage"].usd(row["price"])
    read = 0
    if previous:
        seconds = gap(previous, row)
        if seconds <= 3600:
            read = row["cached"]
            if seconds >= ttl*60:
                read += recovery * (possible_reuse(previous, row, warm) - read)
    u = Usage(0, read, 0, row["context"] - read, row["output"])
    return u.usd(price("claude-sonnet-5-5", row["context"]))


def codex_extended(first, previous, row, warm):
    """Price one fixed startup prefix with an absolute 12-hour retention clock."""
    if row["provider"] != "codex":
        return 0.0
    startup_prefix = .8 * first["context"]
    if startup_prefix < 1024:
        return 0.0
    base, _, write, long = row["price"]
    if previous is None:
        return startup_prefix * base * (long - write) / 1e6
    if gap(previous, row) < 30*60 or gap(first, row) > 12*3600:
        return 0.0
    prefix = min(startup_prefix, possible_reuse(previous, row, warm))
    restored = restore(row, .5 * max(0, prefix - row["cached"]))
    return restored.usd(row["price"]) - row["usage"].usd(row["price"])


def replay_series(groups, warm):
    data = []
    for all_rows in groups.values():
        rows = [r for r in all_rows if r["role"] in ROLES and r["sample"] in {"relay", "loom-next"}
                and r["phase"] == "main"]
        if not rows:
            continue
        ttl, interval = regime(rows)
        removed, digests = coalesced(rows)
        timings = shorter_wave(rows)
        carries = [0, 0, 0]
        digest_history = 0
        previous = None
        for row in rows:
            u, rate = row["usage"], row["price"]
            usd = u.usd(rate)
            summary = dict(sample=row["sample"], run=row["run"], arm=row["arm"], role=row["role"],
                           provider=row["provider"], model=row["model"], session_id=row["session_id"],
                           request=row["request"], turn=row["turn"], time_utc=row["time"].isoformat(),
                           trigger=row["trigger"], gap_seconds=gap(previous, row) if previous else "",
                           context=row["context"], cached=row["cached"], cache_1h=row["cache_1h"],
                           ttl_minutes=ttl, interval_minutes=interval, b_pings=0, b_wait=False,
                           b_chain_can_bridge=False, b_alt_pings=0, b_cap_pings=0, b_usd_net50=0.0,
                           b_usd_net100=0.0, b_usd_net0=0.0, b_raw_delta=0.0, b_alt_usd_net50=0.0,
                           b_alt_raw_delta=0.0, b_cap_usd_net50=0.0, b_cap_raw_delta=0.0,
                           b_eta_oracle_pings=0, b_eta_oracle_usd_net50=0.0,
                           b_eta_oracle_raw_delta=0.0,
                           c_new_time_utc=timings.get(row["request"], row["time"]).isoformat(),
                           c_short_usd_delta5=0.0, c_short_usd_delta10=0.0,
                           a_usd=usd, a_raw=u.raw)
            if previous:
                regimes = [(ttl, interval, None),
                           (3, 2, None) if row["provider"] == "agy" else (ttl, interval, None),
                           (ttl, interval, 1)]
                for i, (test_ttl, test_interval, cap) in enumerate(regimes):
                    n, waiting, bridgeable, carries[i], spend, raw, saved = ping_delta(
                        previous, row, test_ttl, test_interval, carries[i], warm, cap
                    )
                    if i == 0:
                        summary.update(b_pings=n, b_wait=waiting, b_chain_can_bridge=bridgeable,
                                       b_usd_net50=spend-.5*saved, b_usd_net100=spend-saved,
                                       b_usd_net0=spend, b_raw_delta=raw)
                    elif i == 1:
                        summary.update(b_alt_pings=n, b_alt_usd_net50=spend-.5*saved, b_alt_raw_delta=raw)
                    else:
                        summary.update(b_cap_pings=n, b_cap_usd_net50=spend-.5*saved, b_cap_raw_delta=raw)
                for threshold in (5, 10):
                    summary[f"c_short_usd_delta{threshold}"] = wave_delta(previous, row, timings, warm, threshold)
                # Best available ETA sensitivity. Uses actual future wake timing,
                # but does not select by the subsequently observed hit/miss.
                if (row["provider"] != "agy" and summary["b_wait"] and
                        ttl*60 <= gap(previous, row) <= (ttl+interval)*60 and
                        previous["context"] >= MIN_PREFIX):
                    prefix = previous["context"]
                    restored = restore(row, .5 * (possible_reuse(previous, row, warm) - row["cached"]))
                    touch = Usage(0, prefix, 0, 0, 0)
                    summary.update(b_eta_oracle_pings=1,
                                   b_eta_oracle_usd_net50=touch.usd(rate) + restored.usd(rate) - usd,
                                   b_eta_oracle_raw_delta=touch.raw)
            n = row["request"]
            digest_history += digests.get(n, 0)
            summary.update(c_coalesced_calls=-int(n in removed),
                           c_coalesced_usd_delta=(u.output*5*rate[0]/1e6-usd if n in removed
                                                  else input_history_cost(digest_history, u, rate)),
                           c_coalesced_raw_delta=-row["context"] if n in removed else digest_history,
                           d_usd_same_hits=change_provider(previous, row, ttl, warm, 0),
                           d_usd_50=change_provider(previous, row, ttl, warm, .5),
                           d_usd_100=change_provider(previous, row, ttl, warm, 1),
                           d_same_model_12h_usd_delta=codex_extended(rows[0], previous, row, warm),
                           d_raw=u.raw)
            data.append(summary)
            previous = row
    return data


def replay_rollup(data):
    groups = defaultdict(list)
    for row in data:
        groups[(row["sample"], "*", "*")].append(row)
        groups[(row["sample"], row["role"], row["provider"])].append(row)
        groups[(row["sample"], row["role"], row["model"])].append(row)
        if row["sample"] == "relay":
            groups[(row["run"], row["arm"], row["role"])].append(row)
    fields = [f for f in data[0] if f.startswith(("a_", "b_", "c_", "d_"))
              and f != "c_new_time_utc"]
    return [dict(scope=scope, split_one=split1, split_two=split2,
                 sessions=len({r["session_id"] for r in rows}), requests=len(rows),
                 **{f: round(sum(row[f] for row in rows), 8) for f in fields})
            for (scope, split1, split2), rows in sorted(groups.items())]


def main():
    sessions, roles, groups = load()
    hits, warm, exclusions = empirical(groups)
    share = worker_share(groups)
    replay = replay_series(groups, warm)
    write_csv("cache-hit.csv", hits)
    write_csv("replay.csv", replay)
    result = dict(session_rows=len(sessions), sessions_with_requests=len(groups),
                  request_rows=sum(map(len, groups.values())), exclusions=exclusions,
                  bins=BINS, warm_prefix_ratio={"/".join(key): value for key, value in warm.items()},
                  role_evidence=list(roles.values()), worker_share=share,
                  break_even=break_even(), replay=replay_rollup(replay))
    (OUT / "analysis.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
