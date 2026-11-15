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

- **S'inscrire** : formulaire limité à nom de la structure, type (commerce ou association), adresse, e-mail, mot de passe. **Aucun autre champ** (un test vérifie la liste exacte). Crée un compte `PENDING` sans accès métier, rattaché automatiquement au territoire pilote. E-mail déjà utilisé → refus avec message clair. Les `COORDINATOR` ne s'inscrivent pas : ils sont créés par le script d'installation. L'e-mail est comparé **sans tenir compte de la casse** (enregistré en minuscules), à l'inscription comme à la connexion. Une personne déjà connectée qui ouvre l'inscription voit un message l'invitant à se déconnecter d'abord (cas d'un commerce qui inscrit un autre site), sans formulaire ; un envoi du formulaire connecté → 403.
- **Se connecter** : e-mail + mot de passe. Seul un compte `ACTIVE` se connecte ; `PENDING`/`REFUSED` → message « compte non actif » ; `ANONYMIZED` ne se connecte plus. **Blocage** : 5 échecs (mot de passe faux, e-mail inconnu ou compte anonymisé) en 15 min pour un même e-mail → connexion refusée pendant 15 min à partir du 5e échec, même avec le bon mot de passe ; les tentatives faites pendant le blocage sont refusées sans être comptées et ne le prolongent pas ; une connexion réussie remet le compteur à zéro ; même message que l'e-mail existe ou non. Chaque profil ne voit que ses pages : un commerce ses lots, une association ses réservations. Session, cookie, CSRF, codes 401/403 : voir [security.md](security.md).
- **Valider ou refuser une inscription** (Coordination) : liste des comptes `PENDING` avec les informations saisies. Valider → `ACTIVE`, refuser → `REFUSED` (motif facultatif). Décision tracée (`decided_by`, `decided_at`). E-mail de décision au demandeur. Seul un compte `PENDING` peut être décidé : une décision est définitive (sinon « inscription introuvable ou déjà traitée », sans e-mail). Raison : deux membres de la Coordination qui traitent la même inscription en même temps ne doivent pas s'écraser ni envoyer deux e-mails contradictoires. Une erreur se corrige à la main, par la requête SQL du README (« Corriger une décision d'inscription »), qui remet le compte `PENDING`.
- **Activer les notifications sur un appareil** (commerce et association) : encadré « Notifications » sur l'accueil, bouton « Activer les notifications ». Le navigateur demande alors l'autorisation : aucune notification n'est possible sans ce clic de l'utilisateur, l'application ne peut pas les activer à sa place. L'encadré reste affiché tant que l'appareil n'est pas abonné. Une fois abonné, il propose « Désactiver les notifications sur cet appareil ». Sur iPhone hors écran d'accueil, il explique comment ajouter l'application à l'écran d'accueil (iOS 16.4 ou plus récent) ; sans push possible (iOS 15, ancien navigateur), il reste masqué. Un abonnement par appareil (`push_subscription`), envoyé par `POST /push-subscriptions` et retiré par `POST /push-subscriptions/delete` (seulement un appareil du compte connecté). Un appareil appartient au compte qui l'a abonné en dernier ; il est renvoyé à chaque visite de l'accueil. Adresse hors des services de push connus ou clés mal formées → **400**. Coordination → **403** (aucune notification ne lui est destinée). Se déconnecter ne désabonne pas l'appareil. Décision du 29/10/2026, [ADR 0003](../adr/0003-push-notifications-instead-of-email.md).

## Commerce (`declare-batch`)

- **Déclarer un lot** : tous les champs obligatoires (nature, quantité + unité, poids, valeur, date limite + type DLC/DDM, créneau, froid). Poids et valeur **> 0** (virgule ou point acceptés) ; quantité entière **≥ 1**. Date limite non passée (le jour même est accepté, en heure de Paris). Créneau **avant** la date limite : il se termine au plus tard le jour de la date limite. Le créneau doit finir après son début et ne pas être déjà terminé. Lot créé `DECLARED`. **Double soumission = un seul lot** (jeton `submission_token` du formulaire, unique en base) ; un renvoi du même formulaire est signalé au commerce. Au plus **3 actions de navigation** depuis l'accueil du commerce : ouvrir le formulaire, valider (récapitulatif, avec « Modifier » pour revenir au formulaire), confirmer. Moins d'une minute sur smartphone.
- **Suivre ses lots** : tous les lots du commerce, du plus récent au plus ancien, statut à jour. Un lot collecté affiche la date de collecte et le prénom du bénévole.
- **Dupliquer un lot** (optionnel) : formulaire prérempli depuis un lot ; dates et créneau à ressaisir ; rien n'est créé avant validation ; mêmes règles que la déclaration.

## Association (`reserve-batch`)

- **Consulter les lots disponibles** : lots `DECLARED` dont la date limite et le créneau ne sont pas dépassés (créneau dépassé dès que l'heure de l'horloge injectée atteint `pickup_end`, sans attendre le planificateur). Affiche nature, quantité, poids, date limite (DLC/DDM), créneau, froid, nom et adresse du commerce. Tri par date limite croissante.
- **Réserver un lot** (`POST /batches/{id}/reserve`, champ `reserved_by_name`) :
  1. Session absente → **401** ; autre profil ou compte non `ACTIVE` → **403**. Contrôles **avant** la transaction.
  2. `BEGIN` → `SELECT … FROM batch … FOR UPDATE` (écrit en clair).
  3. Condition : `status = 'DECLARED'`, `pickup_end` non dépassé (réservation possible avant `pickup_start` ; refusée dès que l'horloge atteint `pickup_end`, 18 h 00 pile compris pour un créneau finissant à 18 h : personne ne pourrait plus retirer le lot, et il a déjà quitté la liste des lots disponibles ; décision du 28/10/2026, ticket #7), `cold_requirement ∈ cold_capacity`.
  4. OK → `INSERT reservation` + `UPDATE batch SET status = 'RESERVED'` + `COMMIT`. Sinon `ROLLBACK` et message.
  - Deux demandes simultanées : une seule réussit, l'autre reçoit « lot déjà réservé ».
  - Froid incompatible : **refus bloquant** (obligation sanitaire), avec un message invitant à mettre à jour sa capacité de froid si l'association est équipée.
  - `reserved_by_name` obligatoire, visible du commerce.
- **Annuler sa réservation** : seule l'association réservataire, tant que le lot est `RESERVED`. Le lot repasse `DECLARED` et redevient disponible. Trace : `cancelled_by`, `cancelled_at`. **Pas de notification de nouveau lot** à cette occasion. Depuis la page « Mes réservations » (`GET /reservations`, réservations actives de l'association sur des lots `RESERVED`), bouton « Annuler la réservation » → `POST /batches/{id}/cancel-reservation`. Autre association, ou lot sans réservation active → **403** ; lot non `RESERVED` (dont `EXPIRED` à réservation active) → **409** ; créneau terminé (horloge ≥ `pickup_end`, même avant le planificateur) → **409**, la réservation reste active pour que la collecte reste enregistrable, et la page n'affiche plus le bouton ; lot inexistant → 404. Même verrou `FOR UPDATE` sur le lot que la réservation ; la libération passe par `src/shared/reservations.js` (aussi utilisée par la Coordination). Décision du 28/10/2026, ticket #8.
- **Confirmer la collecte** : seule l'association réservataire, sur un lot `RESERVED` ou `EXPIRED` (réservation non annulée), jusqu'à 24 h après `pickup_end`. → `COLLECTED` + `collected_at`. `collected_by_name` obligatoire, prérempli avec `reserved_by_name`. Sur un lot `EXPIRED`, `expired_at` est conservé et aucun motif n'est demandé. Accepter un lot `RESERVED` dont `pickup_end` vient de passer mais que le planificateur n'a pas encore expiré. La confirmation ne s'annule pas côté association ; au-delà de 24 h, seule la Coordination peut enregistrer la collecte. Depuis « Mes réservations » (qui affiche aussi les lots `EXPIRED` à réservation active tant que la fenêtre est ouverte), formulaire `POST /batches/{id}/confirm-pickup` (champ `collected_by_name`). Fenêtre close dès que l'horloge atteint `pickup_end` + 24 h (même convention que le créneau). Autre association ou réservation annulée → **403** ; lot déjà `COLLECTED`, autre statut ou fenêtre close → **409** ; prénom vide → **400**, vérifié **après** les contrôles d'accès et d'état du lot, comme pour la réservation : une association qui ne peut pas agir sur le lot reçoit ce refus plutôt qu'une erreur de saisie (cas d'une page restée ouverte pendant que la Coordination annulait la réservation). Même verrou `FOR UPDATE` ; notification push au commerce après le `COMMIT`. Décision du 29/10/2026, ticket #10.
- **Déclarer sa capacité de froid** : cases `AMBIENT`/`CHILLED`/`FROZEN`, défaut `AMBIENT` seul. Au moins une case cochée, sinon refus « Cochez au moins une case » et capacité précédente conservée (une capacité vide masquerait tous les lots et les notifications de nouveaux lots ; décision du 27/10/2026, ticket #6). Modifiable à tout moment, s'applique aux réservations futures seulement.
- **Filtrer par capacité de froid** : la liste des lots disponibles se limite aux lots compatibles ; filtre activé par défaut.
- **Historique de ses collectes** (optionnel) : lots `COLLECTED` de l'association (nature, poids, commerce, date de collecte), du plus récent au plus ancien ; filtre par période avec poids total. Jamais les collectes d'une autre association.
- **Être prévenue des nouveaux lots** : notification push « Nouveau lot disponible » sur chaque appareil abonné de l'association (voir « Activer les notifications sur un appareil »), pour chaque lot compatible avec sa capacité de froid. Envoyée après l'insertion du lot ; une double soumission du formulaire n'envoie rien. Pour ne plus la recevoir, l'association désactive les notifications de l'appareil : il n'y a plus de préférence par compte (`notify_new_batches` supprimée, [ADR 0003](../adr/0003-push-notifications-instead-of-email.md)). Un échec d'envoi, ou de la recherche des destinataires, est journalisé et ne bloque pas la déclaration. Décision du 29/10/2026, ticket #11.

## Expiration (`expire-batches`)

Tâche toutes les heures (retard max 1 h) : lots `DECLARED`/`RESERVED` dont `pickup_end` est dépassé → `EXPIRED` + `expired_at`. La même tâche supprime les sessions expirées et les échecs de connexion de plus de 15 min (`login_failure`) : passé ce délai ils ne servent plus au blocage, et ce sont des données personnelles (minimisation RGPD). La marge d'1 h ne réduit pas la fenêtre de 24 h de confirmation de collecte.

## Attestations (`certificates`)

- **Produire une attestation** (Coordination) : commerce + période (bornes incluses). Seuls les lots `COLLECTED`, rattachés par `collected_at`. Contenu : identité du commerce et du Panier Solidaire 91 (émetteur), période, liste des lots, poids total, valeur totale, date d'émission, numéro unique `PS91-AAAA-NNNN` (année d'émission, séquence remise à 1 chaque année). Valeur = celle déclarée, **jamais recalculée**. Page HTML imprimable (PDF via le navigateur). **Une attestation émise n'est jamais modifiée.**
  - Si la période chevauche une attestation `ISSUED` du même commerce (`REPLACED` ignorées) : avertir en listant les lots déjà attestés, puis laisser la Coordination confirmer (non bloquant).
- **Consulter ses attestations** (Commerce) : liste (numéro, période, date d'émission) et page imprimable ; jamais celles d'un autre commerce. Une attestation `REPLACED` reste consultable, marquée « remplacée », avec un lien vers la remplaçante.

## Coordination (`monitoring`)

- **Suivre tous les lots** : tous les lots, tous statuts. Filtres commerce, association, statut, période de déclaration. Ligne : statut, commerce, association (si réservé), dates clés, mention « signalé ». **Paginée**, 50 lots par page par défaut (configurable), pour 8 500 lots par an.
  - Page `GET /monitoring/batches` (Coordination seule : sans session → redirection vers la connexion, autre profil → **403**), paramètres `store`, `association`, `status`, `from`, `to`, `page`. Valeur invalide → **400**. Tri du plus récent au plus ancien (date de déclaration). Association = celle de la réservation **active** (filtre compris). Période : date de déclaration, jour entier en heure de Paris, bornes incluses. Dates clés affichées quand elles existent : déclaration, réservation, collecte, expiration, et le créneau de retrait. La mention « signalé » arrive avec le ticket des signalements (#24, optionnel). Décision du 15/11/2026, ticket #12.
- **Corriger ou annuler un lot** : correction des champs (mêmes contrôles que la déclaration) ou annulation (`CANCELLED`), y compris un lot collecté (doublon). Annuler un lot réservé libère la réservation (`cancelled_by`, `cancelled_at`). Chaque correction ou annulation est historisée dans `batch_history` (qui, quand, ancienne et nouvelle valeur, motif).
  - Écrans : `GET`/`POST /monitoring/batches/{id}/edit` (correction) et `POST /monitoring/batches/{id}/cancel` (annulation), lien « Corriger ou annuler » depuis le suivi. **Correction : seulement `DECLARED` et `RESERVED`**, avec exactement les contrôles de la déclaration ; autre statut → **409**. Motif facultatif pour une correction, obligatoire pour une annulation (**400** sinon). Annulation d'un lot `EXPIRED` ou déjà `CANCELLED` → **409**. Une ligne `batch_history` par champ modifié ; l'annulation s'écrit `field = status`, `DECLARED`/`RESERVED`/`COLLECTED` → `CANCELLED`. Le statut du lot est vérifié **avant** la saisie (409 avant 400). Un lot dont le créneau est terminé ne se corrige plus (contrôle de la déclaration conservé) : il expire ou s'annule. Corriger la contrainte de froid d'un lot `RESERVED` vers un niveau que l'association réservataire ne sait pas respecter → **409** (froid incompatible = refus bloquant). Dans `batch_history`, le créneau est enregistré avec son décalage (`2026-11-03T18:00+01:00`). Aucune notification n'est envoyée. Décisions du 15/11/2026, ticket #13.
  - Collecte confirmée par erreur → annulation avec motif obligatoire ; si les produits sont encore là, le commerce déclare un nouveau lot.
  - Collecte tardive (> 24 h après `pickup_end`, réservation non annulée) : `COLLECTED`, `collected_at` réel, `expired_at` conservé, association = celle de la réservation, motif obligatoire.
    - Écran : `GET`/`POST /monitoring/batches/{id}/late-pickup`, lien « Enregistrer une collecte tardive » depuis le suivi pour un lot `EXPIRED` avec réservation active. La Coordination **saisit** la date et l'heure réelles de collecte (heure de Paris), pas avant `pickup_start`, pas dans le futur ; `collected_at` prend cette valeur. Refus **409** (statut vérifié avant la saisie) si le lot n'est pas `EXPIRED`, sans réservation active, ou si l'horloge n'a pas atteint `pickup_end` + 24 h (l'association peut encore confirmer) ; motif ou date invalide → **400**. Historique : une ligne `status` (`EXPIRED` → `COLLECTED`) et une ligne `collected_at`, avec le motif. Notification push au commerce, une seule par collecte. Décision du 15/11/2026, ticket #14.
  - **Annule et remplace** : si l'opération change la liste, le poids ou la valeur des lots d'une attestation émise, avertir avant validation ; à la validation, l'ancienne → `REPLACED` + `replaced_by`, et une nouvelle attestation est émise (nouveau numéro, même commerce, même période, mêmes règles).
- **Exporter les indicateurs trimestriels** : CSV pour un trimestre :
  - tonnes collectées (par `collected_at`) ;
  - lots créés, tous statuts (par `created_at`) ;
  - lots collectés (par `collected_at`) ;
  - taux de collecte = collectés / créés du trimestre ;
  - valeur totale des lots collectés (par `collected_at`) ;
  - délai moyen entre `created_at` et le `reserved_at` de la première réservation (rattaché à la date de cette réservation).
- **Signaler une valeur incohérente** (optionnel) : depuis la liste de suivi, signalement avec motif obligatoire (`batch_report`). Ne modifie pas le lot. Manuel uniquement.

## Notifications (`src/shared/notifications/` uniquement)

En français. Un échec d'envoi est **journalisé et non bloquant** : l'opération métier réussit quand même. Notifications push par défaut ; e-mail seulement quand le destinataire ne peut pas encore avoir d'appareil abonné ([ADR 0003](../adr/0003-push-notifications-instead-of-email.md)).

**E-mail** (expéditeur `MAIL_FROM`) :

| Déclencheur | Destinataire | Objet | Contenu |
|---|---|---|---|
| Inscription validée ou refusée | le demandeur | « Votre inscription au Panier Solidaire 91 » | décision, motif éventuel |

**Push** (vers chaque appareil abonné du compte destinataire ; aucun appareil abonné → rien n'est envoyé). Toucher la notification ouvre la page indiquée. Un appareil dont l'abonnement a disparu (réponse 404 ou 410 du service de push) est retiré ; un appareil en échec ne prive pas les suivants.

| Déclencheur | Destinataire | Titre | Contenu | Page ouverte |
|---|---|---|---|---|
| Lot collecté | le commerce (une seule notification par collecte) | « Votre lot a été collecté » | nature, date de collecte | Mes lots |
| Lot créé `DECLARED` (déclaration ou duplication) | chaque association `ACTIVE`, froid compatible | « Nouveau lot disponible » | nature, poids, commerce, date limite, créneau | Lots disponibles |

## Hypothèses à valider avec la cliente

- « Gaspillage évité » = tonnes collectées.
- Disponibilité : du lundi au samedi, de 8 h à 18 h, sans objectif chiffré.
- Durées de conservation RGPD et registre des traitements : non définis. Ne rien coder, signaler.

## Hors périmètre

Ne pas coder : dons des drives et de Seine-et-Marne, SMS, tournées de collecte, contrôle automatique de cohérence des valeurs, multi-réseau, table de points de collecte, droits RGPD en libre-service (procédure manuelle, voir [security.md](security.md#rgpd)).

- **Photo et description d'un lot** (décision du 27/10/2026) : la déclaration garde sa liste de champs fermée. Le besoin est de faciliter le don pour le commerce, pas d'attirer les associations : les lots partent déjà vite. Une photo alourdit la déclaration sur smartphone personnel, coûte en stockage (budget de 6 000 € HT par an, hébergement en France ou dans l'UE) et peut montrer des personnes (RGPD). Une note de retrait facultative (accès, interlocuteur) sera évaluée sur les retours du pilote d'avril à juin 2027 (voir [context.md](context.md)).
