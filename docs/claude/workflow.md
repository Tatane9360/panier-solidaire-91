# Workflow Git et livraison

## Dépôt et branches

- GitHub, dépôt **public** (voir [security.md](security.md#dépôt) : aucun secret).
- `main` est protégée : pas de push direct, fusion **uniquement par PR** avec les tests verts. `main` doit toujours démarrer.
- Branches courtes, créées depuis `main`, nommées `<numéro du ticket>-<feature>` : `7-reserve-batch`. Plusieurs tickets touchent la même feature, le numéro les distingue.
- Commits conventionnels en anglais (voir [conventions.md](conventions.md#commits)).

## Processus par fonctionnalité

1. Un ticket GitHub (sous-issue de la spec), avec ses critères d'acceptation et ses tickets bloquants.
2. Branche courte.
3. Commits conventionnels.
4. PR qui liste les règles traitées et la checklist de la [Definition of Done](testing-quality.md#definition-of-done).
5. GitHub Actions bloque la fusion si un test échoue.
6. En solo, la relecture est différée et tracée dans la PR.

Ordre des dépendances : l'expiration avant la confirmation de collecte en retard ; les attestations avant « annule et remplace ».

## Bogues

Corriger la cause, ajouter un test de non-régression, et décrire dans la PR : symptôme, reproduction, cause, correction.

## Gel de remise (critique)

- L'étiquette **`remise`** est posée sur le dernier commit à la livraison.
- **Ensuite : aucun commit, aucune réécriture d'historique, aucun déplacement d'étiquette.** Un dépôt modifié après la remise annule l'évaluation.
- ⚠️ Ne jamais lancer `git push --force`, `git tag -f` ni `git rebase` sur `main` sans accord explicite.

## Déploiement

Pas d'hébergement pour le MVP : il est démontré en local depuis le dépôt cloné.

Pour le pilote (avril à juin 2027, 3 associations et 15 commerces), l'hébergement devra être en France ou dans l'Union européenne et tenir, avec la maintenance et les licences, dans **6 000 € HT par an** (voir [context.md](context.md#contraintes-brief--23)).

## Livrables du dépôt

- **README** : installation, lancement en local (avec et sans Docker), exécution des tests, variables d'environnement, **comptes de démonstration pour chaque profil**, requêtes SQL d'accès RGPD, script d'anonymisation.
- Fichier d'exemple de configuration, sans secret.
- Script d'installation dans `scripts/`.
