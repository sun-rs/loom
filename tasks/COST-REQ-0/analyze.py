"""Reconcile experiment records and quantify request count, context, and tails."""
from collections import Counter, defaultdict
import csv
import json

import numpy as np

from extract import OUT, RELAY, PROCESS, SUBSTANTIVE

SCENARIOS = {
    'base': (1, .10, 1.25, .75, 5),
    'raw_tokens': (1, 1, 1, 0, 1),
    'discounted_flat_output': (1, .10, 1.25, .75, 1),
    'costlier_cache': (1, .25, 1.25, .75, 2),
}
USAGE = ('fresh', 'cached', 'write', 'cache_1h', 'output')


def load_csv(name, numerical):
    with (OUT / name).open() as file:
        return [dict(r, **{k: int(r[k]) for k in numerical if r[k]}) for r in csv.DictReader(file)]


def cost(rows, scenario='base'):
    weights = SCENARIOS[scenario]
    return sum(sum(int(r[k]) * w for k, w in zip(USAGE, weights)) for r in rows)


def totals(rs):
    return dict(calls=len(rs), context=sum(r['context'] for r in rs),
                **{k: sum(r[k] for r in rs) for k in USAGE}, weighted=cost(rs))


def groups(rows, key):
    out = defaultdict(list)
    for r in rows:
        out[key(r)].append(r)
    return out


def published_usage():
    report = {}
    for p in sorted((RELAY / 'runs').glob('*/tokens.json')):
        for arm, a in json.loads(p.read_text())['arms'].items():
            roles = [('leader', a['leader']), ('auditor', a['auditor'])]
            roles.extend((w['task'], w) for w in a['workers'])
            for role, record in roles:
                v = record['usage']
                report[p.parent.name, arm, role] = [v[k] for k in
                    ('calls', 'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens')]
    return report


def r2(y, pred):
    baseline = np.sum((y - y.mean())**2)
    return float(1 - np.sum((y - pred)**2)/baseline)


def regression(sessions, transform, scenario='base', crossval=False):
    xs = np.array([[len(rs), sum(r['output'] for r in rs),
                    sum(r['context'] for r in rs) / len(rs)] for _, rs in sessions], dtype=float)
    ys = np.array([cost(rs, scenario) for _, rs in sessions], dtype=float)
    if transform == 'log':
        xs, ys = np.log1p(xs), np.log1p(ys)
    fold_ids = [m['run'] + '/' + m['arm'] for m, _ in sessions]
    results = {}
    for label, cols in [('N', [0]), ('output', [1]), ('mean_context', [2]),
                        ('N+context', [0, 2]), ('output+context', [1, 2]), ('N+output', [0, 1]),
                        ('all', [0, 1, 2])]:
        X = np.column_stack((np.ones(len(xs)), xs[:, cols]))
        pred = X @ np.linalg.lstsq(X, ys, rcond=None)[0]
        results[label] = r2(ys, pred)
        if crossval:
            for fold in sorted(set(fold_ids)):
                held = np.array([f == fold for f in fold_ids])
                pred[held] = X[held] @ np.linalg.lstsq(X[~held], ys[~held], rcond=None)[0]
            results[label + '_held_arm'] = r2(ys, pred)
    return results


def growth(sessions):
    rs = [r for _, ss in sessions for r in ss]
    bins = [[], [], []]
    ratios = []
    for _, ss in sessions:
        if len(ss) < 3:
            continue
        for i, r in enumerate(ss):
            j = min(2, 3 * i // len(ss))
            bins[j].append(r)
        ratios.append(ss[-1]['context']/ss[0]['context'] if ss[0]['context'] else np.nan)
    return dict(sessions=len(sessions), n_growth=len(ratios), median_ratio=float(np.nanmedian(ratios)),
                increasing=sum(ss[-1]['context'] > ss[0]['context'] for _, ss in sessions if len(ss) >= 3),
                bins=[dict(n=len(rs), median_context=float(np.median([r['context'] for r in rs])),
                           median_weighted=float(np.median([float(r['weighted']) for r in rs])),
                           cached_pct=sum(r['cached'] for r in rs)/sum(r['context'] for r in rs)) for rs in bins],
                components={k: sum(int(r[k]) for r in rs) * w / cost(rs)
                            for k, w in zip(USAGE, SCENARIOS['base'])})


def classify_tail(rs):
    result = {}
    for j, r in enumerate(rs):
        inc = set(filter(None, r['incoming'].split('+')))
        out = set(filter(None, r['outgoing'].split('+')))
        if not r['tail'] or r['origin'] in ('wake', 'substantive_result', 'tool_wait') or out & SUBSTANTIVE:
            continue
        # When the first post-work request follows a subprocess wait, the wait
        # may be doing actual testing. The extractor labels it separately.
        if inc and inc <= PROCESS | {'verify_snapshot', 'plan'} and inc & PROCESS:
            result[j] = 'process'
        elif inc == {'plan'} or (r['origin'] == 'habit' and inc == {'verify_snapshot'}):
            result[j] = 'habit'
    return result


def role_totals(sessions):
    rs = [r for _, ss in sessions for r in ss]
    tail = [r for r in rs if r['tail']]
    obs = Counter()
    origin_cost = defaultdict(float)
    for r in tail:
        obs[r['origin']] += 1
        origin_cost[r['origin']] += cost([r])
    reductions = defaultdict(list)
    for m, ss in sessions:
        for i, k in classify_tail(ss).items():
            reductions[k].append(ss[i])
    return dict(sessions=len(sessions), **totals(rs), tail=len(tail), tail_cost=cost(tail),
                tail_origin={k: [v, origin_cost[k]] for k, v in sorted(obs.items())},
                no_boundary=sum(not m.get('last_work_request') for m, _ in sessions),
                later_tail=sum(max(0, sum(bool(r['tail']) for r in ss)-1) for _, ss in sessions),
                reductions={k: [len(v), cost(v)] for k, v in sorted(reductions.items())},
                sensitivities={k: [cost(tail, k)/cost(rs, k),
                                    sum(cost(v, k) for v in reductions.values())/cost(rs,k)]
                               for k in SCENARIOS},
                wake=totals([r for r in rs if r['trigger'] in ('external_wake', 'worker_wake')]),
                worker_wake=totals([r for r in rs if r['trigger']=='worker_wake']),
                async_results=totals([r for r in rs if r['trigger']=='async']),
                poll_issued=totals([r for r in rs if 'poll' in r['outgoing'].split('+')]),
                poll=totals([r for r in rs if 'poll' in r['incoming'].split('+')]),
                wait=totals([r for r in rs if 'tool_wait' in r['incoming'].split('+')]),
                output_read=totals([r for r in rs if {'worker_read', 'result_read'} & set(r['incoming'].split('+'))]),
                snapshot=totals([r for r in rs if 'verify_snapshot' in r['incoming'].split('+')]),
                test_result=totals([r for r in rs if 'test' in r['incoming'].split('+')]),
                repeated_read=totals([r for r in rs if r['repeated']=='True' and
                                      {'read','worker_read','result_read','verify_snapshot'} & set(r['incoming'].split('+'))]))


def wake_replay(sessions):
    """An explicit wave policy. Keep the final event and one T1–T4 digest."""
    groups_by_arm = {}
    for meta, rs in sessions:
        if meta['role'] != 'leader':
            continue
        mid = [r for r in rs if r['trigger'] == 'worker_wake']
        if meta['arm'] in {'h1','orca'}:
            replace = mid[:-2]
            groups_by_arm[meta['run'] + '/' + meta['arm']] = totals(replace)
    return groups_by_arm


def main():
    reqs = load_csv('requests.csv', ('request', 'turn', 'context', *USAGE))
    metas = load_csv('sessions.csv', ('last_work_request', 'calls', 'main_calls'))
    by_session = groups(reqs, lambda r: (r['provider'], r['session_id']))
    primary, scoped, continuations = [], [], []
    official = published_usage()
    for m in metas:
        rs = by_session[(m['provider'], m['session_id'])]
        assert len(rs) == m['calls']
        if m['cohort'] == 'relay':
            main = [r for r in rs if r['phase'] == 'main']
            extra = [r for r in rs if r['phase'] != 'main']
            assert len(main) == m['main_calls']
            t = totals(main)
            k = (m['run'], m['arm'], m['task'] or m['role'])
            assert [t[f] for f in ('calls', 'context', 'cached', 'write', 'output')] == official.pop(k), k
            primary.append((m, main))
            if extra:
                continuations.append(dict(run=m['run'], role=m['role'], arm=m['arm'],
                                          first=extra[0]['time'], last=extra[-1]['time'], **totals(extra)))
        elif rs:
            scoped.append((m, rs))
    assert not official
    report = {'sessions': [], 'continuations': continuations, 'regression': {}, 'growth': {}, 'totals': {},
              'top_tail_triggers': {}}
    for m, rs in primary:
        tail = [r for r in rs if r['tail']]
        reductions = classify_tail(rs)
        policy = {k: totals([rs[i] for i, label in reductions.items() if label == k])
                  for k in set(reductions.values())}
        report['sessions'].append(dict(**{k: m[k] for k in ('run','arm','role','task','provider','session_id',
                                                            'last_work_request')},
                                         **totals(rs), first=rs[0]['context'], final=rs[-1]['context'],
                                         peak=max(r['context'] for r in rs), tail=len(tail), tail_cost=cost(tail),
                                         reductions=policy, coordination=role_totals([(m,rs)])))
    worker_artifact = [(m, rs) for m, rs in scoped if m['result_artifact'] and m['last_work_request']]
    cohorts = {'relay': primary, 'scoped': scoped, 'loom_workers': worker_artifact}
    for role in ('worker', 'leader', 'auditor'):
        cohorts['relay_' + role] = [(m, rs) for m, rs in primary if m['role']==role]
    for provider in ('codex', 'claude', 'agy'):
        cohorts['relay_' + provider] = [(m, rs) for m, rs in primary if m['provider']==provider]
        cohorts['scoped_' + provider] = [(m, rs) for m, rs in scoped if m['provider']==provider]
    for name, ss in cohorts.items():
        report['totals'][name] = role_totals(ss)
        report['growth'][name] = growth(ss)
        if name.startswith('relay_') or name == 'loom_workers':
            tails = [r for _, rs in ss for r in rs if r['tail']]
            report['top_tail_triggers'][name] = {k: totals(v) for k, v in
                                               groups(tails, lambda r: r['reason']).items()}
        report['regression'][name] = {scale: regression(ss, scale, crossval=name=='relay')
                                      for scale in ('level','log')} if len(ss) > 5 else {}
    report['regression']['relay_scenarios'] = {k: regression(primary,'level',k) for k in SCENARIOS}
    report['wave_replay'] = wake_replay(primary)
    report['arms'] = {k: role_totals(ss) for k, ss in groups(primary, lambda pair: pair[0]['run']+'/'+pair[0]['arm']).items()}
    report['scoped_projects'] = {k: {'sessions': len(ss), **totals([r for _, rs in ss for r in rs])}
                                 for k, ss in groups(scoped, lambda pair: pair[0]['run']).items()}
    report['loom_worker_details'] = [{
        'session_id': m['session_id'], 'cwd': m['cwd'], 'artifact': m['result_artifact'],
        'call_count': len(rs), 'last_work_request': m['last_work_request'],
        'tail': sum(bool(r['tail']) for r in rs), 'tail_weighted': cost([r for r in rs if r['tail']]),
        'reductions': {name: totals([rs[j] for j,k in classify_tail(rs).items() if name==k])
                       for name in set(classify_tail(rs).values())},
    } for m,rs in worker_artifact]
    (OUT / 'analysis.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(f"Reconciled {len(primary)} experiment sessions and checked {len(scoped)} additional sessions.")


if __name__ == '__main__':
    main()
