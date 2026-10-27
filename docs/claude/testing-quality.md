# Tests et Definition of Done

## Tests automatisés

- Outil : `node:test`, lancé par `node --test`. Pas de Jest ni de Vitest.
- Aucun seuil de couverture, mais **chaque règle de [business-rules.md](business-rules.md) doit être vérifiable par un test**. À tester impérativement :
  - réservation exclusive, **avec deux réservations simultanées sur une vraie base PostgreSQL** (pas de mock) ;
  - refus pour froid incompatible et pour créneau dépassé ;
  - expiration horaire ;
  - confirmation de collecte en retard sous 24 h, et refus au-delà ;
  - attestation : sélection par `collected_at`, valeurs figées, avertissement de chevauchement, annule et remplace ;
  - accès par profil, y compris 401/403 et redirection vers la connexion ;
  - liste exacte des champs du formulaire d'inscription ;
  - double soumission de la déclaration d'un lot = un seul lot.
- Nommer les tests d'après la règle vérifiée (`refuses reservation when cold requirement is not in capacity`).
- Les tests vivent dans le dossier de la fonctionnalité (voir [architecture.md](architecture.md#organisation-du-code-package-by-feature)).
- CI : GitHub Actions avec `services: postgres` ; la fusion est bloquée si un test échoue.

## Comment tester

- **Un seul point d'entrée** : l'application construite par sa fonction de construction (voir [architecture.md](architecture.md#construction-de-lapplication)), démarrée sur un port libre et appelée par de vraies requêtes HTTP (connexion, jeton CSRF, formulaires).
- **Vraie base PostgreSQL de test**, remise à zéro entre les tests. Pas de mock de la base.
- On vérifie ce qui se voit de l'extérieur : réponse (page, 401/403, redirection), état en base, e-mails envoyés.
- **E-mails** : transport en mémoire de `src/shared/notifications/` ; on vérifie destinataire et objet.
- **Horloge** : contrôlée par le test, pour la fin de session, le créneau dépassé, la fenêtre de 24 h, l'expiration et le blocage après échecs.
- **Exception** : la tâche du planificateur est appelée directement avec la base et l'horloge de test ; son effet est vérifié ensuite par HTTP.
- Pas de tests unitaires des requêtes SQL ni des fonctions internes : ils cassent à chaque refactorisation sans protéger de règle.

## Charge

- Cible : 35 lots/h, temps de réponse < 2 s.
- Script **k6** sur la réservation. k6 s'utilise en CLI et ne figure pas dans les dépendances du projet.

## Definition of Done

Une fonctionnalité est terminée quand :

1. ses règles de [business-rules.md](business-rules.md) sont toutes vérifiées ;
2. ses tests passent et toute la suite est verte dans GitHub Actions ;
3. le code est relu avec la checklist de PR ;
4. les règles de [security.md](security.md), [conventions.md](conventions.md) et [architecture.md](architecture.md) sont respectées (et l'objectif de charge pour la réservation) ;
5. l'écran est testé sur un ancien smartphone et sur un ordinateur (pas d'écran, comme pour l'expiration : les tests automatisés suffisent).

## Tests manuels

- Déclaration d'un lot : test chronométré sur smartphone (< 1 minute, ≤ 3 actions de navigation).
- Vérification sur iPhone iOS 15 ou Android 10 avec Chrome à jour (voir [accessibility-mobile.md](accessibility-mobile.md)).
