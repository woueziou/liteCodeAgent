---
schemaVersion: 2
id: 0044-fix-tickets-reconnaitre-les-titres-de-section-av
title: "fix(tickets): reconnaître les titres de section avec apostrophe typographique ou accents décomposés"
label: bug
status: backlog
priority: low
size: small
assignedAgent: human
dueDate: 
---

## Contexte
Finding non bloquant de bug-hunter sur la PR #80 (ticket 0035). `ticketSection()` (src/tickets/spec.ts) compare le titre `## Critères d'acceptation` octet pour octet. Écrit avec une apostrophe typographique (U+2019, ce que produisent beaucoup d'éditeurs et le correcteur de macOS) ou un « è » décomposé (NFD), le titre n'est pas trouvé : `ticket doctor` avertit à tort qu'un ticket actif n'a pas de critères, et le 0036 (reviewer) ne trouverait pas les critères.

## Critères d'acceptation
- La recherche de section normalise en NFC et traite ’ (U+2019) et ' comme équivalents, pour tous les titres de CONTRACT_SECTIONS.
- La casse et les espaces en fin de titre n'empêchent pas la correspondance.
- Tests : titre avec U+2019, titre en NFD, titre avec espace final.

## Plan
1. src/tickets/spec.ts : fonction de normalisation de titre utilisée par ticketSection().
2. tests/tickets-contract.test.ts : cas ci-dessus.

## Hors périmètre
Réécrire les titres dans les fichiers existants.
