---
schemaVersion: 1
id: 0005-feat-init-demander-fournisseur-et-modeles-par-pa
title: feat(init): demander fournisseur et modèles par palier selon la cible
label: feature
status: backlog
priority: medium
size: medium
assignedAgent: implementer
dueDate: 
issue: 19
synced: true
syncedAt: 2026-09-18T16:52:30.820Z
---

## Le vrai défaut, plus large que le littéral codé en dur

`init` remplit aujourd'hui un champ propre à Claude pour tout le monde, et laisse vide le seul champ dont un utilisateur sans Claude a réellement besoin.

Faits vérifiés dans le code :

- `config.tiers` n'a **qu'un seul site de lecture** dans tout le repo : `src/install.ts:52-53` (`renderClaudeAgent`), qui écrit le frontmatter `model:` **pour la cible claude-code uniquement**.
- Codex mappe palier → effort de raisonnement (`src/install.ts:66`) ; OpenCode (`src/install.ts:90`) et Kilo (`src/install.ts:119`) n'émettent **aucun champ de modèle** ; Pi n'émet aucun fichier d'agent (`src/install.ts:275-276`) et délègue au runner direct-API. Donc pour 4 cibles sur 5, `tiers` est de la config morte.
- Le `litecode.config.json` de ce repo en est la preuve : `target: "kilo-code"`, et pourtant `tiers` contient toujours `{haiku, sonnet, opus}`, jamais lu. `README.md:532-534` documente déjà ce comportement.
- Le runner utilise une carte **séparée** : `src/runner/runtime.ts:270` — `const model = config.runner.models[agent.tier];`. `runner` est optionnel (`src/config.ts:202`).

**Conséquence :** `init` remplit `tiers` seulement si `claude-code` fait partie des cibles sélectionnées, et `runner` seulement si l'utilisateur veut l'exécution direct-API ou le suivi de coût. Les quatre combinaisons (tiers seul / runner seul / les deux / aucun) sont légitimes et doivent être produites correctement.

## Périmètre

`litecode init` demande le fournisseur et les modèles par palier, avec des préréglages par fournisseur. **Hors périmètre :** élargir l'énumération `runner.provider` au-delà de `openai`, `anthropic`, `deepseek`. Mistral/Groq/OpenRouter/Ollama sont une suite possible, à consigner comme telle dans l'ADR, pas à implémenter.

## Décision du propriétaire sur le mode non interactif

`init --yes` (ou l'absence de terminal) écrit des **placeholders TODO** dans `tiers` au lieu de choisir Claude en silence, et n'émet **aucune** clé `runner`. C'est un changement de comportement assumé : aujourd'hui le mode non interactif passe tout seul avec haiku/sonnet/opus. `loadConfig` refuse déjà une config contenant TODO (`src/config.ts:255-266`), donc l'utilisateur est forcé de trancher avant d'installer. L'idiome existe déjà dans `src/init.ts:339-340`.

## Plan d'implémentation (7 étapes)

1. `src/init.ts` — ajouter un `PROVIDER_PRESETS` au niveau module, clé `openai|anthropic|deepseek`, donnant pour chacun des ids de modèles suggérés par palier **et** les entrées `pricing` correspondantes (forme de `ModelPricingSchema`, `src/config.ts:130-135`). Les commenter explicitement comme *défauts suggérés, pas vérité maintenue*.
2. `src/init.ts` — après la sélection des cibles (`src/init.ts:161-175`, qui s'exécute déjà avant le littéral de config aux lignes 341-370) et avant ce littéral, ajouter deux sections **indépendantes** :
   - **Paliers** (`heading("Model tiers")`), conditionné à `interactive && targets.includes("claude-code")` : par palier, un `select` de préréglage fournisseur (ou « custom »), puis un `ask` de l'id de modèle avec le préréglage en valeur de repli pré-remplie — du texte libre guidé, pas une énumération verrouillée.
   - **Runner** (`heading("Direct-API runner")`), conditionné à un `confirm` dont le défaut est `targets.includes("pi")` : `select` du fournisseur (openai/anthropic/deepseek uniquement), `ask` d'un id de modèle par palier (préréglage en repli), `confirm` du suivi de coût → si oui, `ask` du budget et amorçage automatique de `pricing` pour chaque modèle choisi (exigé par le `superRefine` de `src/config.ts:168-185`, vérifié par `tests/runner.test.ts:112`). Puis un `confirm` optionnel de passerelle → `ask` de `baseUrl` et `apiKeyEnv`, omis si vides pour que `DEFAULT_KEY_ENV` (`src/runner/index.ts:7-11`) et les `baseUrl` par défaut des classes de fournisseur (`src/runner/providers.ts:231/342/392`) s'appliquent encore.
3. `src/init.ts:346` — supprimer le `tiers: {fast:"haiku", balanced:"sonnet", reasoning:"opus"}` codé en dur, y substituer les `tiers` calculés, et ajouter `...(runner ? { runner } : {})` sur le modèle de l'idiome `...(web ? { web } : {})` déjà présent à `src/init.ts:368`.
4. Chemin non interactif (`src/init.ts:159`, `--yes` ou absence de TTY) : émettre des placeholders TODO pour les paliers et **aucune** clé `runner`, comme décidé ci-dessus. Optionnellement, faire passer des drapeaux explicites `--provider`/`--models` par `InitOptions` (`src/init.ts:152`) et les deux sites d'appel du CLI (`src/cli.ts:82-87` pour `setup`, plus `init`), qui acceptent déjà `--targets`.
5. `tests/init.test.ts` — couvrir : claude-code sélectionné ou non ; runner refusé ou accepté ; `maxCostUsd` → `pricing` peuplé pour chaque modèle ; champs de passerelle ; les quatre combinaisons qui parsent via `ConfigSchema.safeParse` ; et un garde-fou de régression sur `--yes`. **À savoir :** aujourd'hui `tests/init.test.ts` n'appelle jamais `init` qu'avec `yes: true` (lignes 65, 91, 92, 98), donc **la branche interactive n'a aucune couverture** — et c'est exactement là qu'atterrit tout le nouveau branchement. Une condition fausse y échouerait *silencieusement* avec de mauvais défauts plutôt que de lever. `HANDOFF.md:54-57` documente la pratique établie de validation manuelle en PTY pour cette branche.
6. `src/config.ts` — **aucun changement de schéma nécessaire** : `tiers` a déjà un défaut (`src/config.ts:196`) et `runner` est déjà optionnel (`src/config.ts:202`), donc les configs existantes continuent de parser. La compatibilité ascendante n'est pas en jeu ici.
7. `README.md:532-534` et l'exemple de runner (lignes 418-449) — documenter le nouveau flux de questions, en préservant la position assumée « pas de table de prix » (`README.md:445-449`).

## Risque à surveiller à l'implémentation

Passer le mode non interactif à des paliers TODO signifie que tout test ou flux appelant `init({yes:true})` puis `loadConfig` heurtera désormais le garde-fou TODO. `tests/config.test.ts:20-30` (`readyConfig`) corrige déjà `repo`/`checkCommand`/`board.owner` après `init` pour cette raison exacte, et devra aussi corriger `tiers`.

## Correction apportée aux prémisses initiales

L'invariant « les packs ne nomment jamais un modèle » est **déjà testé** : `tests/packs.test.ts:33-42` vérifie que `data.model` est indéfini et que `data.tier` correspond à `^(fast|balanced|reasoning)$` pour tout `packs/**/agents/*.md`. Aucune assertion nouvelle n'est nécessaire, il suffit de la garder verte.

## ADR — livrable gated

`docs/decisions/0005-init-model-provider-selection.md`

**Important : utiliser le numéro 0005, pas 0003.** Deux autres plans élaborés en parallèle ont chacun calculé « prochain numéro libre » sans se voir : 0003 est réservé au ticket « langue de travail », 0004 au ticket « dossier `.litecodeagent/` ».

L'implémenteur écrit l'ADR, le poste en commentaire sur l'issue, puis s'arrête sur `STATUS: adr-pending-approval` sans commiter.

Décisions à trancher dans l'ADR :
- L'obsolescence des préréglages : ids maintenus servant de défauts pré-remplis avec surcharge en texte libre, ou texte libre guidé pur — et où vit cette liste (constante dans `src/init.ts` ou `src/runner/presets.ts` dédié) pour qu'elle ne pourrisse pas en silence. À justifier face au refus explicite du repo de livrer une table de prix (`README.md:445-449`) et à son usage d'ids d'exemple comme `"fast-model-id"`.
- Questions de paliers et de runner totalement indépendantes, ou choix de fournisseur du runner pré-suggérant celui des paliers pour éviter des questions redondantes.
- Quand `maxCostUsd` est souhaité mais que l'utilisateur a saisi un modèle absent de la table de prix du préréglage : bloquer, demander les prix au jeton à la main, ou omettre `maxCostUsd`. À justifier face au `superRefine`.
- `baseUrl`/`apiKeyEnv` proposés inconditionnellement avec tout runner, ou derrière un `confirm` de passerelle.
- Consigner explicitement le support de fournisseurs supplémentaires (Mistral/Groq/OpenRouter/Ollama) comme suite hors périmètre, plutôt que de le laisser silencieusement absent.

---

generated_by: tracker
task: github-project-sync
