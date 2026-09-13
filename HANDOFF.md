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

ÉTAT : phase 1 terminée, v0.2.0, 30 tests verts, tsc propre, poussé sur
github.com/woueziou/liteCodeAgent (privé).
Fait : les 11 agents + 13 skills en packs, le moteur de template, install avec
lockfile et validation des références de skills, board init/doctor (GitHub Projects),
init assisté avec détection du repo, install.sh, litecode upgrade.

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
- Phase 2 : manifeste plugin (.claude-plugin/) pour /plugin install natif.
- Phase 3 : le runner agnostique — boucle d'agent, couche d'outils, et surtout
  l'outil `Agent` pour que orchestrator puisse spawner ses sous-agents hors
  Claude Code. C'est le point dur.
- Le chemin INTERACTIF de `litecode init` n'a jamais été exécuté (pas de TTY là
  où il a été écrit). La détection et l'écriture du fichier sont testées, pas
  l'enchaînement réel des prompts. À valider en premier.

Commandes : bun test | bun x tsc --noEmit | bun run src/cli.ts <cmd>

Commence par me dire ce sur quoi tu veux que je te lance — ne modifie rien avant.
```

---

## Notes

- The `orchestrator` pipeline is **not** installed in this repo — it lives in
  `ts-employee-service`. There is no hook reminder here and no reason to route work
  through it; work directly.
- Validate the **interactive** `litecode init` first, on a throwaway directory. It is the
  one path never executed (no TTY where it was written), and the first thing you'll use on
  a real project.

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
