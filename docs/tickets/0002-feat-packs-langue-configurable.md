---
schemaVersion: 1
id: 0002-feat-packs-langue-configurable
title: feat(packs): langue de travail configurable pour la prose des agents
label: feature
status: inProgress
priority: medium
size: large
assignedAgent: implementer
dueDate: 
issue: 16
synced: true
syncedAt: 2026-09-21T15:35:35.144Z
---

Une clé `project.language` optionnelle et en texte libre dans `litecode.config.json` (ex. `"French"`, `"Brazilian Portuguese"`) est interpolée dans les prompts de pack, pour que la prose des agents, les contenus GitHub qu'ils écrivent et les ADR suivent la langue choisie.

## Périmètre arrêté par le propriétaire (non rediscutable)

Suivent la langue configurée :
- les réponses et rapports conversationnels des agents ;
- les contenus GitHub écrits par les agents : titres et corps d'issues, descriptions de PR, commentaires ;
- les ADR sous `docs/decisions/` et les docs générés.

**Hors périmètre** : les chaînes de sortie du CLI `litecode` (`src/cli.ts`). Pas d'i18n du code TypeScript dans ce lot.

La langue est déclarée en **texte libre**, pas en code BCP-47 validé contre une liste, et il n'y a **aucune détection automatique**.

## Décision de conception centrale

Les deux angles du débat ont rendu `blocking`, et tous deux avaient raison sur un point différent :

- `.optional()` + interpolation nue `{{ project.language }}` → `renderLeaf` (`src/template.ts:124-126`) lève `TemplateError` sur un chemin indéfini, et `requiredPaths()`/`referencedPaths()` (`src/install.ts:243-247`) parcourt les sources brutes du pack : `litecode install` casserait pour **toute** config existante.
- `.default("English")` + interpolation nue → injecte silencieusement une instruction nouvelle dans les prompts de **tous** les projets existants à l'upgrade : un changement de comportement déguisé en défaut.

**Résolution :** `language: z.string().optional()` **sans `.default()`**, et **chaque** site d'injection encadré par `{{#if project.language}}…{{/if}}`. Le `{{#if}}` évalue la véracité au lieu de lever, et le contexte de rendu est littéralement `{ project: config.project }` (`src/install.ts:251`) — donc clé absente ⇒ rendu **identique octet pour octet** à aujourd'hui. C'est la seule propriété de cette feature vérifiable par une machine : on ne peut pas assert sur la langue d'une sortie de LLM.

## Frontière prose / identifiant (principal risque de casse)

**Restent toujours en anglais :**
- toutes les clés sentinelles : `STATUS:`, `PLANNED:`, `CONFLICTS:`, `SKIPPED:`, `ADR:`, `ADR_DECISIONS:`, `BLOCKER:`, `REENTRY:`, `ANGLE:`, `VERDICT:`, `SIZE:`, `ROUTE:`, `RESOLUTION:`, `NEXT_STATUS:`, `CHECK_OUTPUT:` ;
- toutes les valeurs d'énumération : `approve|approve-with-notes|changes-requested`, `pr-opened-for-review|adr-pending-approval|…`, `trivial|small|medium|large`, `blocking|non-blocking|no-concern` ;
- les préfixes Conventional Commits (`feat:`, `fix:`, `chore:`…), consommés par semantic-release ;
- les labels et statuts du board, consommés par `github-project-sync` et `src/board/spec.ts`.

**Trois pièges concrets repérés, à ne pas contredire :**
- `triage.md:30` — `NEXT_STATUS: <Planned | Blocked>` encode des labels de board comme valeurs d'énumération ;
- `reviewer.md:57` — `CHECK_OUTPUT:` transporte de la sortie d'outil verbatim ;
- `sync.md:32` — impose de rapporter « verbatim from the command's own output ».

Une consigne « traduis tout » contredirait les trois.

**Sûr par construction :** `src/board/spec.ts` (`PRIORITY_OPTIONS`, `SIZE_OPTIONS`, `REQUIRED_LABELS`, `STATUS_ROLES[].label`) est du TypeScript que le moteur de template ne touche jamais, et les statuts sont déjà adressés par **rôle**, pas par label. Le risque résiduel est uniquement qu'un agent écrive de lui-même un label traduit dans un appel `gh` ou un préfixe de commit — d'où la clause de réserve à écrire dans chaque prompt.

**Précédent utile :** `orchestrator.md:28` interpole déjà `{{ project.adrDir }}` dans la ligne sentinelle `ADR:` — mais c'est un chemin, pas de la prose libre. La règle : du texte libre non validé (pouvant contenir des deux-points ou des retours à la ligne) ne doit jamais entrer dans une ligne parsée ligne à ligne.

## Plan d'implémentation (13 étapes)

1. `src/config.ts` — ajouter `language: z.string().optional()` à `ProjectSchema` près de `board`/`tickets` (lignes 96-99), avec un commentaire calqué sur le précédent `tickets` (lignes 44-54) expliquant pourquoi il faut rester `.optional()` sans `.default()`.
2. `tests/config.test.ts` — reproduire le test « une config antérieure au tampon de tickets parse toujours » pour une clé `language` absente ; ajouter un cas vérifiant qu'un texte libre arbitraire (`"Brazilian Portuguese"`) est accepté sans validation.
3. `src/init.ts` — dans la section « Project » (~lignes 212-230), ajouter un `ask(...)` optionnel avec `required: false` ; dans le littéral de config (~lignes 341-370), utiliser `...(language ? { language } : {})`, le même spread conditionnel que celui déjà employé pour `web`. `ask()` rend `""` quand on saute la question, ce qui correspond proprement à omettre la clé. **Attention :** il n'existe aucun champ `language` dans `Detected` (`src/detect.ts`) — pas de valeur détectée par défaut, la détection automatique est hors périmètre.
4. `tests/install.test.ts` — `init` écrit la clé quand elle est renseignée, l'omet quand elle est sautée ; garder « un rendu complet ne produit aucune syntaxe de template non résolue » vert sur une fixture avec et une sans `language`.
5. `packs/core/agents/{implementer,orchestrator,reviewer,debate-angle,triage,classifier,synthesizer}.md` — insérer le bloc encadré autour des **paragraphes de prose uniquement**, plus une clause de réserve près de chaque section de format de sortie : « traduis la prose seulement ; les clés, valeurs d'énumération et labels restent en anglais ». `implementer.md` reçoit une variante étendue nommant les préfixes Conventional Commits, les constantes de label de `src/board/spec.ts`, et les valeurs des drapeaux `litecode ticket new --label/--priority/--size`.
6. `packs/core/skills/github-project-sync/SKILL.md` — même bloc encadré et même clause de réserve pour les titres/corps d'issues, descriptions de PR et commentaires ; noter explicitement que `CHECK_OUTPUT:` et le passthrough de sortie d'outil ne sont jamais traduits.
7. `tests/packs.test.ts` — étendre le test « aucun fichier de pack ne code en dur un littéral de projet » pour vérifier (a) que chaque occurrence de `project.language` dans un fichier de pack est bien à l'intérieur d'une paire `{{#if project.language}}…{{/if}}`, et (b) qu'aucune ligne sentinelle structurée ne contient d'interpolation `{{ project.language }}`.
8. `tests/template.test.ts` — rendu identique octet pour octet avec la clé absente (ce qui exerce `stripStandaloneTags`, `src/template.ts:143`) ; substitution correcte quand elle est présente.
9. `packs/core/pack.json` — bump `0.3.0` → `0.4.0`.
10. `tests/install.test.ts` — mettre à jour l'assertion de la table de versions (~ligne 50) de `{ core: "0.3.0", web: "0.1.0" }` vers `{ core: "0.4.0", … }`.
11. `examples/ts-employee-service.litecode.config.json` — laisser délibérément `language` non renseigné, pour que la fixture continue d'exercer le chemin « clé absente » ; consigner ce choix dans la description de PR.
12. Passe de `grep` sur les littéraux de forme `Project` construits à la main qui contournent `ProjectSchema.parse` (`tests/`, `src/init.ts`) : ajouter un champ optionnel ne devrait en casser aucun, ne corriger que ce que `bun run check` signale.
13. La description de PR et les notes de version doivent signaler que le hash rendu de chaque fichier de pack touché change — donc **toute install existante verra de la dérive** ou une réécriture silencieuse au prochain `litecode install`. C'est inhérent aux packs templatés, ce n'est pas du bruit sans rapport.

Note : un test du repo échoue si un littéral propre au projet fuite dans `packs/` — les prompts de pack ne doivent utiliser que des placeholders `{{ }}`.

## ADR — livrable gated

`docs/decisions/0003-optional-project-language-for-agent-prose.md` (0001 et 0002 existent, 0003 est le prochain numéro libre).

L'implémenteur écrit l'ADR, le poste en commentaire sur l'issue, puis **s'arrête** sur `STATUS: adr-pending-approval` sans commiter.

Décisions à trancher dans l'ADR :
- `.optional()` sans défaut plutôt qu'un défaut littéral `"English"`, et pourquoi un défaut risque de changer silencieusement la sortie rendue de tout projet existant à l'upgrade.
- Quels sites d'injection exacts reçoivent le bloc encadré, et quelles sections sont exclues comme lignes sentinelles/énumérations ou passthrough de sortie d'outil verbatim.
- La formulation précise de la clause de réserve, et si `implementer.md` a besoin d'une variante étendue nommant les préfixes de commit, les constantes de label du board et les valeurs de drapeaux du CLI de tickets.
- Si `stripStandaloneTags` (`src/template.ts:143`) garantit réellement un rendu identique octet pour octet sur chaque fichier touché, ou si certains blocs encadrés en position inline (non standalone) laissent un artefact résiduel et doivent être reformatés.
- La formulation exacte de la question posée par `init`, pour que « sauter » soit sans ambiguïté par rapport à saisir une langue.
- Si la fixture d'exemple omet `language`, et si cette omission est elle-même vérifiée par un test pour qu'un changement futur ne puisse pas masquer le chemin « clé absente ».
- Comment le bump de version du pack est communiqué, étant donné qu'il force de la dérive ou une réécriture sur toute install existante.

---

generated_by: tracker
task: Channel from agent workflow
