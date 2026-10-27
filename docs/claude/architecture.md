# Architecture et stack

## Stack imposée

| Couche | Choix | Interdit / écarté |
|---|---|---|
| Langage | JavaScript, modules ECMAScript (`"type": "module"`, [ADR 0001](../adr/0001-esm-modules.md)) | TypeScript, CommonJS |
| Serveur | Node.js 26 + Express | — |
| Rendu | HTML généré côté serveur | Frameworks SPA (React, Angular), React Native, Flutter, low-code |
| CSS | Tailwind CSS **v3.4** | Tailwind v4 (exige Safari 16.4, exclut iOS 15), Bootstrap, **DSFR** |
| PWA | manifeste + service worker, installation facultative | Applications natives, stores |
| Base | PostgreSQL, SQL direct via le module `pg` | **ORM**, MySQL, SQLite |
| Tests | `node:test`, lancés par `node --test` | Jest, Vitest |
| Charge | k6 en CLI, **hors** dépendances du projet | — |
| E-mail | SMTP (Brevo en production, Mailpit en local) | Serveur d'e-mail interne |
| Local | Docker Compose **optionnel**, pour la base seulement ; procédure sans Docker dans le README | Docker en production |
| CI | GitHub Actions avec `services: postgres` | — |

- Peu de dépendances, technologies stables. Toute nouvelle dépendance est justifiée par écrit au moment de l'ajout (voir [security.md](security.md#dépendances)).
- Express étant minimal, l'authentification, les sessions, la protection CSRF et les migrations s'écrivent à la main.
- JavaScript client limité au strict nécessaire : les règles restent côté serveur.
- Service worker : ressources statiques et page hors ligne uniquement, jamais de page de données.

## Organisation du code (package by feature)

Arborescence **imposée**. Chaque dossier de fonctionnalité contient ses routes, ses requêtes SQL, ses pages HTML et ses tests, avec une séparation MVC à l'intérieur. Le détail de chaque fonctionnalité est dans [business-rules.md](business-rules.md).

```
src/features/accounts/        inscription, connexion, validation des inscriptions
src/features/declare-batch/   déclaration, suivi et duplication des lots (commerce)
src/features/reserve-batch/   lots disponibles, réservation, collecte, froid, historique (association)
src/features/certificates/    attestations de don
src/features/monitoring/      suivi, correction, export, signalements (Coordination)
src/features/expire-batches/  tâche horaire d'expiration
src/shared/                   base de données, sessions, droits par profil
src/shared/notifications/     seul module qui envoie des e-mails
scripts/                      script d'installation
```

### Règles de dépendance

- **Un dossier de `src/features/` n'importe jamais le contenu d'un autre.** Tout ce qui est partagé passe par `src/shared/`.
- Chaque feature écrit ses requêtes SQL ; seul `src/shared/` ouvre les connexions et les transactions (pool `pg`, `withTransaction`) ([ADR 0002](../adr/0002-sql-in-features-db-in-shared.md)).
- Seul `src/shared/notifications/` parle au service d'e-mail. Le canal (SMS, push) doit pouvoir changer sans toucher aux règles métier.
- La libération d'une réservation et la réémission d'une attestation par `monitoring` passent par des fonctions exposées dans `src/shared/`. `expire-batches` passe les lots à `EXPIRED` via `src/shared/`.
- Tout écart à cette arborescence se signale à l'utilisateur.

## Construction de l'application

- Une fonction construit l'application Express à partir de ses dépendances : base, notifications, horloge. Le serveur réel lui passe le pool `pg`, le transport SMTP et l'heure système ; les tests passent une base de test, un transport en mémoire et une horloge contrôlée.
- La tâche du planificateur est une fonction qui reçoit la même base et la même horloge ; le serveur la lance toutes les heures.
- Toute règle qui dépend de l'heure lit l'horloge injectée, jamais `Date.now()` ni `now()` SQL.

## Autres principes

- Monolithe : application web, serveur, base. Pas de microservices ni d'orchestration.
- Le territoire est une donnée (`territory`) : **aucun lieu codé en dur**.
- Un commerce multi-sites a un compte par site. Pas de table de points de collecte ; elle devra pouvoir s'ajouter sans refondre lots ni réservations.
- Sessions stockées en base (table `session`), pour qu'un redémarrage ne déconnecte personne.
- Réponses en HTML (rendu serveur), pas en JSON.
- Le seul système externe est le service d'e-mail. Le Conseil départemental n'a ni compte ni accès : la Coordination lui transmet l'export des indicateurs hors plateforme.
- Paramètres par variables d'environnement, avec un fichier d'exemple sans secret : connexion à la base, `MAIL_FROM` et SMTP, durée de session (30 min par défaut), taille de page du suivi (50 par défaut), identifiants du premier `COORDINATOR`.
