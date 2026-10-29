# Sécurité et RGPD

## Contrôle d'accès

- Contrôle d'accès **par profil sur chaque page et chaque route**, centralisé dans `src/shared/`.
- Action sans session → **401** ; page sans session → redirection vers la connexion ; autre profil ou compte non `ACTIVE` → **403**. Ces contrôles ont lieu avant toute transaction.
- Cloisonnement des données : un commerce n'accède qu'à ses lots et à ses attestations ; une association qu'à ses réservations et à ses collectes. Toujours filtrer par l'`id` du compte en session, jamais par un identifiant fourni par le client.
- **Tests d'accès par profil obligatoires** pour chaque route.

## Mots de passe et sessions

- Mots de passe hachés avec **scrypt** de `node:crypto` (sans dépendance) ; Argon2 ou bcrypt seraient aussi acceptables. Jamais en clair.
- Sessions côté serveur, en table `session`, expirées après **30 min** d'inactivité par défaut (configurable) ; la tâche horaire d'expiration les purge.
- Cookie de session `HttpOnly`, `SameSite=Lax`, `Secure` en production.
- Protection CSRF par jeton synchronisé, stocké dans la session et présent dans chaque formulaire, sans dépendance. Avant la connexion, une session anonyme (sans `account_id`) porte le jeton ; la connexion crée une nouvelle session avec un nouveau `sid` (contre la fixation de session).
- 5 échecs de connexion en 15 min pour un même e-mail → connexion refusée pendant 15 min (réponse **429**, même message que l'e-mail existe ou non ; détail dans [business-rules.md](business-rules.md#comptes-accounts)). Les tentatives pour un même e-mail sont traitées une par une (verrou `pg_advisory_xact_lock`), pour qu'une rafale de requêtes ne teste pas plus de 5 mots de passe. Un e-mail inconnu est vérifié contre un faux hash, pour que le temps de réponse ne révèle pas son existence.

## Injection

- Requêtes SQL **paramétrées** uniquement.
- Abonnement aux notifications : le serveur envoie une requête à l'adresse (`endpoint`) fournie par le navigateur. Seuls les services de push connus sont acceptés (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.push.apple.com`, `*.notify.windows.com`), en HTTPS, sinon **400** : un abonnement forgé ne peut pas faire appeler un autre serveur.
- HTML rendu côté serveur : échapper toute donnée utilisateur à l'affichage.

## Dépendances

- Toute nouvelle dépendance est **justifiée par écrit au moment de l'ajout**, dans la description de la PR.
- Préférer la bibliothèque standard de Node.

## Dépôt

- Le dépôt GitHub est **public**. N'y mettre **ni mot de passe, ni clé, ni donnée personnelle**.
- Configuration sensible dans des variables d'environnement hors dépôt, avec un fichier d'exemple sans secret. La clé privée VAPID (`VAPID_PRIVATE_KEY`) en fait partie : une paire par installation, générée par `pnpm exec web-push generate-vapid-keys`.
- Données de démonstration **fictives** uniquement.

## RGPD

- **Minimisation** : ne collecter que les champs prévus. Pas de compte de bénévole, seulement leur prénom (`reserved_by_name`, `collected_by_name`).
- Échanges chiffrés en TLS 1.2 ou 1.3.
- Hébergement des données (base, sauvegardes, service d'e-mail) **en France ou dans l'Union européenne** (exigence du commanditaire, voir [context.md](context.md#contraintes-brief--23)).
- Notifications push : elles transitent par le service de push du navigateur (Google, Apple, Mozilla, Microsoft), hors de cet hébergement. Leur contenu est chiffré pour l'appareil (RFC 8291) : ces services voient passer un message illisible et l'adresse de l'appareil, pas son contenu. Aucune notification n'est envoyée sans l'autorisation donnée par l'utilisateur dans son navigateur. Pas de publicité : uniquement des alertes de service ([ADR 0003](../adr/0003-push-notifications-instead-of-email.md)).
- Droits d'accès et de suppression traités **manuellement** par la Coordination, sur demande par e-mail (aucune fonctionnalité dans l'application) :
  - accès : requêtes SQL documentées dans le README (compte, lots, réservations, appareils abonnés) ;
  - suppression : script d'anonymisation documenté dans le README (voir [data-model.md](data-model.md#anonymisation)).

## Traçabilité

Les corrections et annulations sont tracées (qui, quand, motif). Côté association, « qui » = le compte et le prénom du bénévole.
