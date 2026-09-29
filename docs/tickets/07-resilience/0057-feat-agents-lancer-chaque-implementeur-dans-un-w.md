---
schemaVersion: 2
id: 0057-feat-agents-lancer-chaque-implementeur-dans-un-w
title: "feat(agents): lancer chaque implémenteur dans un worktree isolé"
label: feature
status: inProgress
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Malgré les consignes (ticket 0048 : chemin absolu du worktree, vérification du checkout principal en fin de run), les implémenteurs écrivent encore d'abord dans le checkout principal : 0050 (deux fois), 0052, 0055, 0054 — les quatre agents de la vague du 2026-09-29. Chacun s'en est aperçu et a nettoyé avec `git restore`/`git checkout --`, ce qui effacerait aussi tout travail non commité du propriétaire dans ces fichiers. Cause probable : l'agent démarre dans le checkout principal et des Edit/Write partent de là. L'outil Agent de Claude Code sait lancer un agent dans son propre worktree git (`isolation: "worktree"`) ; les autres cibles ont peut-être un équivalent.

## Critères d'acceptation
- Pour les cibles qui le permettent (au moins claude-code), la délégation vers implementer demande l'isolation par worktree (texte de `src/delegation.ts` / skill chained-implementation / consignes de l'appelant) ; implementer utilise ce worktree comme son worktree de ticket au lieu d'en créer un second.
- Les écritures de ticket (statut, notes), qui doivent se faire dans le checkout principal sur la branche par défaut, passent par une commande qui prend le chemin du checkout principal explicitement (ex. `litecode ticket move --root <main-checkout>` et une commande de note), jamais par Edit/Write relatifs.
- implementer ne nettoie jamais le checkout principal avec `git restore`/`git checkout --` : s'il détecte une fuite, il compare avec son worktree, et seulement si c'est identique octet pour octet il retire sa copie ; sinon il s'arrête et le signale.
- Les cibles sans isolation gardent le fonctionnement actuel, avec la vérification de fin de run.
- Tests : rendu de la délégation par cible ; commande de note/move avec racine explicite ; test de contrat sur implementer.md.

## Plan
1. src/delegation.ts : consigne d'isolation par cible.
2. src/cli.ts / src/tickets : `--root` pour ticket move et une commande `ticket note`.
3. packs/core/agents/implementer.md, skills/chained-implementation : usage ; nettoyage sûr.
4. tests/ + `install --apply`.

## Hors périmètre
Sandbox des outils d'écriture (non disponible dans les harnesses).

### 2026-09-29 — implementer: progress journal

```progress-journal
step: step 3: worktree/branch created
worktree: ../worktrees/0057
branch: feat-implementer-worktree-isolation/0057
base: origin/main
commit: none
checks: not yet run
```

## ADR à valider : 0020

Draft awaiting approval; not committed (file: /Users/woueziou/works/personal_projects/worktrees/0057/docs/decisions/0020-implementer-in-isolated-worktree-with-explicit-ticket-root.md).


# 0020. Implementer in an isolated worktree, ticket writes rooted explicitly

Status: proposed
Date: 2026-09-29

## Context

Despite ADR-less prose rules (ticket 0048), implementers kept writing first into the primary checkout (tickets 0050, 0052, 0054, 0055). Claude Code's `Agent` tool can start a sub-agent in its own git worktree (`isolation: "worktree"`), which removes the primary checkout from the agent's reach. But then the agent's `cwd` is that worktree from its very first turn, so any relative ticket write (status, notes) would land in the worktree instead of the primary checkout on the default branch, where `dispatcher`, `triage` and the dashboard read it.

## Decisions

1. **Delegation asks for isolation where the target has it.** `src/delegation.ts` gains a `{{> delegateImplementerIsolation}}` helper, used by the `chained-implementation` skill. Only `claude-code` documents a per-call option (`isolation: "worktree"`); `opencode`, `kilo-code`, `codex`, `pi` and the API `runner` have no documented equivalent, so they keep today's behavior (implementer runs `git worktree add` itself) plus the end-of-run leak check. No capability is invented for them.
2. **The provided worktree becomes the ticket worktree.** implementer does not run `git worktree add` a second time; it runs `git checkout -b <descriptive-name>/<NNNN>` inside the provided worktree (a new branch off the tip it already has; no rename of an existing branch).
3. **The caller states the primary checkout's absolute path in the prompt.** implementer cannot infer it from its `cwd`. If it was isolated but not told the path, that is a blocker for `triage`.
4. **Ticket writes go through the CLI with the existing global `--project <primary-checkout>` flag**, not a new `--root` flag: `ticket move --project <path> ...` and a new `ticket note <id> --file <path> --project <path>` (append-only). `--project` is stripped from argv before positional parsing so it works anywhere on the line. Ticket commits use `git -C <primary-checkout>`. Edit/Write on ticket files is no longer used.
5. **Leak cleanup is unchanged**: compare byte for byte with the worktree copy; discard only if identical, otherwise stop and report.

## Consequences

- A second flag with the same meaning as `--project` is avoided; the acceptance criterion "explicit main-checkout path" is met by the existing flag.
- Correctness of isolation relies on the caller passing the path (prose contract, tested on the pack text only).
- Non-claude-code targets gain nothing and lose nothing.

```resume-manifest
worktree: ../worktrees/0057
branch: feat-implementer-worktree-isolation/0057
commit: 4efb45e
adr_path: docs/decisions/0020-implementer-in-isolated-worktree-with-explicit-ticket-root.md
board_status: In Progress
checks_passed: bun run check: pass; bun test: pass
adr_posted: true
```
