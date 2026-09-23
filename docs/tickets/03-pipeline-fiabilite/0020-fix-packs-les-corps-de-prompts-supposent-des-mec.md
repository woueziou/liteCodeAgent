---
schemaVersion: 2
id: 0020-fix-packs-les-corps-de-prompts-supposent-des-mec
title: fix(packs): les corps de prompts supposent des mécanismes Claude Code sur les cinq cibles d'installation
label: bug
status: done
priority: medium
size: large
assignedAgent: human
dueDate: 
---

## Problème

`src/config.ts:241` déclare cinq cibles d'installation : `claude-code`, `codex`, `pi`, `opencode`, `kilo-code`. `src/install.ts` adapte le **frontmatter** et les **répertoires** par cible (`renderCodexAgent`, `renderOpenCodeAgent`, `renderKiloAgent`, `SKILL_ROOTS`, `.pi` sans définitions d'agents natives).

Mais les **corps de prompts** ne sont pas adaptés : `packs/core/agents/*.md` est rendu à l'identique vers les cinq cibles. Or plusieurs de ces corps prescrivent des mécanismes propres à Claude Code.

## Occurrences relevées

- `packs/core/agents/implementer.md` — 4 occurrences de `subagent_type` / de l'outil `Agent`
- `packs/core/agents/reviewer.md` — 1 occurrence, plus l'invocation de la skill `code-review` « via `Skill` »
- `packs/core/agents/triage.md` — 1 occurrence

L'outil `Agent` (avec son paramètre `subagent_type`) et l'outil `Skill` sont des concepts Claude Code. Sur `codex`, `pi`, `opencode` et `kilo-code`, ces instructions désignent des mécanismes qui n'existent pas.

Conséquence structurelle : tout le pipeline repose sur la délégation à des sous-agents (`implementer` invoque `reviewer`, `orchestrator` invoque `classifier`/`panel-selector`/`debate-angle`/`synthesizer`, `implementer` escalade vers `triage`). Si la délégation n'a pas d'équivalent sur une cible, ce n'est pas une instruction morte isolée — c'est le flux entier qui n'a pas de chemin d'exécution.

## Lien avec le ticket 0019

Le ticket 0019 traite le cas particulier de la skill `code-review`, qui n'appartient pas au pack (`packs/core/skills/` ne contient que `agent-attribution`, `chained-implementation`, `critique-expert`, `github-project-sync`, `idea-to-planned`, `security-expert`) et dont l'absence plafonne mécaniquement tout verdict de `reviewer`.

Ce ticket-ci est le cas général dont 0019 est une instance. Les deux peuvent être traités séparément, mais la solution retenue ici devrait englober celle de 0019 — décider laquelle mène l'autre fait partie du travail.

## À trancher (ne pas pré-décider)

- Quel est le contrat minimal qu'une cible doit offrir pour que le pack `core` ait un sens ? Délégation à des sous-agents, invocation de skills, exécution d'outils — lesquels sont indispensables, lesquels sont optionnels ?
- Les corps de prompts doivent-ils devenir conditionnels par cible (une variable de template exposant la cible courante, sur le modèle de `{{#if project.language}}`), ou faut-il des variantes de fichiers par cible, ou un pack par famille de cible ?
- Que fait un agent sur une cible sans délégation : exécute-t-il la séquence lui-même en ligne (ce que `install.ts` fait déjà pour Codex — « Delegate to the installed `orchestrator` Codex subagent if available; otherwise follow its sequence directly »), ou refuse-t-il d'agir ?
- Le précédent Codex ci-dessus est-il le patron à généraliser, ou un contournement ponctuel ?
- Faut-il un test qui échoue quand un corps de prompt introduit une chaîne propre à une cible sans garde ? (Précédent : `tests/agents-sync-only-gh.test.ts` scanne déjà les prompts par sous-chaîne, et `tests/packs.test.ts` interdit les littéraux propres au projet.)

## Vérification faite

Les chiffres ci-dessus proviennent d'un `grep` réel sur `packs/core/agents/*.md` et d'une lecture de `src/install.ts` (lignes ~200-215 et ~340-355) et `src/config.ts` (lignes ~223-270) le 21/09/2026, sur `main`. Ce ne sont pas des estimations.

---

generated_by: tracker

## Design retenu (choix humain, 2026-09-23) — ADR 0014

- Contrat minimal d'une cible : exécuter des outils et déléguer à un sous-agent en attendant son résultat ; les skills sont optionnelles.
- Les prompts du pack ne nomment plus aucun outil de délégation : `{{> delegate <agent>}}` et `{{> delegation}}`, traduits par cible dans `src/delegation.ts` (`Agent`, `task`, spawn par nom sur Codex, `litecode run` sur Pi). Les remplacements aveugles de `Agent` dans les renderers disparaissent : la mention `Agent:` des commits survit sur toutes les cibles, et les skills sont enfin traduites.
- Sans délégation native, repli sur `litecode run <agent>` (runner intégré, synchrone), jamais sur une exécution en ligne ; sans `Bash` ni runner configuré, l'agent s'arrête et le dit.
- `tests/targets-render.test.ts` rend chaque fichier du pack pour chaque cible et échoue sur toute fuite de vocabulaire d'une autre cible.
