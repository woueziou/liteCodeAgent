---
schemaVersion: 2
id: 0058-fix-dashboard-install-petits-durcissements-laiss
title: "fix(dashboard,install): petits durcissements laissés par bug-hunter sur #96, #97 et #98"
label: bug
status: backlog
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Findings non bloquants laissés hors des PR #96 (0055), #97 (0052) et #98 (0046). Détails dans les commentaires de ces PR.

## Critères d'acceptation
- `--allow-host` sans valeur ne prend pas l'option suivante comme valeur (`repeatedArg` dans src/cli.ts) : erreur explicite.
- `dashboard --serve` affiche au démarrage la liste effective des hôtes autorisés.
- `isWildcardBindHost` reconnaît aussi `--host 0` et `::ffff:0.0.0.0`.
- Un échec d'écriture de `core.hooksPath` pendant `install` est signalé à l'utilisateur (aujourd'hui détecté mais silencieux).
- `primaryCheckoutRoot()` (src/doctor.ts) gère un dépôt bare utilisé comme worktree principal.
- Un test par point.

## Plan
1. src/cli.ts, src/dashboard/serve.ts : les trois points du dashboard.
2. src/install.ts : message d'échec de core.hooksPath.
3. src/doctor.ts : dépôt bare.
4. tests/.

## Hors périmètre
Nouvelles options.
