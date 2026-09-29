---
schemaVersion: 2
id: 0052-feat-dashboard-autoriser-des-hotes-supplementair
title: "feat(dashboard): autoriser des hôtes supplémentaires pour dashboard --serve"
label: feature
status: done
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Depuis la PR #85 (ticket 0041), `dashboard --serve` refuse (403) toute requête dont l'en-tête Host n'est pas 127.0.0.1, localhost, [::1] ou la valeur de `--host`, avec le port. Lancé avec `--host 0.0.0.0` (ou `::`) pour être consulté depuis une autre machine, il répond donc 403 : le navigateur envoie l'IP ou le nom réel de la machine. Finding non bloquant de bug-hunter sur la PR #85. Deux autres points non bloquants de la même passe : Host sans port sur le port 80, et casse de `--host` (corrigé dans la PR).

## Critères d'acceptation
- Option `--allow-host <nom[:port]>` répétable (et/ou clé de config `project.dashboard.allowedHosts`) ajoutée à la liste des hôtes acceptés.
- Avec `--host 0.0.0.0` ou `::` sans `--allow-host`, le serveur affiche au démarrage un avertissement expliquant que seules les requêtes locales passeront et comment autoriser un hôte.
- Un Host sans port est accepté quand le serveur écoute sur le port par défaut du schéma (80).
- La protection contre le DNS rebinding reste : aucun joker, aucune acceptation implicite de toutes les IP.
- Tests pour chaque cas ; ADR 0017 complété si la politique de confiance change.

## Plan
1. src/dashboard/serve.ts : liste d'hôtes additionnels, port par défaut, avertissement.
2. src/cli.ts : option `--allow-host` et aide.
3. tests/dashboard/serve.test.ts.

## Hors périmètre
Authentification du dashboard.

### 2026-09-29 — implementer: PR opened

```progress-journal
step: step 7: PR opened
worktree: ../worktrees/0052
branch: feat-dashboard-allow-host/0052
base: main
commit: db0f1ef9ad7bb8812d7ebc7105a69dc727066c46
checks: bun run check: pass; bun test (full suite): pass
pr: https://github.com/woueziou/liteCodeAgent/pull/97
```

### 2026-09-29 — implementer: reviewer + bug-hunter approve, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/97 (branch `feat-dashboard-allow-host/0052`, final commit `7271ded`).

`reviewer`: `VERDICT: approve`, no findings, all acceptance criteria checked against this
ticket file and confirmed satisfied.

`bug-hunter` first pass (commit db0f1ef): `HUNT: complete`, no blocking findings. Five
non-blocking findings: (1) an unbracketed IPv6 `--allow-host` entry mis-split at its last
colon, (2) `WILDCARD_BIND_HOSTS` missed some all-zeros IPv6 spellings, (3) `repeatedArg`
can take a following flag as its value (deferred), (4) the ADR's port-80 wording didn't
match the code's actual per-entry rule, (5) the wildcard-rejection message always blamed
`--allow-host` even when the wildcard came from config, (6, hardening) nothing logs the
effective allow-list at startup (deferred).

Fixed in this run, same PR, before moving off `In Progress`: (1), (2), (4), (5) — see commit
`7271ded`. Deferred to a new ticket via triage (non-blocking, out of this ticket's scope):
`repeatedArg` treating a following flag as an `--allow-host` value, `isWildcardBindHost`
still missing `--host 0` / `--host ::ffff:0.0.0.0`, and logging the effective allow-list at
startup for auditability.

`bug-hunter` re-hunt (commit 7271ded): `HUNT: complete`, confirmed fixes (1), (2), (4), (5)
by re-running the same probes; one residual non-blocking finding — `isWildcardBindHost`
still doesn't recognize `--host 0` or `--host ::ffff:0.0.0.0` as wildcard binds (missing
warning only; the Host-header allow-list itself still rejects those requests, so this can
only cause over-refusal, never over-acceptance). No blocking findings.

All three verdicts (reviewer, bug-hunter first pass, bug-hunter re-hunt) posted verbatim on
the PR. CI (`GitGuardian Security Checks`, `test`) green, PR mergeable/clean. Moved
`In Progress` → `Ready to Merge`. Worktree `../worktrees/0052` removed.

Follow-up (not filed as a ticket by this run — flag to `dispatcher`/`triage` if wanted):
`repeatedArg`'s flag-as-value gap, `isWildcardBindHost`'s remaining spellings, and startup
allow-list logging, all non-blocking hardening items from the two bug-hunter passes above.
