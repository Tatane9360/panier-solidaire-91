# Contexte du projet

Source : brief du commanditaire et recueil initial de Codéa (documents A à F). Ce module décrit le besoin ; les règles à coder restent dans [business-rules.md](business-rules.md).

## Le commanditaire

Le **Panier Solidaire 91**, association loi 1901 créée en 2014 à Évry-Courcouronnes, coordonne l'aide alimentaire de l'Essonne :

| Chiffre | Valeur |
|---|---|
| Associations membres | 14 (épiceries solidaires, accueils de jour, distributions de colis) |
| Commerces partenaires | 63 (hypermarchés et supermarchés, boulangeries, primeurs, traiteurs) |
| Personnes aidées | environ 9 000 par mois |
| Équipe | 4 salariés, 180 bénévoles |
| Budget annuel | 610 k€, financé à 40 % par le Conseil départemental |
| Denrées collectées en 2025 | 358 tonnes |
| Valeur déclarée des dons collectés en 2025 | 1,72 M€ |

L'attestation de don permet au commerce de bénéficier de la réduction d'impôt du mécénat d'entreprise, calculée sur la valeur des produits donnés : c'est pourquoi la valeur déclarée n'est jamais recalculée.

> « Aujourd'hui, un don, c'est un SMS, un coup de fil et beaucoup de chance. Nous voulons un outil qui nous fasse gagner du temps, qui donne envie aux commerces de continuer à donner, et qui tienne encore debout quand on aura doublé. »
> — Bernard Huet, président du Panier Solidaire 91

## Processus actuel d'un don (document A)

| Étape | Qui | Aujourd'hui | Dans la plateforme |
|---|---|---|---|
| 1 | Commerce | SMS ou appel au numéro de coordination (lundi–samedi, 8 h–18 h) | Déclarer un lot |
| 2 | Coordinatrice salariée | Relaie le message sur le groupe de messagerie des 14 associations | Notification « Nouveau lot disponible » |
| 3 | Associations | La première qui répond « je prends » est retenue | Réservation exclusive (`FOR UPDATE`) |
| 4 | Bénévoles | Chargent les denrées et font signer un bon de collecte papier en deux exemplaires | Confirmer la collecte |
| 5 | Coordinatrice salariée | Saisit les bons chaque fin de mois dans le tableur partagé | Suivi de tous les lots |
| 6 | Trésorière et coordinatrice | En février, rédigent à la main une attestation par commerce pour l'année écoulée | Attestation de don, pour toute période |

## Cadre réglementaire

- Loi du 11 février 2016 : les commerces alimentaires de plus de 400 m² doivent proposer une convention de don de leurs invendus à une association d'aide alimentaire.
- Loi de 2020 relative à la lutte contre le gaspillage et à l'économie circulaire (AGEC) : obligation étendue à d'autres acteurs.

## Périmètre minimum du MVP (brief, § 2.2)

| Profil | Parcours |
|---|---|
| Commerce | Déclarer un lot (nature, quantité, poids, valeur, DLC ou DDM, créneau de retrait) et suivre ce que devient chaque lot. |
| Association | Consulter les lots disponibles, réserver un lot, puis confirmer sa collecte. |
| Coordination | Valider l'inscription des commerces et des associations, suivre l'ensemble des lots, produire l'attestation de don d'un commerce sur une période. |
| Tous | S'authentifier et n'accéder qu'aux fonctions de son profil. |

L'unité de quantité et la contrainte de froid ne figurent pas dans ce tableau : elles viennent de la spécification ([issue #1](https://github.com/Tatane9360/panier-solidaire-91/issues/1)).

## Contraintes (brief, § 2.3)

- **Budget** : 48 000 € HT pour la conception et le MVP (financés par une fondation), puis **6 000 € HT par an au maximum** pour l'hébergement, la maintenance et les licences.
- **Calendrier** : MVP livré en décembre 2026 ; **pilote** avec 3 associations et 15 commerces d'avril à juin 2027 ; ouverture à tout le réseau en septembre 2027.
- **Hébergement et données** : en France ou dans l'Union européenne ; conformité au RGPD.
- **Accessibilité** : RGAA, exigé par le Conseil départemental.
- **Équipements** : commerces et bénévoles utilisent leur **smartphone personnel** ; la Coordination travaille sur ordinateur.
- **Technologies** : aucune n'est imposée par le commanditaire ; les choix sont argumentés dans le dossier et fixés dans [architecture.md](architecture.md).
- **Montée en charge** : l'outil doit « tenir encore debout » quand le réseau aura doublé (environ 28 associations et 126 commerces).
