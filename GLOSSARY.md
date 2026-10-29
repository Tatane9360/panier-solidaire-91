# Panier Solidaire 91

Dons alimentaires en Essonne : des commerces donnent des lots d'invendus, des associations les réservent et les collectent, la Coordination supervise. Chaque terme est suivi de son identifiant dans le code et la base.

## Profils

**Compte** (`account`) :
Accès d'une structure (commerce ou association) ou de la Coordination, avec un rôle et un statut. Une association n'a qu'un compte, partagé par son responsable et ses bénévoles.
_Éviter_ : utilisateur, membre

**Commerce** (`STORE`) :
Profil donateur, qui déclare des lots.
_Éviter_ : magasin, donateur, shop

**Association** (`ASSOCIATION`) :
Profil bénéficiaire, qui réserve et collecte des lots.
_Éviter_ : bénéficiaire, partenaire

**Coordination** (`COORDINATOR`) :
Profil d'administration du réseau Panier Solidaire 91.
_Éviter_ : admin

**Bénévole** (`reserved_by_name`, `collected_by_name`) :
Personne d'une association qui vient retirer un lot. Il n'a pas de compte : seul son prénom est saisi.

**Territoire** (`territory`) :
Zone géographique à laquelle chaque compte est rattaché. Il n'en existe qu'un pour l'instant, le territoire pilote.

**Notification** :
Message push envoyé aux appareils abonnés d'un compte (nouveau lot disponible, lot collecté). Seule la décision sur une inscription part par e-mail.
_Éviter_ : alerte e-mail, notif

**Appareil abonné** (`push_subscription`) :
Navigateur d'un téléphone ou d'un ordinateur sur lequel quelqu'un a activé les notifications d'un compte. Un compte partagé peut en avoir plusieurs.
_Éviter_ : abonné, inscrit

**Planificateur** :
Tâche horaire du serveur, sans utilisateur, qui fait expirer les lots.

## Lots

**Lot** (`batch`) :
Ensemble de denrées déclaré en une fois par un commerce.
_Éviter_ : don, produit, offre, article

**Lot disponible** :
Lot `DECLARED` dont ni la date limite ni le créneau de retrait ne sont dépassés.

**Date limite** (`expiry_date`, `date_type`) :
DLC (date limite de consommation) ou DDM (date de durabilité minimale) des denrées du lot.
_Éviter_ : date de péremption

**Créneau de retrait** (`pickup_start`, `pickup_end`) :
Plage horaire pendant laquelle le lot peut être retiré chez le commerce. Il est « dépassé » dès que l'heure atteint `pickup_end` (à 18 h 00 pile pour un créneau finissant à 18 h).

**Unité de quantité** (`quantity_unit`) :
Unité dans laquelle la quantité d'un lot est exprimée (cagettes, portions, palette…).

**Contrainte de froid** (`cold_requirement`) :
Niveau de température exigé par un lot : ambiant, frais ou surgelé.

**Capacité de froid** (`cold_capacity`) :
Ensemble, sans ordre, des niveaux de température qu'une association sait respecter. Un lot lui est compatible si sa contrainte de froid en fait partie.

**Réservation** (`reservation`) :
Attribution exclusive d'un lot à une association. Elle reste conservée quand elle est annulée.

**Collecte** (`collected_at`) :
Retrait effectif d'un lot réservé, confirmé par l'association ou, en cas de retard de plus de 24 h, par la Coordination.
_Éviter_ : enlèvement, ramassage

**Expiration** (`expired_at`) :
Passage automatique d'un lot à `EXPIRED` une fois son créneau dépassé.

**Correction** (`batch_history`) :
Modification ou annulation d'un lot par la Coordination, toujours historisée avec son motif (`reason`).

**Signalement** (`batch_report`) :
Mention, posée par la Coordination, qu'une valeur déclarée paraît incohérente. Il ne modifie pas le lot.

## Attestations

**Attestation de don** (`donation_certificate`) :
Document émis par le Panier Solidaire 91 pour un commerce et une période, listant les lots collectés et leurs totaux. Une fois émise, elle n'est jamais modifiée.
_Éviter_ : reçu, certificat

**Remplacement** (`replaced_by`) :
Une attestation devenue fausse après une correction passe à `REPLACED` et pointe vers la nouvelle attestation émise à sa place (« annule et remplace »).

**Indicateurs trimestriels** :
Chiffres d'un trimestre exportés pour le Conseil départemental, financeur (tonnes collectées, lots, valeur, délais).

**Gaspillage évité** :
Assimilé aux tonnes collectées (hypothèse à valider avec la cliente).
