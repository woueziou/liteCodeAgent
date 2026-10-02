# liteCodeAgent

Un ensemble d'agents installables qui font avancer des tickets locaux, de l'idée jusqu'à la pull request, dans l'outil de codage de son choix.

## Language

**Ticket**:
Unité de travail décrite par un fichier markdown avec frontmatter dans le ticket directory. C'est la seule source de vérité de l'avancement.
_Avoid_: issue, task

**Ticket directory**:
Le dossier `docs/tickets/`, qui contient tous les tickets du projet.

**Epic**:
Groupe de tickets rangés dans un sous-dossier numéroté du ticket directory.
_Avoid_: lot

**Spec**:
Document de cadrage d'un chantier (problème, solution, user stories, décisions), rangé dans le dossier `docs/specs/`. Un spec n'est pas un ticket : il se découpe en tranches, chacune devenant un ticket.
_Avoid_: ticket de spec

**Slice**:
Ticket vertical issu d'un spec, livrable et vérifiable seul, qui déclare les tickets qui le bloquent.
_Avoid_: lot

**Pack**:
Ensemble installable d'agents, de prompts et de références, décrit par un manifest.

**Manifest**:
Le fichier `pack.json` qui décrit le contenu d'un pack. Il ne désigne rien d'autre.
_Avoid_: resume-manifest

**Install target**:
L'outil de codage sur lequel un pack est installé (opencode, claude-code, codex, kilo-code, pi).
_Avoid_: target

**Runner**:
Le mécanisme (`litecode run`) qui exécute un agent sans outil de codage.

**Dispatcher**:
Le mécanisme de délégation par lequel un agent confie une tâche à un autre agent, avec le runner en repli.

**Orchestrator**:
Agent qui reçoit une demande, la classe, réunit le panel, synthétise et produit le plan.

**Panel**:
Groupe d'angles de débat réunis par l'orchestrator pour examiner une demande.
_Avoid_: debate

**Degraded panel**:
Panel dont au moins un membre n'a pas répondu de façon lisible, ce qui bloque le plan de l'orchestrator.

**Implementer**:
Agent qui réalise un ticket dans un worktree isolé et ouvre une pull request.

**Isolation mode**:
Manière dont l'implementer travaille par rapport au checkout principal : `worktree` (copie isolée) ou `inline` (même checkout, même session). Le mode `auto` choisit selon les capacités de l'install target.

**Domain**:
Règle qui associe un motif de ticket (par exemple « interaction tactile ») aux skills que l'agent doit lire pour ce ticket.

**Reviewer**:
Agent qui relit la pull request d'un ticket et la renvoie à l'implementer en cas de rework.

**Correctness pass**:
Passe de relecture dédiée à la justesse du diff, assurée par l'agent `bug-hunter` et déclenchée par l'implementer.

**ADR gate**:
Étape de l'implementer qui s'arrête pour faire approuver un projet d'ADR avant de continuer.

**Progress journal**:
Enregistrement par ticket de l'avancement, qui permet de reprendre un run interrompu.
_Avoid_: resume-manifest

**Preflight**:
Validation de la configuration avant l'exécution d'un agent.
_Avoid_: pre-flight

**Size**:
Taille d'un ticket (S, M ou L), qui détermine la proportion du flux d'implémentation.

**Dashboard**:
Vue en lecture seule des tickets et des ADR, servie en direct ou figée en snapshot.

**Triage label**:
L'un des cinq rôles de triage (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`).

## Relationships

- Un **Epic** contient plusieurs **Tickets** dans le **Ticket directory**.
- Un **Pack** installé sur un **Install target** fournit l'**Orchestrator**, l'**Implementer** et le **Reviewer**.
- L'**Implementer** tient un **Progress journal** par **Ticket**.
- Le **Dispatcher** relaie les délégations, et le **Runner** prend le relais quand l'**Install target** ne sait pas déléguer.
