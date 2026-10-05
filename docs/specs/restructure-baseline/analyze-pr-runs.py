#!/usr/bin/env python3
"""Per-run and per-condition metrics for the closer-handoff measurement (ADR 0027, ticket 0081).

Usage: analyze-pr-runs.py <runs-dir-prefix-for-A> ... : see RUNS below.
Reads, per run: <prefix>.json (claude -p output), .start/.end, .integrity, .ticket, and the
transcripts under ~/.claude/projects/<fixture>/<session>/ (main + subagents/).
Context of a call = input + cache_read + cache_creation tokens of its assistant message (the
definition of `litecode token-report --detail`); each message id counted once; synthetic
API-error lines ignored.
"""
import glob, json, math, os, re, statistics as st, sys, datetime

RUNS = {"A": ["m0A", "n1A", "n2A", "n3A", "n4A"], "B": ["m0B", "n1B", "n2B", "n3B", "n4B"]}
PROJ = os.path.expanduser("~/.claude/projects/-private-tmp-lc-pr")

def read_jsonl(path):
    for line in open(path):
        try: yield json.loads(line)
        except Exception: pass

def instance(path):
    calls, order, pr_at = {}, [], None
    for d in read_jsonl(path):
        m = d.get("message") or {}
        u = m.get("usage")
        if d.get("type") != "assistant" or not u: continue
        if m.get("model") == "<synthetic>" or d.get("isApiErrorMessage"): continue
        i = m.get("id") or f"anon{len(order)}"
        ctx = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
        if i not in calls: order.append(i)
        calls[i] = (ctx, u.get("output_tokens", 0))
        for c in m.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and isinstance(c.get("input"), dict):
                if pr_at is None and re.search(r"gh pr create", c["input"].get("command") or ""): pr_at = order.index(i)
    ctxs = [calls[i][0] for i in order]; outs = [calls[i][1] for i in order]
    tail = sum(ctxs[pr_at + 1:]) if pr_at is not None else None
    return dict(calls=len(order), ctx=sum(ctxs), out=sum(outs), pr_at=pr_at, tail=tail, maxctx=max(ctxs) if ctxs else 0)

def run(name):
    d = json.load(open(f"/tmp/{name}.json"))
    sid = d["session_id"]
    main = instance(f"{PROJ}/{sid}.jsonl")
    subs = {}
    for meta in glob.glob(f"{PROJ}/{sid}/subagents/agent-*.meta.json"):
        t = json.load(open(meta)).get("agentType", "?")
        i = instance(meta.replace(".meta.json", ".jsonl"))
        a = subs.setdefault(t, dict(calls=0, ctx=0, out=0, n=0))
        a["calls"] += i["calls"]; a["ctx"] += i["ctx"]; a["out"] += i["out"]; a["n"] += 1
    t0 = datetime.datetime.fromisoformat(open(f"/tmp/{name}.start").read().strip().replace("Z", "+00:00"))
    t1 = datetime.datetime.fromisoformat(open(f"/tmp/{name}.end").read().strip().replace("Z", "+00:00"))
    res = d["result"]
    hunt = re.search(r"HUNT:\s*(complete|partial)", res, re.I)
    integ = open(f"/tmp/{name}.integrity").read()
    prs = re.findall(r"pr #(\d+) (\w+) head (\w+)", integ)
    newest = max(prs, key=lambda p: int(p[0])) if prs else None
    ci = bool(newest) and re.search(rf"pull_request {newest[2]} (success|failure)", integ) is not None
    ci_ok = bool(newest) and re.search(rf"pull_request {newest[2]} success", integ) is not None
    tot_ctx = main["ctx"] + sum(s["ctx"] for s in subs.values())
    tot_out = main["out"] + sum(s["out"] for s in subs.values())
    return dict(name=name, cost=d["total_cost_usd"], secs=(t1 - t0).total_seconds(), main=main, subs=subs,
                total_ctx=tot_ctx, total_out=tot_out, total=tot_ctx + tot_out, denials=len(d["permission_denials"]),
                ticket=open(f"/tmp/{name}.ticket").read().strip().replace("status: ", ""),
                hunt=(hunt.group(1).lower() if hunt else ("partial" if "partial" in res.lower() else "?")),
                ci=ci, ci_ok=ci_ok, tail_share=(main["tail"] / main["ctx"]) if main["tail"] is not None and main["ctx"] else None,
                pr_found=bool(newest))

def tcrit(df):
    table = {1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,8:2.306,9:2.262,10:2.228,12:2.179,15:2.131,20:2.086}
    return table[min(table, key=lambda k: abs(k - df))]

def welch(a, b):
    ma, mb = st.mean(a), st.mean(b); va, vb = st.variance(a), st.variance(b); na, nb = len(a), len(b)
    se = math.sqrt(va / na + vb / nb)
    df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1)) if se else 1
    d = mb - ma; tc = tcrit(df)
    return ma, mb, 100 * d / ma, 100 * (d - tc * se) / ma, 100 * (d + tc * se) / ma

if __name__ == "__main__":
    out = {c: [run(n) for n in names] for c, names in RUNS.items()}
    print("per run: cost USD | secs | main calls | main ctx | tail share | all-instance tokens (ctx read + out) | denials | ticket | hunt | CI for own PR")
    for c in "AB":
        for r in out[c]:
            ts = f"{100*r['tail_share']:.0f}%" if r["tail_share"] is not None else "-"
            print(f"{r['name']:4s} ${r['cost']:.3f} {r['secs']:5.0f}s calls {r['main']['calls']:3d} ctx {r['main']['ctx']:9,d} tail {ts:>4s} total {r['total']:9,d} den {r['denials']} {r['ticket']:11s} hunt {r['hunt']:8s} CI {'ok' if r['ci_ok'] else ('red' if r['ci'] else 'NONE')}  subs {dict((k, v['n']) for k, v in r['subs'].items())}")
    print("\nper condition (mean +/- sd, n=5) and difference B vs A with a 95% interval")
    metrics = [("cost USD", lambda r: r["cost"]), ("all-instance tokens", lambda r: r["total"]), ("all-instance context read", lambda r: r["total_ctx"]),
               ("main (implementer) context read", lambda r: r["main"]["ctx"]), ("main calls", lambda r: r["main"]["calls"]),
               ("main context read after the PR", lambda r: r["main"]["tail"] or 0), ("duration s", lambda r: r["secs"])]
    for label, f in metrics:
        a = [f(r) for r in out["A"]]; b = [f(r) for r in out["B"]]
        ma, mb, pct, lo, hi = welch(a, b)
        print(f"{label:34s} A {ma:12,.2f} ±{st.stdev(a):11,.2f}   B {mb:12,.2f} ±{st.stdev(b):11,.2f}   change {pct:+6.1f}%  95% [{lo:+.0f}%, {hi:+.0f}%]")
    sa = [r["tail_share"] for r in out["A"] if r["tail_share"] is not None]; sb = [r["tail_share"] for r in out["B"] if r["tail_share"] is not None]
    print(f"\nimplementer share of its own context read after the PR: A {100*st.mean(sa):.0f}% (n={len(sa)}), B {100*st.mean(sb):.0f}% (n={len(sb)})" if sa and sb else "\ntail share: not computable")
    json.dump(out, open("/tmp/analysis.json", "w"), indent=1, default=str)
