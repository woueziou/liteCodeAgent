---
schemaVersion: 1
id: 0019-fix-agents-la-sous-passe-code-review-ne-rend-jam
title: fix(agents): la sous-passe `code-review` ne rend jamais, ce qui plafonne tout verdict — et n'existe pas hors Claude Code
label: bug
status: inProgress
priority: high
size: medium
assignedAgent: human
dueDate: 
issue: 48
synced: true
syncedAt: 2026-09-21T16:26:14.464Z
---

## Symptôme : plus aucune PR ne peut obtenir `approve`

L'ADR 0007 (issue #29), décision 4, impose à `reviewer` de plafonner son `VERDICT` à `changes-requested` quand la sous-passe `code-review` a été invoquée mais n'a pas rendu dans le budget du tour. La règle est juste : une review dont la passe de correction n'a jamais tourné ne peut pas certifier un diff.

Mais dans la session du 19-21/09/2026, cette sous-passe **n'a rendu aucune fois sur six** — PR #37, #39, #40 (cinq rondes), #41 (huit rondes), #47 (deux rondes). Dans chaque cas, le reviewer a fait une lecture manuelle complète, n'a trouvé aucun défaut restant, et a quand même dû plafonner.

Conséquence : **le plafond ne signale plus rien**. Il se déclenche systématiquement, indépendamment de la qualité du diff. Un `changes-requested` ne distingue plus une PR défectueuse d'une PR saine, et chaque merge se fait en passant outre le verdict — ce qui vide la règle de son sens et habitue à ignorer un signal d'alerte.

Cause observée, rapportée par plusieurs reviewers : la skill `code-review` démarre comme tâche d'arrière-plan (« backgrounded / forked run ») et le reviewer n'a aucun moyen d'attendre son résultat dans son propre tour.

## Second volet : la sous-passe n'existe pas sur quatre des cinq cibles

`src/config.ts` déclare cinq cibles d'installation : `claude-code`, `codex`, `pi`, `opencode`, `kilo-code`. `src/install.ts` adapte le frontmatter et les répertoires par cible — **mais pas les corps de prompts**, qui sont rendus depuis la même source `packs/core/agents/*.md`.

Or `code-review` **n'est pas une skill de ce dépôt** : `packs/core/skills/` ne contient que `agent-attribution`, `chained-implementation`, `critique-expert`, `github-project-sync`, `idea-to-planned` et `security-expert`. C'est une skill intégrée de Claude Code, invoquée via l'outil `Skill` — lui aussi propre à Claude Code.

Sur `codex`, `pi`, `opencode` et `kilo-code`, `reviewer.md:39` désigne donc quelque chose qui n'existe pas.

La portabilité ne tient aujourd'hui qu'à une distinction fragile entre deux lignes voisines du prompt :
- `reviewer.md:39` — « Only skip it if the skill genuinely isn't invokable in this run » → pas de plafond
- `reviewer.md:40` — « when the skill *was* invoked but didn't return » → plafond

Rien n'aide un agent à savoir dans quel cas il est : aucune condition de template par cible, aucune documentation. Un agent sur une cible non-Claude qui lirait la ligne 40 en premier plafonnerait **tous** ses verdicts, définitivement.

Dépendances Claude comparables dans des corps de prompts partagés entre les cinq cibles : `subagent_type` et l'outil `Agent` — 4 occurrences dans `implementer.md`, 1 dans `reviewer.md`, 1 dans `triage.md`.

## À trancher (ne pas pré-décider)

- Peut-on rendre l'invocation de `code-review` réellement bloquante, ou est-ce une limite du harnais hors de portée de ce dépôt ? Si c'est hors de portée, le plafond doit-il rester en l'état, devenir configurable, ou être remplacé par un signal qui ne se confond pas avec un défaut de code ?
- Comment `reviewer` distingue-t-il de façon fiable « skill non invocable sur cette cible » de « invoquée sans retour » ? Piste : une condition de template par cible dans `install.ts`, pour que le bloc `code-review` ne soit rendu que sur `claude-code`.
- Faut-il un équivalent de passe de correction pour les cibles non-Claude, ou assumer explicitement que `reviewer` y fait une lecture manuelle sans plafond ?
- Les dépendances à `Agent`/`subagent_type` dans `implementer.md`, `reviewer.md` et `triage.md` méritent-elles le même traitement par cible ? (Peut relever d'un ticket distinct.)

## Preuves

Six plafonnements consécutifs, tous documentés dans les commentaires de PR : #37, #39, #40, #41, #47 (deux fois). Dans chacun, le reviewer a explicitement écrit que le plafond venait de l'indisponibilité de la sous-passe et non d'un défaut trouvé dans le diff.

---

**generated_by: tracker**

<!-- litecode:comment -->
Approche retenue (choix humain, 2026-09-23) : un agent dédié, consigné dans l'ADR 0013.

- Nouvel agent de pack `bug-hunter` : chasse aux bugs par scénarios d'échec concrets, confirmés en exécutant le code, chaque constat marqué `confirmed` ou `plausible`, et `HUNT: complete | partial` pour ne jamais présenter une chasse incomplète comme terminée. Skills déclarées en dur (`critique-expert`, `security-expert`) pour ne pas imposer une nouvelle clé `agentSkills` aux configs existantes.
- `implementer` l'invoque directement via `Agent`, en parallèle de `reviewer` — le même mécanisme synchrone que pour `reviewer`, qui, lui, rend bien. `Ready to Merge` exige un `approve` de `reviewer` **et** `HUNT: complete` sans constat bloquant non résolu ; les deux rapports sont postés sur la PR.
- `reviewer` ne lance plus de sous-passe `code-review` et ne plafonne plus son verdict. ADR 0007, décision 4, marquée comme remplacée.
- Garde-fou : `tests/agents-correctness-pass.test.ts` interdit à tout fichier de pack de dépendre à nouveau de la skill `code-review`.

Question laissée à 0020 : la dépendance à `Agent`/`subagent_type` sur les cibles non-Claude (le correctif retire la dépendance à une *skill* propre à Claude, pas celle-là).
<!-- /litecode:comment -->
