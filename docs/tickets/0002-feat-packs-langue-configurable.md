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
synced: false
syncedAt: 2026-09-18T16:38:49.173Z
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

<!-- litecode:comment -->
DRAFT ADR — awaiting approval, NOT committed yet. This is the full drafted content of `docs/decisions/0011-optional-project-language-for-agent-prose.md`, written to that path in worktree `../worktrees/issue-16` on branch `feat/packs-language-config/issue-16`. Code implementing steps 1-13 of the plan above is already committed locally on that branch (commit `934130e`, `bun run check` and `bun test` both green — 165 pass / 0 fail). The ADR file itself is intentionally held back from `git add`/commit pending your review — nothing has been pushed and no PR exists yet. Please reply with approve / edits / correction on any decision below.

---

# 0011. Optional `project.language` for agent prose

Status: proposed
Date: 2026-09-21

## Context

Issue #16 asks for a `project.language` config key (free text, e.g. `"French"`,
`"Brazilian Portuguese"`) that is interpolated into pack prompts so agent prose,
GitHub content agents write, and generated ADRs follow the project's chosen working
language.

Two earlier debate angles rendered `blocking`, each correct about a different failure
mode of the obvious designs:

- `language: z.string().optional()` with a **bare** `{{ project.language }}`
  interpolation at each injection site: `renderLeaf` (`src/template.ts:124-126`) throws
  `TemplateError` on any undefined path, and `referencedPaths()` (used by pre-flight
  validation in `src/install.ts`) walks the raw pack sources to determine which config
  paths must be present — so `litecode install` would break for **every existing
  config** the moment any pack file referenced `project.language` at all, since none
  of them declare it.
- `language: z.string().default("English")` with the same bare interpolation: parses
  fine for every existing config, but silently injects a brand-new instruction into
  the rendered prompts of **every existing project** on the next `litecode install` —
  a behavior change disguised as a schema default, with no config diff a human would
  notice to explain it.

Both angles agreed the field should exist; they disagreed on how to make it safe to
introduce into a config-driven templating system where the absence of a key must not
be distinguishable, in the rendered output, from a key that was never invented.

## Decision

`language: z.string().optional()` **with no `.default()`**, and **every** pack
injection site is wrapped in `{{#if project.language}}…{{/if}}` rather than
interpolating the bare path. `{{#if}}` evaluates truthiness instead of throwing on
`undefined`, and the render context is literally `{ project: config.project }` — so an
absent key skips the whole block, and `stripStandaloneTags` removes the block tags'
own lines, leaving the rendered file byte-identical to today whenever `language` is
absent. That byte-identical property, exercised directly in `tests/template.test.ts`
and across the full example-config render in `tests/install.test.ts`, is the only part
of this feature a machine can actually verify — nothing can assert on the language an
LLM's prose comes out in.

No BCP-47 validation, no enum, no auto-detection. `src/detect.ts`'s `Detected` type has
no `language` field and none was added — `init` asks a plain optional question with no
inferred default.

### Injection sites (framed) vs. exclusions (never framed)

Framed with `{{#if project.language}}…{{/if}}`, one short "Working language" section
near the top of each file's prose, right after its opening paragraph(s):
`packs/core/agents/implementer.md`, `orchestrator.md`, `reviewer.md`,
`debate-angle.md`, `triage.md`, `classifier.md`, `synthesizer.md`, and
`packs/core/skills/github-project-sync/SKILL.md`.

Each block's own reserve clause states exactly which of that agent's output fields
carry translatable prose and which stay English, and why — because a single blanket
"translate everything" instruction would contradict three concrete existing prompts:
`triage.md`'s `NEXT_STATUS: <Planned | Blocked>` (board labels as enum values),
`reviewer.md`'s `CHECK_OUTPUT:` (verbatim tool output), and `sync.md`'s existing
"report verbatim from the command's own output" instruction.

Never framed, anywhere: every sentinel key and its enum values across all seven
agents, Conventional Commit prefixes and `src/board/spec.ts`'s label/status constants
(implementer.md's block names these explicitly, plus `litecode ticket new`'s
`--label`/`--priority`/`--size` flag values), `reviewer.md`'s `CHECK_OUTPUT:`,
`github-project-sync/SKILL.md`'s `gh` flags/status-role names, and
`src/board/spec.ts` itself (plain TypeScript the template engine never touches, so it
needed no framing). `orchestrator.md` is a partial exception: its `PLAN:` and
`RECOMMENDATION:` fields carry free prose by design and are named translatable, while
`SIZE:`/`PANEL:`/`ADR:` and verbatim `BLOCKING_TENSION` text stay English.

### Wording of the reserve clause

Each block states which field(s) carry translatable prose, then which stay English and
*why* (sentinel key, enum value, commit-prefix convention, or verbatim passthrough) —
naming the reason, not just asserting the rule. `implementer.md`'s variant additionally
names commit prefixes, board label constants, and ticket CLI flag values, since it is
the only agent producing all three directly.

### `stripStandaloneTags` and byte-identical rendering

Every inserted `{{#if project.language}}`/`{{/if}}` pair is placed alone on its own
line, so it is a "standalone tag" in `stripStandaloneTags`'s sense and its line is
removed entirely rather than left blank when skipped. Verified directly (not assumed):
`tests/template.test.ts` exercises this exact standalone pattern and asserts the
absent-key render matches surrounding text exactly with no leftover blank line;
`tests/install.test.ts`'s full-render assertions over the example config (which does
not set `language`) confirm no touched pack file regressed against the pre-existing
"no unresolved template syntax" check. No inline (non-standalone) placement was used
anywhere, so the residual-artifact risk the issue flagged does not arise here.

### `init`'s question wording

*"Working language for agent prose, e.g. French (blank to keep agents in English)"*,
no fallback passed to `ask()`. A blank answer returns `""`, omitted from the written
config by the conditional spread (`...(language ? { language } : {})`, same pattern as
`web`) — the parenthetical makes "skip" unambiguous relative to typing a language.

### Example config and its own drift guard

`examples/ts-employee-service.litecode.config.json` deliberately omits `language`, so
it keeps exercising the absent-key path through the existing "no unresolved template
syntax" test. This PR adds a second copy of that test with `language` set on the parsed
example config, plus two new `tests/packs.test.ts` checks: every `project.language`
reference in any pack file must fall inside a `{{#if project.language}}…{{/if}}` range,
and no sentinel-shaped line (`^[A-Z][A-Z_]*:`) may interpolate `{{ project.language }}`.

### Pack version bump and its consequence

`packs/core/pack.json` moves `0.3.0` → `0.4.0`. Every touched pack file's rendered hash
changes even for a project that never sets `language`, since the added `{{#if}}` lines
change the source template. Any existing install will see drift (or a silent rewrite
under `--force`) on its next `litecode install` — inherent to how templated packs are
versioned here, and called out explicitly in the PR description.

## Consequences

- A project that sets `project.language` gets translated agent prose, GitHub content,
  and ADRs, with no change to sentinel-key-driven pipeline mechanics.
- A project that never sets it is provably unaffected at the byte level, verified by
  test, not inspection.
- Adding a ninth pack file with prose in the future must repeat this framing/exclusion
  split by hand — the two new `tests/packs.test.ts` guards catch a *misused* reference,
  not a *missing* one. A future prose-heavy pack file with no working-language section
  at all would not be caught by this PR's tests.
<!-- /litecode:comment -->
