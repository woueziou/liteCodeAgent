# Handoff

Paste the block below into a fresh Claude Code session opened on this repo.

---

```
Je travaille sur liteCodeAgent, dans ce repo. Lis d'abord README.md et CHANGELOG.md,
puis src/config.ts et src/install.ts — c'est là que vit l'essentiel des décisions.

CONTEXTE
C'est un pipeline multi-agent portable, extrait du repo ts-employee-service où il
vivait en dur dans .claude/. Le but : l'installer dans n'importe quel projet, le
versionner, et à terme le faire tourner hors Claude Code (OpenAI, DeepSeek…).

Les agents/skills sont des Markdown avec des {{ }} dans packs/core et packs/web.
Ils ne contiennent AUCUN littéral de projet (un test échoue si un nom de repo,
un chemin ou un id de board fuite dedans). Chaque projet cible a un
litecode.config.json qui fournit les valeurs. `litecode install` fait le rendu vers
.claude/, traqué par un lockfile qui distingue "tu es en retard" de "tu as édité à
la main" — et refuse d'écraser le second sans --force.

ÉTAT : phases 1 à 4 terminées, v0.5.0, 41 tests verts, tsc propre.
Fait : les 11 agents + 13 skills en packs, le moteur de template, install avec
lockfile et validation des références de skills, board init/doctor (GitHub Projects),
init assisté avec détection du repo, install.sh, litecode upgrade, et installation
native Claude Code via le marketplace embarqué (`litecode-agent@litecode`). Le runner
direct supporte OpenAI Responses, Anthropic Messages et DeepSeek Chat Completions, avec
une couche d'outils locale et un outil `Agent` récursif/synchrone. Les rapports structurés
agrègent tokens et coûts par agent/modèle; un budget configurable arrête les runs trop chers.

INVARIANTS À NE PAS CASSER
1. Aucun littéral projet dans packs/ — tests/packs.test.ts le garde.
2. Un {{ }} non résolu est une erreur dure, jamais une chaîne vide : un prompt
   troué est pire qu'un build qui casse.
3. Les packs déclarent `tier: fast|balanced|reasoning`, jamais un nom de modèle.
   C'est ce qui rendra le runner multi-provider possible.
4. board init n'ajoute JAMAIS une option à un single-select existant. L'input
   GraphQL ne porte pas d'id d'option, donc toute mise à jour régénère tous les
   ids et vide le Status de chaque item du board. C'est déjà arrivé en vrai.
   La commande le signale comme blocker à corriger dans l'UI web.
5. Tout ce qui est sous .claude/ et absent du lockfile appartient au projet :
   jamais lu, réécrit ni supprimé.

CE QUI RESTE
- Faire un smoke test réel par provider dès que les clés API correspondantes sont
  disponibles. Les adaptateurs sont testés avec transports déterministes, sans appel facturé.
- Choisir entre le streaming des sorties, un sandbox explicite pour Bash, ou une API de
  checkpoints/reprise des longues exécutions.

Le chemin interactif de `litecode init` a été validé en PTY. Cette validation a
révélé puis corrigé une perte de stdin après la première réponse. Le rendu d'un
projet sans ADR a aussi été corrigé.

Commandes : bun test | bun x tsc --noEmit | bun run src/cli.ts <cmd>

Commence par me dire ce sur quoi tu veux que je te lance — ne modifie rien avant.
```

---

## Notes

- The `orchestrator` pipeline is **not** installed in this repo — it lives in
  `ts-employee-service`. There is no hook reminder here and no reason to route work
  through it; work directly.
- Direct-provider calls have not been smoke-tested against paid APIs in this repo because no API
  key is assumed. The wire formats have deterministic adapter tests.

## Where things live

| Path | What |
| --- | --- |
| `packs/core`, `packs/web` | the agents and skills, as templates |
| `src/template.ts` | `{{ }}` engine — `#if`/`#each`, `join`/`codelist` filters |
| `src/config.ts` | the config schema; every interpolatable value is declared here |
| `src/install.ts` | render + plan + drift/skill-reference validation |
| `src/detect.ts`, `src/init.ts` | repo detection and the setup wizard |
| `src/board/` | GitHub Project provisioning (`init`) and drift checking (`doctor`) |
| `examples/` | a complete, real, filled-in config to copy from |
| `.claude-plugin/`, `skills/setup`, `bin/litecode` | native Claude Code marketplace/plugin entrypoint |
| `src/runner/` | provider adapters, tool layer, agent catalog, recursive runtime |
