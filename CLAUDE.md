# panier-solidaire-91

Plateforme de gestion des dons alimentaires du **Panier Solidaire 91** (association, Essonne). Des **commerces** déclarent des lots ; des **associations** les réservent et les collectent ; la **Coordination** valide les inscriptions, suit les lots et produit les attestations de don. MVP réalisé seul, livré en décembre 2026 et évalué depuis le dépôt (étiquette `remise`).

## Règles non négociables

1. **Stack** : Node.js 26 + Express, HTML rendu côté serveur, Tailwind CSS **v3.4**, PostgreSQL via `pg` **sans ORM**, tests `node:test`, modules ESM. Pas de SPA, pas de DSFR, pas de dépendance non justifiée. → [architecture](docs/claude/architecture.md)
2. **Structure** : `src/features/<feature>/` (routes, SQL, pages, tests) ; **aucun import entre features** ; partagé dans `src/shared/` ; e-mails **uniquement** via `src/shared/notifications/`. → [architecture](docs/claude/architecture.md#organisation-du-code-package-by-feature)
3. **Noms et langues** : code, base, commits, branches en **anglais** ; pages, messages et e-mails en **français** ; identifiants **exactement** ceux du [glossaire](GLOSSARY.md) ; `camelCase` en JS, `snake_case` en base, statuts en `MAJUSCULES`. → [conventions](docs/claude/conventions.md)
4. **Cycle de vie d'un lot** : seules les transitions listées sont permises ; réservation par `SELECT … FOR UPDATE` + index unique partiel ; froid incompatible = refus **bloquant**. Dates en `timestamptz` ; année, trimestre et période calculés en `Europe/Paris`. → [règles métier](docs/claude/business-rules.md#cycle-de-vie-dun-lot), [données](docs/claude/data-model.md#dates-et-heures)
5. **Sécurité** : SQL paramétré, mots de passe hachés (scrypt), contrôle d'accès par profil sur chaque route (401/403), cloisonnement par compte, CSRF. **Dépôt public : aucun secret ni donnée réelle.** → [sécurité](docs/claude/security.md)
6. **Tests** : chaque règle métier testée **par HTTP** sur un vrai PostgreSQL, e-mails en mémoire et **horloge injectée** (jamais `Date.now()` ni `now()` SQL dans une règle) ; réservation concurrente testée ; tests verts avant fusion. → [tests et qualité](docs/claude/testing-quality.md)
7. **Accessibilité et mobile** : RGAA 4.1.2 sur les parcours principaux ; fonctionne sur iOS 15 / Android 10 ; déclaration d'un lot en ≤ 3 actions. → [accessibilité](docs/claude/accessibility-mobile.md)
8. **Git** : PR uniquement vers `main`, Conventional Commits, branche `<numéro du ticket>-<feature>` (`7-reserve-batch`). **Après l'étiquette `remise` : plus aucun commit, réécriture ou déplacement d'étiquette.** → [workflow](docs/claude/workflow.md)
9. **Code explicable ligne à ligne** : simple plutôt qu'astucieux (revue de code à l'oral).
10. **Ne pas inventer de règle** : si la documentation est muette, demander à l'utilisateur, puis consigner la décision dans [business-rules.md](docs/claude/business-rules.md), ou dans un ADR (`docs/adr/`) si elle est difficile à défaire.

## Quel module lire ?

| Tâche | Module |
|---|---|
| Ajouter du code, une dépendance, un dossier | [architecture.md](docs/claude/architecture.md) |
| Écrire du SQL, une migration, toucher à une table | [data-model.md](docs/claude/data-model.md) |
| Implémenter ou modifier une fonctionnalité | [business-rules.md](docs/claude/business-rules.md) |
| Nommer quoi que ce soit, écrire un commit | [GLOSSARY.md](GLOSSARY.md) + [conventions.md](docs/claude/conventions.md) |
| Authentification, droits, données personnelles, secrets | [security.md](docs/claude/security.md) |
| Écrire des tests, vérifier qu'une tâche est terminée | [testing-quality.md](docs/claude/testing-quality.md) |
| Écrire une page HTML ou un écran | [accessibility-mobile.md](docs/claude/accessibility-mobile.md) |
| Branche, PR, bogue, livraison, README | [workflow.md](docs/claude/workflow.md) |
| Comprendre un choix d'architecture | [docs/adr/](docs/adr/) |

## Agent skills

### Suivi des issues

Les issues vivent dans GitHub Issues (`Tatane9360/panier-solidaire-91`), via le CLI `gh`. Voir `docs/agents/issue-tracker.md`.

### Labels de triage

Les cinq labels par défaut (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Voir `docs/agents/triage-labels.md`.

### Documentation du domaine

Un seul contexte : `GLOSSARY.md` et `docs/adr/` à la racine. Voir `docs/agents/domain.md`.
