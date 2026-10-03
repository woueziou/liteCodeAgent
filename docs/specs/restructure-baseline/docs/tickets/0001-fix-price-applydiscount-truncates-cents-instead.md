---
schemaVersion: 2
id: 0001-fix-price-applydiscount-truncates-cents-instead
title: "fix(price): applyDiscount truncates cents instead of rounding to nearest"
label: bug
status: planned
priority: medium
size: small
assignedAgent: implementer
dueDate: 
importedFrom: 
---

## Contexte
applyDiscount floors the discounted price, so a half cent is always lost against the customer. 1001 cents at 50 percent returns 500 instead of 501.

## Critères d'acceptation
- [ ] applyDiscount rounds the final price to the nearest cent, halves rounding up.
- [ ] applyDiscount(1001, 50) returns 501 and applyDiscount(999, 15) still returns 849.
- [ ] A test covers the half-cent case and fails before the fix.
- [ ] bun run check and bun test pass.
