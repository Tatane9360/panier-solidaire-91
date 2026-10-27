# Règles métier

Relis la section d'une fonctionnalité avant de la coder. Une règle absente d'ici n'existe pas : demande avant d'en inventer une. Vocabulaire : [GLOSSARY.md](../../GLOSSARY.md). « (optionnel) » = à coder seulement si le reste est terminé.

## Cycle de vie d'un lot

Transitions autorisées (liste exhaustive) :

| De | Vers | Action | Qui | Condition |
|---|---|---|---|---|
| — | `DECLARED` | Déclarer / dupliquer un lot | Commerce | |
| `DECLARED` | `RESERVED` | Réserver | Association | voir « Réserver un lot » |
| `RESERVED` | `DECLARED` | Annuler sa réservation | Association | réservataire uniquement |
| `RESERVED` | `COLLECTED` | Confirmer la collecte | Association | réservataire, ≤ 24 h après `pickup_end` |
| `DECLARED`/`RESERVED` | `EXPIRED` | Expiration | Planificateur | `pickup_end` dépassé |
| `EXPIRED` | `COLLECTED` | Confirmer la collecte | Association | réservation non annulée, ≤ 24 h après `pickup_end` |
| `EXPIRED` | `COLLECTED` | Enregistrer une collecte tardive | Coordination | réservation non annulée, > 24 h, motif obligatoire |
| `DECLARED`/`RESERVED`/`COLLECTED` | `CANCELLED` | Annuler un lot | Coordination | motif obligatoire |

- `CANCELLED` est final. Un lot `EXPIRED` ne peut pas être annulé. Un lot expiré **sans** réservation ne devient jamais `COLLECTED`.
- Un lot réservé qui expire sans être collecté reste `EXPIRED` avec sa réservation active : ni re-réservation, ni annulation. Seule une collecte tardive peut encore le faire changer.
- Toute autre transition est interdite.

## Comptes (`accounts`)

- **S'inscrire** : formulaire limité à nom de la structure, type (commerce ou association), adresse, e-mail, mot de passe. **Aucun autre champ** (un test vérifie la liste exacte). Crée un compte `PENDING` sans accès métier, rattaché automatiquement au territoire pilote. E-mail déjà utilisé → refus avec message clair. Les `COORDINATOR` ne s'inscrivent pas : ils sont créés par le script d'installation.
- **Se connecter** : e-mail + mot de passe. Seul un compte `ACTIVE` se connecte ; `PENDING`/`REFUSED` → message « compte non actif » ; `ANONYMIZED` ne se connecte plus. Chaque profil ne voit que ses pages : un commerce ses lots, une association ses réservations. Session, cookie, CSRF, codes 401/403 : voir [security.md](security.md).
- **Valider ou refuser une inscription** (Coordination) : liste des comptes `PENDING` avec les informations saisies. Valider → `ACTIVE`, refuser → `REFUSED` (motif facultatif). Décision tracée (`decided_by`, `decided_at`). E-mail de décision au demandeur.

## Commerce (`declare-batch`)

- **Déclarer un lot** : tous les champs obligatoires (nature, quantité + unité, poids, valeur, date limite + type DLC/DDM, créneau, froid). Poids et valeur **> 0**. Date limite dans le futur. Créneau **avant** la date limite. Lot créé `DECLARED`. **Double soumission = un seul lot**. Au plus **3 actions de navigation** depuis l'accueil du commerce (ouvrir le formulaire, valider, confirmer), moins d'une minute sur smartphone.
- **Suivre ses lots** : tous les lots du commerce, du plus récent au plus ancien, statut à jour. Un lot collecté affiche la date de collecte et le prénom du bénévole.
- **Dupliquer un lot** (optionnel) : formulaire prérempli depuis un lot ; dates et créneau à ressaisir ; rien n'est créé avant validation ; mêmes règles que la déclaration.

## Association (`reserve-batch`)

- **Consulter les lots disponibles** : lots `DECLARED` dont la date limite et le créneau ne sont pas dépassés (`pickup_end` antérieur à l'heure de l'horloge injectée ⇒ dépassé, sans attendre le planificateur). Affiche nature, quantité, poids, date limite (DLC/DDM), créneau, froid, nom et adresse du commerce. Tri par date limite croissante.
- **Réserver un lot** (`POST /batches/{id}/reserve`, champ `reserved_by_name`) :
  1. Session absente → **401** ; autre profil ou compte non `ACTIVE` → **403**. Contrôles **avant** la transaction.
  2. `BEGIN` → `SELECT … FROM batch … FOR UPDATE` (écrit en clair).
  3. Condition : `status = 'DECLARED'`, `pickup_end` non dépassé (réservation possible avant `pickup_start`), `cold_requirement ∈ cold_capacity`.
  4. OK → `INSERT reservation` + `UPDATE batch SET status = 'RESERVED'` + `COMMIT`. Sinon `ROLLBACK` et message.
  - Deux demandes simultanées : une seule réussit, l'autre reçoit « lot déjà réservé ».
  - Froid incompatible : **refus bloquant** (obligation sanitaire), avec un message invitant à mettre à jour sa capacité de froid si l'association est équipée.
  - `reserved_by_name` obligatoire, visible du commerce.
- **Annuler sa réservation** : seule l'association réservataire, tant que le lot est `RESERVED`. Le lot repasse `DECLARED` et redevient disponible. Trace : `cancelled_by`, `cancelled_at`. **Pas d'e-mail de nouveau lot** à cette occasion.
- **Confirmer la collecte** : seule l'association réservataire, sur un lot `RESERVED` ou `EXPIRED` (réservation non annulée), jusqu'à 24 h après `pickup_end`. → `COLLECTED` + `collected_at`. `collected_by_name` obligatoire, prérempli avec `reserved_by_name`. Sur un lot `EXPIRED`, `expired_at` est conservé et aucun motif n'est demandé. Accepter un lot `RESERVED` dont `pickup_end` vient de passer mais que le planificateur n'a pas encore expiré. La confirmation ne s'annule pas côté association ; au-delà de 24 h, seule la Coordination peut enregistrer la collecte.
- **Déclarer sa capacité de froid** : cases `AMBIENT`/`CHILLED`/`FROZEN`, défaut `AMBIENT` seul. Modifiable à tout moment, s'applique aux réservations futures seulement.
- **Filtrer par capacité de froid** : la liste des lots disponibles se limite aux lots compatibles ; filtre activé par défaut.
- **Historique de ses collectes** (optionnel) : lots `COLLECTED` de l'association (nature, poids, commerce, date de collecte), du plus récent au plus ancien ; filtre par période avec poids total. Jamais les collectes d'une autre association.
- **Alerte nouveaux lots** : préférence `notify_new_batches` (activée par défaut) modifiable depuis le compte.

## Expiration (`expire-batches`)

Tâche toutes les heures (retard max 1 h) : lots `DECLARED`/`RESERVED` dont `pickup_end` est dépassé → `EXPIRED` + `expired_at`. La même tâche supprime les sessions expirées. La marge d'1 h ne réduit pas la fenêtre de 24 h de confirmation de collecte.

## Attestations (`certificates`)

- **Produire une attestation** (Coordination) : commerce + période (bornes incluses). Seuls les lots `COLLECTED`, rattachés par `collected_at`. Contenu : identité du commerce et du Panier Solidaire 91 (émetteur), période, liste des lots, poids total, valeur totale, date d'émission, numéro unique `PS91-AAAA-NNNN` (année d'émission, séquence remise à 1 chaque année). Valeur = celle déclarée, **jamais recalculée**. Page HTML imprimable (PDF via le navigateur). **Une attestation émise n'est jamais modifiée.**
  - Si la période chevauche une attestation `ISSUED` du même commerce (`REPLACED` ignorées) : avertir en listant les lots déjà attestés, puis laisser la Coordination confirmer (non bloquant).
- **Consulter ses attestations** (Commerce) : liste (numéro, période, date d'émission) et page imprimable ; jamais celles d'un autre commerce. Une attestation `REPLACED` reste consultable, marquée « remplacée », avec un lien vers la remplaçante.

## Coordination (`monitoring`)

- **Suivre tous les lots** : tous les lots, tous statuts. Filtres commerce, association, statut, période de déclaration. Ligne : statut, commerce, association (si réservé), dates clés, mention « signalé ». **Paginée**, 50 lots par page par défaut (configurable), pour 8 500 lots par an.
- **Corriger ou annuler un lot** : correction des champs (mêmes contrôles que la déclaration) ou annulation (`CANCELLED`), y compris un lot collecté (doublon). Annuler un lot réservé libère la réservation (`cancelled_by`, `cancelled_at`). Chaque correction ou annulation est historisée dans `batch_history` (qui, quand, ancienne et nouvelle valeur, motif).
  - Collecte confirmée par erreur → annulation avec motif obligatoire ; si les produits sont encore là, le commerce déclare un nouveau lot.
  - Collecte tardive (> 24 h après `pickup_end`, réservation non annulée) : `COLLECTED`, `collected_at` réel, `expired_at` conservé, association = celle de la réservation, motif obligatoire.
  - **Annule et remplace** : si l'opération change la liste, le poids ou la valeur des lots d'une attestation émise, avertir avant validation ; à la validation, l'ancienne → `REPLACED` + `replaced_by`, et une nouvelle attestation est émise (nouveau numéro, même commerce, même période, mêmes règles).
- **Exporter les indicateurs trimestriels** : CSV pour un trimestre :
  - tonnes collectées (par `collected_at`) ;
  - lots créés, tous statuts (par `created_at`) ;
  - lots collectés (par `collected_at`) ;
  - taux de collecte = collectés / créés du trimestre ;
  - valeur totale des lots collectés (par `collected_at`) ;
  - délai moyen entre `created_at` et le `reserved_at` de la première réservation (rattaché à la date de cette réservation).
- **Signaler une valeur incohérente** (optionnel) : depuis la liste de suivi, signalement avec motif obligatoire (`batch_report`). Ne modifie pas le lot. Manuel uniquement.

## E-mails (`src/shared/notifications/` uniquement)

En français, expéditeur `MAIL_FROM` (variable d'environnement). Un échec d'envoi est **journalisé et non bloquant** : l'opération métier réussit quand même.

| Déclencheur | Destinataire | Objet | Contenu |
|---|---|---|---|
| Lot collecté | le commerce (un seul e-mail par collecte) | « Votre lot a été collecté » | nature, date de collecte |
| Inscription validée ou refusée | le demandeur | « Votre inscription au Panier Solidaire 91 » | décision, motif éventuel |
| Lot créé `DECLARED` (déclaration ou duplication) | chaque association `ACTIVE`, `notify_new_batches` vrai, froid compatible | « Nouveau lot disponible » | nature, poids, date limite, créneau, commerce, lien vers les lots disponibles |

## Hypothèses à valider avec la cliente

- « Gaspillage évité » = tonnes collectées.
- Disponibilité : du lundi au samedi, de 8 h à 18 h, sans objectif chiffré.
- Durées de conservation RGPD et registre des traitements : non définis. Ne rien coder, signaler.

## Hors périmètre

Ne pas coder : dons des drives et de Seine-et-Marne, SMS et notifications push, tournées de collecte, contrôle automatique de cohérence des valeurs, multi-réseau, table de points de collecte, droits RGPD en libre-service (procédure manuelle, voir [security.md](security.md#rgpd)).
