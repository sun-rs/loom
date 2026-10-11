"""Recompute existing paid evidence only. No provider calls or product changes."""
import hashlib
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parent


def load(relative):
    path = EVIDENCE / relative
    return json.loads(path.read_text()), {
        "path": "../" + relative,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def describe(values):
    mean = statistics.mean(values)
    sd = statistics.stdev(values)
    return {
        "n": len(values), "sum": sum(values), "mean": mean,
        "median": statistics.median(values), "sampleStandardDeviation": sd,
        "sampleCoefficientOfVariation": sd / mean,
        "observedMin": min(values), "observedMax": max(values),
        "observedMaxOverMin": max(values) / min(values),
    }


def group(cli, batch, task, pairs, source, limitations, measurement="raw input/output"):
    metrics = {}
    for metric in ["input", "output", "totalTokens"]:
        def value(p, side):
            u = p[side]
            return u["input"] + u["output"] if metric == "totalTokens" else u[metric]
        native = [value(p, "native") for p in pairs]
        current = [value(p, "current") for p in pairs]
        n, c = describe(native), describe(current)
        assert abs(c["mean"] / n["mean"] - c["sum"] / n["sum"]) < 1e-12
        metrics[metric] = {
            "native": n, "current": c,
            "ratioOfMeans": c["mean"] / n["mean"],
            "ratioOfMedians": c["median"] / n["median"],
            "pairedCurrentHigherCount": sum(y > x for x, y in zip(native, current)),
            "pairedRatios": [y / x for x, y in zip(native, current)],
        }
    return {"cli": cli, "batch": batch, "task": task, "measurement": measurement,
            "pairs": pairs, "metrics": metrics, "source": source, "limitations": limitations}


rows = []
mixed, source = load("2026-10-11-mixed-study-run/summary.json")
for cli in ["pi", "opencode", "kimi"]:
    binding = mixed["bindings"][cli]
    for task in ["A", "B"]:
        pairs = [{"pair": p["pair"], **p["sums"]} for p in binding["pairs"] if p["task"] == task]
        limits = ["Two pairs only; observed spread is not an acceptance or prediction interval."]
        if cli == "kimi":
            limits.append("Print/ACP dynamic ReadMediaFile mismatch remains; no pure protocol attribution.")
        rows.append(group(cli, "mixed", task, pairs, source, limits))

for cli in ["pi", "opencode", "claude", "codex"]:
    old, source = load(f"2026-10-11-v7-long-task/{cli}-complete.json")
    if cli == "opencode":
        pairs = [{"pair": p["block"], "native": p["native"], "current": p["current"]} for p in old["pairs"]]
    else:
        field = {"pi": "usage", "claude": "totals", "codex": "allReported"}[cli]
        pairs = []
        for number in range(1, 5):
            pair = {"pair": number}
            for side in ["native", "current"]:
                arm = next(a for a in old["arms"] if a["slot"] == f"{number}/{side}")
                pair[side] = {m: arm[field][m] for m in ["input", "output"]}
            pairs.append(pair)
    limitations = old.get("limitations", [])
    if cli == "opencode":
        limitations += ["Restricted search dependency in old cohort; retain as qualified historical evidence, not repaired-environment acceptance."]
    if cli == "claude":
        limitations += ["Quality 44/48 native vs 33/48 current; no equal-quality acceptance despite valid accounting."]
    row = group(cli, "v7", "A", pairs, source, limitations,
                "OTel all completed events including non-sampling startup; not unique billable usage" if cli == "codex" else "raw input/output")
    if cli == "codex":
        row["supplementarySampling"] = old["statistics"]["sampling"]
    rows.append(row)

old_kimi, kimi_source = load("2026-10-11-v7-long-task/kimi-complete.json")
result = {
    "kind": "loom-existing-evidence-variability-reanalysis/v1",
    "providerCalls": 0, "productChanged": False, "deploymentChanged": False,
    "scope": "10 separate task/batch/CLI strata; no pooling across tasks, versions, providers or CLIs.",
    "samplingUnit": "One fresh native or Loom session completing the entire continuous 12-turn task. Turns and HTTP requests are not independent replicates.",
    "method": [
        "Retain every completed original pair, including failed quality. Never select favorable traces.",
        "Report both arms' mean, median, sample SD/CV, observed range, ratio of means and paired direction count.",
        "With equal arm counts, ratio of means equals ratio of sums. The prior cumulative arithmetic was valid; the interpretation of individual ratios needed correction.",
        "CV and min/max describe observed samples; with n=2 or n=4 they do not establish a population distribution, prediction interval or statistical equivalence.",
        "Total tokens are input plus output; cache/reasoning subsets are already included, not added again. Token ratios are not invoice ratios or context-window occupancy.",
        "The owner considers roughly 20-30% overhead potentially acceptable. This is practical guidance for interpretation, not an automatic per-pair gate or a rewrite of target contract section 6.",
        "Overlapping observed ranges do not prove no systematic overhead. High variance does not cancel real extra consumption or quality failures.",
        "Old revisions and known fairness limits remain separate. Native variability includes sampled work paths and runtime effects, not proven pure model randomness.",
    ],
    "strata": rows,
    "notPooledOrPromoted": {
        "mixedCodexClaude": "No model launch in current batch; no current ratio, and prior results cannot fill those cells.",
        "oldKimi": {"source": kimi_source, "ratio": old_kimi["aggregateRatio"],
                    "reason": "Historical permission asymmetry disqualifies strict fairness; aggregate-only public evidence not used to invent an arm distribution."},
    },
    "decisions": {
        "piAndOpencode": "Prior four-pair results and current task-dependent directions do not establish generally unacceptable overhead. Stop treating individual high ratios as a product repair trigger.",
        "mixedPiB": "Two pairs both higher; mean input ratio about 1.408 with low observed native spread. Keep as a focused signal, not dismissed as noise and not enough to establish a universal defect.",
        "mixedOpencodeA": "One higher pair and one near parity; mean input ratio about 1.386. Keep actual spend visible; no consistent direction established from two pairs.",
        "oldClaude": "All four pairs higher, about 1.48 mean input ratio and worse measured quality. Stronger engineering signal, still tied to old source/model/task rather than proof of current defect.",
        "kimi": "Current B both slightly higher but mean input ratio about 1.023; repeated direction alone is not evidence of unacceptable magnitude. A has broad native spread; no guaranteed saving claim.",
        "next": "Do not modify prompts/scheduling or buy further large sweeps to force ratios to 1.0. Prioritize reproducible correctness/accounting failures; cost intervention requires a specific shared mechanism and predetermined material-overhead criterion.",
    },
    "futureComparisonRules": [
        "Freeze task commit/materials, success criteria, provider/model/effort, CLI version and memory policy on both sides.",
        "Use independent fresh sessions for repeats while retaining normal history within each long task. Interleave or randomize side order to reduce time-order effects.",
        "Retain pairing/blocking for fair conditions, but judge distributions and aggregate magnitude rather than demanding each pair approach 1.0.",
        "Predeclare sample count or bounded stopping rule and practical margin before new calls. Small n remains inconclusive rather than inviting endless reruns.",
        "A provider switch creates a separate stratum; never switch within an arm or construct a pair from different providers.",
    ],
    "ownerProviderFallback": {
        "authorized": "If aihubmix is exhausted, DeepSeek provider may be used for OpenCode and Pi.",
        "implementation": "Verify the installed binding and exact matched configuration when needed; no provider/account changes or paid calls in this reanalysis.",
    },
}
(HERE / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
for row in rows:
    m = row["metrics"]["input"]
    print(row["batch"], row["cli"], row["task"], "n", m["native"]["n"],
          "means", m["native"]["mean"], m["current"]["mean"],
          "ratio", round(m["ratioOfMeans"], 6), "higher", m["pairedCurrentHigherCount"])
