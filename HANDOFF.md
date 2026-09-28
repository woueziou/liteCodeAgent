# Handoff

Paste the block below into a fresh Claude Code session opened on this repo.

---

```
Je travaille sur liteCodeAgent, dans ce repo. Lis d'abord README.md, CLAUDE.md et
CHANGELOG.md, puis src/config.ts et src/install.ts — c'est là que vit l'essentiel des
décisions. Les ADR sont dans docs/decisions/, les tickets dans docs/tickets/.

CONTEXTE
C'est un pipeline multi-agent portable, extrait du repo ts-employee-service où il
vivait en dur dans .claude/. Le but : l'installer dans n'importe quel projet, le
versionner, et le faire tourner dans cinq outils (Claude Code, Codex, Pi, OpenCode,
Kilo Code) ou hors de tout outil via le runner direct (OpenAI, Anthropic, DeepSeek).

Les agents/skills sont des Markdown avec des {{ }} dans packs/core et packs/web.
Ils ne contiennent AUCUN littéral de projet (un test échoue si un nom de repo ou un
chemin fuite dedans). Chaque projet cible a un litecode.config.json qui fournit les
valeurs. `litecode install` fait le rendu vers chaque outil, traqué par un lockfile
qui distingue "tu es en retard" de "tu as édité à la main" — et refuse d'écraser le
second sans --force.

ÉTAT : v1.x publiée sur npm (litecodeagent), CI verte, tsc propre, ~400 tests.
Le pipeline : orchestrator (classifier → panel-selector → debate-angle × N →
synthesizer → planner) → tracker → dispatcher → implementer (worktree + branche par
ticket, PR, reviewer + bug-hunter) → fusion par l'humain. Les tickets sont des
fichiers locaux (ADR 0012, 0015), sans issue GitHub.

L'épic docs/tickets/07-resilience (audit face à GSD, Superpowers, Spec Kit) a ajouté :
- garde de branche : .githooks/pre-commit + `litecode guard-branch` refusent tout
  commit sur la branche par défaut sauf un commit fait uniquement de tickets ;
- `ticket move` : transitions de statut validées ;
- les agents commitent eux-mêmes chaque changement de ticket sur main (jamais de push) ;
- contrat de ticket (Contexte / Critères d'acceptation / Plan / Hors périmètre) et
  marqueur [À CLARIFIER] qui bloque la planification ;
- reviewer vérifie chaque critère avec preuve ; diff en trois points (base...branche) ;
- test d'abord configurable (project.testFirst) ;
- `litecode doctor` (travaux orphelins, fuites dans le checkout principal, ADR en
  attente) et `litecode resume` (journal de progression, ADR 0018) ;
- ADR en attente visibles sur main (section "## ADR à valider : NNNN" du ticket) ;
- `ticket import-board` : import unique de l'ancien board GitHub (ADR 0019) ;
- `dashboard --serve` en lecture seule (ADR 0017).

INVARIANTS À NE PAS CASSER
1. Aucun littéral projet dans packs/ — tests/packs.test.ts le garde.
2. Un {{ }} non résolu est une erreur dure, jamais une chaîne vide.
3. Les packs déclarent `tier: fast|balanced|reasoning`, jamais un nom de modèle.
4. Le fichier ticket local est la seule source de vérité du statut (ADR 0012, 0015).
5. Jamais de commit de code sur main : branche + PR. Seuls les fichiers de ticket y
   sont commités, par les agents, sans push. Pas de trailer Co-Authored-By (CLAUDE.md).
6. Tout ce qui est sous un répertoire d'outil et absent du lockfile appartient au
   projet : jamais lu, réécrit ni supprimé. Un hook git existant n'est jamais remplacé.
7. Le rapport d'un agent est une affirmation : `verify-report` le confronte au repo.

CE QUI RESTE (backlog de 07-resilience, voir `litecode ticket list`)
- 0054 : implementer vérifie la CI de la PR avant readyToMerge (révélé par la PR #93).
- 0040 : les flows créent et remplissent les épics (`ticket new --epic`).
- 0039 : rejouer des sessions enregistrées pour tester les contrats des agents.
- 0044, 0046, 0052, 0053 : suites non bloquantes (titres de section, faux positifs de
  doctor, hôtes du dashboard, lecture des journaux).
- Smoke test réel par provider du runner, dès que des clés API sont disponibles.

Commandes : bun test | bun run check | bun run src/cli.ts <cmd>

Commence par me dire ce sur quoi tu veux que je te lance — ne modifie rien avant.
```

---

## Notes

- The pipeline is installed in this repo too (`.claude/`, `.kilo/`, `.pi/`), rendered from
  `packs/`. After changing a pack template, run `bun run src/cli.ts install --apply` and
  commit the rendered files with it. On a lockfile merge conflict, take `main`'s lockfiles
  and re-run `install --apply --force`.
- Sub-agents may run in the background in Claude Code: a delegation's result can arrive
  as a later notification rather than in the same turn (ticket 0051, `src/delegation.ts`).
- Direct-provider calls have not been smoke-tested against paid APIs in this repo because no
  API key is assumed. The wire formats have deterministic adapter tests.

## Where things live

| Path | What |
| --- | --- |
| `packs/core`, `packs/web` | the agents, skills and git hook, as templates |
| `src/template.ts` | `{{ }}` engine — `#if`/`#each`, `join`/`codelist` filters |
| `src/config.ts` | the config schema; every interpolatable value is declared here |
| `src/install.ts` | render + plan + drift/skill-reference validation + git hook |
| `src/delegation.ts` | per-tool delegation wording injected into agent prompts |
| `src/detect.ts`, `src/init.ts` | repo detection and the setup wizard |
| `src/tickets/` | ticket schema, store, `ticket move`, doctor, migrate, dedupe, board import |
| `src/guard-branch.ts` | the default-branch guard the pre-commit hook calls |
| `src/report/` | `verify-report`, its git/gh probes, and the progress journal parser |
| `src/doctor.ts`, `src/resume.ts` | `litecode doctor` and `litecode resume` |
| `src/dashboard/`, `src/decisions/` | the dashboard (`--build`/`--serve`) and ADR reading, including pending drafts |
| `src/project-upgrade*.ts`, `src/upgrade.ts` | `litecode upgrade` and the kit's self-update |
| `src/runner/` | provider adapters, tool layer, agent catalog, recursive runtime |
| `docs/decisions/` | ADRs |
| `docs/tickets/` | the local ticket buffer, one directory per epic |
| `examples/` | a complete, real, filled-in config to copy from |
| `.claude-plugin/`, `skills/setup`, `bin/litecode` | native Claude Code marketplace/plugin entrypoint |
