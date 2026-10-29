# Panier Solidaire 91

Plateforme web de gestion des dons alimentaires du **Panier Solidaire 91**, réseau associatif de l'Essonne.

Les **commerces** déclarent leurs invendus sous forme de lots, les **associations** les réservent puis les collectent, et la **Coordination** supervise le réseau : validation des inscriptions, suivi des lots, attestations de don et indicateurs pour le financeur.

> **État du projet** : conception terminée, développement en cours (MVP livré en décembre 2026).
> L'avancement est suivi dans les [issues GitHub](https://github.com/Tatane9360/panier-solidaire-91/issues) : la [spécification](https://github.com/Tatane9360/panier-solidaire-91/issues/1) et ses tickets.

## Sommaire

- [Le besoin](#le-besoin)
- [Fonctionnalités](#fonctionnalités)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Installation et lancement](#installation-et-lancement)
- [Tests et qualité](#tests-et-qualité)
- [Sécurité et données personnelles](#sécurité-et-données-personnelles)
- [Corriger une décision d'inscription](#corriger-une-décision-dinscription)
- [Contribuer](#contribuer)
- [Documentation](#documentation)

## Le besoin

Aujourd'hui, les dons passent par SMS ou appel à la coordination, un groupe de messagerie entre associations, des bons de collecte papier et un tableur mis à jour chaque mois :

- un commerce ne sait pas qui viendra chercher ses invendus ;
- deux associations se déplacent parfois pour le même lot, ou personne ne le réserve à temps ;
- un lot qui exige du froid peut partir chez une association non équipée ;
- la Coordination reconstitue à la main les attestations de don et les indicateurs trimestriels du Conseil départemental, financeur du réseau.

La plateforme centralise ce circuit, garantit qu'un lot n'est réservé que par une seule association et produit automatiquement les documents attendus.

## Fonctionnalités

### Commerce *(smartphone)*

- Déclarer un lot en trois actions au plus : nature, quantité, poids, valeur, date limite (DLC ou DDM), créneau de retrait, contrainte de froid.
- Suivre ses lots et savoir quel bénévole vient les retirer.
- Être prévenu par notification quand un lot est collecté.
- Consulter et imprimer ses attestations de don.

### Association *(smartphone)*

- Consulter les lots disponibles, filtrés selon sa capacité de froid.
- Réserver un lot de façon exclusive, même si une autre association clique au même instant.
- Annuler sa réservation, puis confirmer la collecte jusqu'à 24 h après le créneau.
- Recevoir une notification à chaque nouveau lot compatible avec sa capacité de froid.

### Coordination *(ordinateur)*

- Valider ou refuser les inscriptions.
- Suivre tous les lots du réseau, les corriger ou les annuler, avec historique et motif.
- Produire les attestations de don (numérotées `PS91-AAAA-NNNN`, jamais modifiées après émission, mécanisme « annule et remplace »).
- Exporter en CSV les indicateurs trimestriels destinés au Conseil départemental.

### Automatismes

- Expiration horaire des lots dont le créneau de retrait est dépassé.
- Notifications push en français, activées appareil par appareil depuis l'accueil ; seule la décision sur une inscription part par e-mail, le demandeur ne pouvant pas encore abonner d'appareil. Un échec d'envoi ne bloque jamais une opération.

## Stack technique

| Couche | Choix |
|---|---|
| Serveur | Node.js 26, Express, modules ECMAScript |
| Rendu | HTML généré côté serveur, Tailwind CSS v3.4 |
| Base de données | PostgreSQL, SQL direct via `pg` (sans ORM) |
| Tests | `node:test`, sur une vraie base PostgreSQL |
| Notifications | Web Push (bibliothèque `web-push`) ; e-mail SMTP pour la décision d'inscription (Mailpit en local, Brevo en production) |
| Mobile | Application web progressive (PWA), compatible iOS 15 et Android 10 ; notifications à partir d'iOS 16.4 (application ajoutée à l'écran d'accueil) et d'Android 10 |
| Intégration continue | GitHub Actions avec service PostgreSQL |

Les choix privilégient la stabilité et un minimum de dépendances : authentification, sessions, protection CSRF et migrations sont écrites sans bibliothèque tierce.

## Architecture

Monolithe organisé **par fonctionnalité** : chaque dossier regroupe ses routes, ses requêtes SQL, ses pages et ses tests.

```
src/features/accounts/        inscription, connexion, validation des inscriptions, abonnement aux notifications
src/features/declare-batch/   déclaration et suivi des lots (commerce)
src/features/reserve-batch/   lots disponibles, réservation, collecte (association)
src/features/certificates/    attestations de don
src/features/monitoring/      suivi, corrections, export (Coordination)
src/features/expire-batches/  tâche horaire d'expiration
src/shared/                   base de données, sessions, contrôle d'accès
src/shared/notifications/     seul module qui envoie des notifications (push, e-mail)
scripts/                      script d'installation
```

Une fonctionnalité n'importe jamais le code d'une autre : ce qui est commun passe par `src/shared/`. Les choix structurants sont consignés dans [`docs/adr/`](docs/adr/).

## Installation et lancement

> Les commandes seront documentées ici au fil du développement.

Prérequis prévus :

- Node.js 26 ;
- PostgreSQL (installé localement, ou via Docker Compose, facultatif) ;
- Mailpit pour recevoir en local l'e-mail de décision d'inscription ;
- une paire de clés VAPID pour les notifications push, propre à chaque installation : `pnpm exec web-push generate-vapid-keys`, à copier dans `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` du fichier `.env` (la clé privée est un secret, jamais dans le dépôt). Le serveur refuse de démarrer sans elles.

La configuration passe par des variables d'environnement, décrites dans un fichier d'exemple sans secret : connexion à la base, expéditeur et serveur SMTP, clés VAPID, durée de session, taille de page du suivi, identifiants du premier compte Coordination.

Un script d'installation crée les tables, le territoire pilote et le premier compte Coordination. Des comptes de démonstration seront fournis pour chaque profil, avec des données entièrement fictives.

## Tests et qualité

- Chaque règle métier est couverte par un test qui passe par HTTP, comme un utilisateur, sur une vraie base PostgreSQL.
- La réservation est testée avec deux demandes simultanées pour garantir son exclusivité.
- Les e-mails, les notifications push et l'heure sont simulés pendant les tests, pour vérifier l'expiration et les délais sans attendre.
- La fusion vers `main` est bloquée si un test échoue.
- Objectif de charge : 35 lots par heure avec un temps de réponse inférieur à 2 secondes (script k6).
- Accessibilité : parcours principaux conformes au RGAA 4.1.2.

## Sécurité et données personnelles

- Requêtes SQL paramétrées, mots de passe hachés (scrypt), protection CSRF.
- Notifications chiffrées de bout en bout pour l'appareil : les services de push des navigateurs les transmettent sans pouvoir les lire. Le serveur n'envoie qu'aux services de push connus.
- Contrôle d'accès par profil sur chaque route ; chaque compte ne voit que ses propres données.
- Sessions expirées après 30 minutes d'inactivité ; connexion bloquée temporairement après 5 échecs.
- Minimisation RGPD : les bénévoles n'ont pas de compte, seul leur prénom est saisi.
- Les demandes d'accès et de suppression sont traitées manuellement par la Coordination (requêtes SQL et script d'anonymisation documentés).
- Aucun secret ni aucune donnée réelle dans ce dépôt.

## Corriger une décision d'inscription

Une décision sur une inscription est définitive dans l'application : si deux personnes de la Coordination traitent la même inscription, la seconde reçoit « Inscription introuvable ou déjà traitée » et le demandeur ne reçoit qu'un e-mail.

Pour corriger une erreur (par exemple un refus donné au mauvais compte), remettre le compte en attente, puis le décider de nouveau depuis la page « Inscriptions en attente » : la nouvelle décision est tracée et l'e-mail part normalement.

```sql
UPDATE account
SET status = 'PENDING', decided_by = NULL, decided_at = NULL, refusal_reason = NULL
WHERE email = 'adresse-du-compte@example.org' AND status IN ('ACTIVE', 'REFUSED');
```

À lancer avec `psql "$DATABASE_URL"`. L'adresse s'écrit en minuscules.

## Contribuer

- Une branche courte par ticket, nommée `<numéro du ticket>-<fonctionnalité>` (exemple : `7-reserve-batch`).
- Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/), en anglais.
- Fusion vers `main` uniquement par pull request, tests verts.

Le détail du processus est décrit dans [`docs/claude/workflow.md`](docs/claude/workflow.md).

## Documentation

| Document | Contenu |
|---|---|
| [`GLOSSARY.md`](GLOSSARY.md) | Vocabulaire métier et identifiants utilisés dans le code |
| [`docs/claude/business-rules.md`](docs/claude/business-rules.md) | Règles métier et cycle de vie d'un lot |
| [`docs/claude/data-model.md`](docs/claude/data-model.md) | Modèle de données |
| [`docs/claude/architecture.md`](docs/claude/architecture.md) | Stack et organisation du code |
| [`docs/claude/security.md`](docs/claude/security.md) | Sécurité et RGPD |
| [`docs/claude/testing-quality.md`](docs/claude/testing-quality.md) | Stratégie de test et définition de « terminé » |
| [`docs/claude/accessibility-mobile.md`](docs/claude/accessibility-mobile.md) | Accessibilité, mobile et performance |
| [`docs/adr/`](docs/adr/) | Décisions d'architecture |
| [`CLAUDE.md`](CLAUDE.md) | Consignes pour l'assistant de code |
