---
schemaVersion: 1
id: 0012-feat-tickets-garde-fou-anti-doublon-avant-la-cre
title: feat(tickets): garde-fou anti-doublon avant la création d'un ticket
label: feature
status: done
priority: high
size: medium
assignedAgent: implementer
dueDate: 
issue: 30
synced: true
syncedAt: 2026-09-18T17:34:39.809Z
---

## Problème (incident réel, survenu dans cette session)

Les tickets locaux `docs/tickets/0004` et `0005` décrivaient un travail déjà tracké par les issues GitHub #18 et #19, mais ne portaient aucun champ `issue:`. `litecode ticket sync --apply` les a donc traités comme des créations et a ouvert **#21 et #22 en doublon** — mêmes titres, mêmes champs que #18/#19. Les doublons ont dû être fermés à la main et les fichiers locaux repointés vers les issues d'origine.

Cause: rien, ni dans `tracker` ni dans `ticket new` ni dans `planTicketSync` (`src/tickets/sync.ts:87`, où `dirty = !ticket.synced || ticket.pendingComments.length > 0`), ne vérifie qu'un sujet est déjà couvert. Un ticket sans `issue:` est *par définition* une création.

## Plan

- Ajouter une vérification anti-doublon au moment de la création d'un ticket (`litecode ticket new`, et donc le chemin qu'emprunte l'agent `tracker`): comparer le titre/sujet proposé aux tickets locaux existants ET aux issues ouvertes du board, et refuser ou avertir en cas de recouvrement probable.
- Décider et documenter le critère de rapprochement. Partir de signaux simples et explicables (normalisation du titre, correspondance de sous-chaînes significatives, similarité type Levenshtein/trigrammes) plutôt que d'une heuristique opaque. Le critère doit être testable de façon déterministe.
- Comportement en cas de détection: BLOQUER avec un message actionnable nommant le ticket/issue en conflit, cohérent avec la culture du dépôt (`planBoard` lève un `Blocker` plutôt que de deviner — voir `src/board/init.ts`). Prévoir un moyen explicite de passer outre (ex. un flag) pour le cas légitime où deux tickets se ressemblent sans se recouvrir.
- Couvrir aussi le sens inverse, qui est la vraie cause du doublon: un ticket local décrivant un travail déjà tracké ne peut pas être rattaché après coup, faute d'hydratation board→fichier. Renvoyer explicitement au ticket 0009 (dispatcher local-first + hydratation), qui doit fournir ce rattachement; ce ticket-ci traite la détection, 0009 traite la réconciliation. Les deux sont complémentaires, ni l'un ni l'autre ne suffit seul.
- Tests: fixture reproduisant l'incident (un ticket local sans `issue:` dont le titre recouvre une issue ouverte) → la création est bloquée avec le numéro d'issue en conflit dans le message.

## Dependencies

Aucune pour la détection. Complémentaire de 0009 pour le rattachement.

generated_by: tracker
