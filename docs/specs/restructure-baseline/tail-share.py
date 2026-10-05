#!/usr/bin/env python3
"""Share of an implementer run's context read that falls after `gh pr create` (ticket 0081, ADR 0027).

Reads Claude Code subagent transcripts under ~/.claude/projects/<this project>/<session>/subagents/
(read-only; transcripts are never copied into the repo). For every subagent whose .meta.json says
`implementer` and that made at least 10 calls, it orders the calls, finds the first call whose Bash
command contains `gh pr create`, and reports the share of the run's "context read" (the sum, over calls,
of input + cache_read + cache_creation tokens) that belongs to the calls after it.

Same definition of context and same exclusions as `litecode token-report --detail`: each assistant
message id counted once (last line wins), synthetic API-error lines ignored.

Usage: python3 docs/specs/restructure-baseline/tail-share.py [projects-dir-name]
"""
import glob, json, os, re, statistics as st, sys

# Claude Code names the folder after the path, with "/" and "_" both turned into "-".
name = sys.argv[1] if len(sys.argv) > 1 else re.sub(r"[/_]", "-", os.getcwd())
base = os.path.expanduser(f"~/.claude/projects/{name}")
rows = []
for meta in glob.glob(base + "/*/subagents/agent-*.meta.json"):
    try:
        m = json.load(open(meta))
    except Exception:
        continue
    if (m.get("agentType") or m.get("type") or "") != "implementer":
        continue
    f = meta.replace(".meta.json", ".jsonl")
    if not os.path.exists(f):
        continue
    calls, order, pr_idx = {}, [], None
    for line in open(f):
        try:
            d = json.loads(line)
        except Exception:
            continue
        msg = d.get("message") or {}
        u = msg.get("usage")
        if d.get("type") != "assistant" or not u:
            continue
        if msg.get("model") == "<synthetic>" or d.get("isApiErrorMessage"):
            continue
        i = msg.get("id") or f"anon{len(order)}"
        ctx = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
        if i not in calls:
            order.append(i)
        calls[i] = ctx
        for c in msg.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and isinstance(c.get("input"), dict):
                if pr_idx is None and re.search(r"gh pr create", c["input"].get("command") or ""):
                    pr_idx = order.index(i)
    if len(order) < 10 or pr_idx is None:
        continue
    total = sum(calls[i] for i in order)
    tail = sum(calls[i] for i in order[pr_idx + 1:])
    rows.append((total, tail / total))

if not rows:
    sys.exit("no implementer run with a PR found under " + base)
shares = [r[1] for r in rows]
print(f"runs with a PR: {len(rows)}")
print(f"share of context read after the PR: mean {100*st.mean(shares):.1f}%  median {100*st.median(shares):.1f}%  "
      f"min {100*min(shares):.1f}%  max {100*max(shares):.1f}%")
print(f"pooled over all runs: {100*sum(t*s for t, s in rows)/sum(t for t, _ in rows):.1f}%")
