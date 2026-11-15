# Modèle de données

`*` = NOT NULL. Tables et colonnes en `snake_case` (voir [conventions.md](conventions.md)). Sens des termes : [GLOSSARY.md](../../GLOSSARY.md).

## Tables

**`territory`** : `id` PK, `name`*. Une seule ligne (territoire pilote), créée par le script d'installation.

**`account`** (table unique pour tous les profils)
- `id` PK, `territory_id`* FK (renseigné automatiquement à l'inscription, sans saisie)
- `role`* ∈ `STORE`, `ASSOCIATION`, `COORDINATOR`
- `status`* ∈ `PENDING`, `ACTIVE`, `REFUSED`, `ANONYMIZED`
- `email`* unique, toujours en minuscules (contrainte `CHECK`), `password_hash` (nullable, vidé à l'anonymisation)
- `organization_name`*, `address`*
- `cold_capacity` text[] (association) ⊆ {`AMBIENT`, `CHILLED`, `FROZEN`}, défaut `{AMBIENT}`
- `decided_by` FK, `decided_at`, `refusal_reason` (décision sur l'inscription)
- `created_at`*

**`session`** : `sid` PK, `account_id` FK (nul pour une session anonyme), `csrf_token`*, `expires_at`*. Une session anonyme porte le jeton CSRF des formulaires affichés avant la connexion ; la connexion la remplace par une session au nouveau `sid`.

**`login_failure`** (échecs de connexion) : `id` PK, `email`* (tel que saisi, en minuscules, que le compte existe ou non), `failed_at`*, `starts_block`* (vrai pour le 5e échec en 15 min, qui ouvre un blocage de 15 min). Lignes supprimées pour un e-mail à sa connexion réussie, et par la tâche horaire au-delà de 15 min.

**`push_subscription`** (appareil abonné aux notifications push) : `id` PK, `account_id`* FK, `endpoint`* unique (adresse fournie par le service de push du navigateur), `p256dh`* et `auth`* (clés de l'appareil, qui chiffrent le contenu pour lui seul), `created_at`*. Plusieurs lignes par compte (compte partagé). Une ligne est supprimée quand l'appareil se désabonne, ou quand le service de push répond que l'abonnement n'existe plus (404 ou 410). La préférence par compte `notify_new_batches` a été supprimée ([ADR 0003](../adr/0003-push-notifications-instead-of-email.md)).

**`batch`** (lot)
- `id` PK, `store_id`* FK
- `nature`*, `quantity`* integer, `quantity_unit`* (cagettes, portions, palette…)
- `weight_kg`* numeric, `value_eur`* numeric
- `expiry_date`* date, `date_type`* ∈ `DLC`, `DDM`
- `pickup_start`*, `pickup_end`* `timestamptz` (créneau de retrait)
- `cold_requirement`* ∈ `AMBIENT`, `CHILLED`, `FROZEN`
- `status`* ∈ `DECLARED`, `RESERVED`, `COLLECTED`, `CANCELLED`, `EXPIRED`
- `submission_token`* unique : jeton aléatoire du formulaire de déclaration, pour qu'une double soumission ne crée qu'un lot
- `created_at`* (= date de déclaration), `collected_at`, `expired_at`

**`reservation`**
- `id` PK, `batch_id`* FK, `association_id`* FK
- `reserved_at`*, `reserved_by_name`* (prénom du bénévole)
- `collected_by_name` (prénom saisi à la collecte)
- `cancelled_by` FK, `cancelled_at`
- **Index unique partiel sur `batch_id` là où `cancelled_at` est NULL** : une seule réservation active par lot, garantie par la base.
- Une réservation annulée est conservée (pas de DELETE).

**`batch_history`** (corrections et annulations par la Coordination) : `id`, `batch_id`*, `changed_by`*, `changed_at`*, `field`*, `old_value`, `new_value`, `reason`. `reason` est nullable en base mais **obligatoire côté application** pour une annulation ou une collecte tardive.

**`batch_report`** (signalements) : `id`, `batch_id`*, `reported_by`*, `reported_at`*, `reason`*.

**`donation_certificate`** (attestation) : `id`, `number`* unique (format `PS91-AAAA-NNNN`, séquence annuelle), `store_id`*, `issued_by`*, `period_start`*, `period_end`*, `total_weight_kg`*, `total_value_eur`*, `issued_at`*, `status`* ∈ `ISSUED`, `REPLACED` ; `replaced_by` FK nullable (auto-référence).

**`certificate_batch`** : PK (`certificate_id`, `batch_id`), `nature`*, `quantity`*, `quantity_unit`*, `weight_kg`*, `value_eur`* **figés à l'émission** : la page d'une attestation ne relit jamais le lot (sauf `collected_at`, qui ne se corrige pas).

## Points d'attention

- Le lot ne porte pas de FK vers l'association : on la retrouve via `reservation`.
- Les changements de statut sont datés dans leur table (`reserved_at`, `collected_at`, `expired_at`) ; seules les corrections et annulations de la Coordination vont dans `batch_history`.
- Aucune contrainte en base ne vérifie le `role` des FK (`store_id`, `association_id`) : le contrôle est applicatif.
- Pas de table pour l'export des indicateurs : il est calculé à la volée.

## Dates et heures

- Tous les instants (`created_at`, `pickup_start`, `pickup_end`, `reserved_at`, `collected_at`, `expired_at`, `cancelled_at`, `decided_at`, `issued_at`, `changed_at`, `reported_at`, `expires_at`) sont en **`timestamptz`**. `expiry_date`, `period_start` et `period_end` sont des `date`.
- Tout calcul calendaire se fait dans le fuseau **`Europe/Paris`** : année du numéro d'attestation, bornes d'un trimestre, bornes incluses d'une période d'attestation, affichage des dates.
- L'heure courante vient de l'horloge injectée et est passée en paramètre aux requêtes : jamais `now()` SQL ni `Date.now()` dans une règle métier (voir [testing-quality.md](testing-quality.md#comment-tester)).

## Anonymisation

Script documenté dans le README : `email` = `anonyme-<id>@invalide`, nom et adresse remplacés par des valeurs neutres, `password_hash` vidé, `status` = `ANONYMIZED`, appareils abonnés (`push_subscription`) supprimés. Lots, réservations et attestations restent rattachés.

## Installation

Le script de `scripts/` s'exécute une fois (en local ou en production) : il crée les tables, le territoire pilote et le premier `COORDINATOR`, dont les identifiants viennent de variables d'environnement.
