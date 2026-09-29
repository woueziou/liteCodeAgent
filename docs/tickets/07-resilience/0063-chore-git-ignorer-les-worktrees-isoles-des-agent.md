---
schemaVersion: 2
id: 0063-chore-git-ignorer-les-worktrees-isoles-des-agent
title: "chore(git): ignorer les worktrees isolés des agents (.claude/worktrees/)"
label: chore
status: planned
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Depuis l'ADR 0020, Claude Code crée le worktree isolé de chaque implémenteur dans le dépôt, sous `.claude/worktrees/agent-<id>/`. Ces dossiers apparaissent comme non suivis dans `git status` du checkout principal, `verify-report` les signale en avertissement (« primary checkout has other uncommitted changes »), et un `git add -A` pourrait les embarquer. Six d'entre eux traînent depuis la vague 2.

## Critères d'acceptation
- `.gitignore` ignore `.claude/worktrees/`.
- `litecode install` n'écrit ni ne supprime rien sous `.claude/worktrees/`, et `verify-report` / `doctor` ne les signalent plus comme modifications du checkout principal.
- La documentation (README, section sur l'isolation ou « Keeping it healthy ») indique comment nettoyer les worktrees d'agents terminés (`git worktree remove` / `git worktree prune`).
- Un test couvre l'absence d'avertissement de `verify-report` pour un chemin sous `.claude/worktrees/`.

## Plan
1. .gitignore.
2. src/report (vérification du checkout principal) : ignorer ce préfixe si nécessaire.
3. README.
4. tests/.

## Hors périmètre
Supprimer automatiquement les worktrees des agents.
