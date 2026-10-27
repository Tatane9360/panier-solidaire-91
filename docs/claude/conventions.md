# Conventions de code et de nommage

## Langues

- **Code, base de données, commits, branches : anglais.**
- Textes visibles par l'utilisateur : français (« lot déjà réservé »).
- Exception : `DLC` et `DDM` restent en français, comme sur les étiquettes des produits.

## Casse

| Élément | Convention | Exemple |
|---|---|---|
| Variables et fonctions JS | `camelCase` | `reserveBatch` |
| Tables et colonnes | `snake_case` | `cold_requirement` |
| Champs venant de la base, dans le code | gardent leur `snake_case` | `batch.cold_requirement` |
| Statuts et valeurs fixes | `MAJUSCULES` | `RESERVED`, `AMBIENT` |
| Dossiers de fonctionnalité | `kebab-case`, anglais, d'après l'action ou le domaine | `reserve-batch` |
| Branches | `<numéro du ticket>-<feature>`, en `kebab-case` | `7-reserve-batch` |

## Langage du domaine

- Les noms du code et de la base **sont ceux de [GLOSSARY.md](../../GLOSSARY.md)** et de [data-model.md](data-model.md). Pas de synonymes : `batch` (lot), `store` (commerce), `reservation`, `donation_certificate` (attestation), `pickup_start`/`pickup_end` (créneau), `cold_requirement`/`cold_capacity`, `expiry_date` + `date_type`, etc.
- Valeurs fixes exactes :
  - rôles `STORE` `ASSOCIATION` `COORDINATOR` ;
  - statuts de compte `PENDING` `ACTIVE` `REFUSED` `ANONYMIZED` ;
  - statuts de lot `DECLARED` `RESERVED` `COLLECTED` `CANCELLED` `EXPIRED` ;
  - froid `AMBIENT` `CHILLED` `FROZEN` ;
  - `date_type` `DLC` `DDM` ;
  - statuts d'attestation `ISSUED` `REPLACED`.
- Un concept absent du glossaire est un signal : soit tu inventes un terme (à éviter), soit il manque vraiment (le signaler, voir [docs/agents/domain.md](../agents/domain.md)).

## Commits

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/fr/v1.0.0/), en anglais : `feat`, `fix`, `test`, `docs`, `refactor`, `chore`…

```
fix: prevent two associations from reserving the same batch
```

## SQL

- Requêtes **paramétrées** uniquement ; jamais de concaténation de valeurs dans une requête.
- SQL écrit à la main avec `pg` : le verrou `SELECT … FOR UPDATE` reste visible dans la transaction.

## Lisibilité

- Le code doit pouvoir être expliqué ligne à ligne lors d'une revue orale. Préférer le code simple et explicite au code astucieux.
