# Accessibilité, mobile et performance

## Accessibilité

- Parcours principaux conformes au **RGAA 4.1.2** (exigence du financeur).
- Tailwind ne fournit aucun composant : **la conformité dépend du HTML écrit à la main**.
  - HTML sémantique (`<button>`, `<label for>`, `<fieldset>`/`<legend>` pour les cases de froid, titres hiérarchisés, `lang="fr"`) ;
  - navigation complète au clavier, focus visible ;
  - messages d'erreur de formulaire reliés au champ et annoncés ;
  - contrastes suffisants ;
  - pas d'information portée par la couleur seule (statuts, froid).
- Ne pas utiliser le DSFR (réservé à l'administration).

## Écrans et terminaux

| Écran | Profil | Terminal |
|---|---|---|
| Déclarer un lot | Commerce | smartphone |
| Lots disponibles et réservation | Association | smartphone |
| Suivi de tous les lots | Coordination | ordinateur |
| Produire une attestation | Coordination | ordinateur |

Tous les écrans Commerce et Association sont conçus d'abord pour le mobile.

## Ancien smartphone

- Doit fonctionner sur un **iPhone bloqué sous iOS 15** (6s, 7, SE 1re génération) **ou** un **Android 10** avec Chrome à jour. La Coordination utilise un ordinateur.
- Conséquences : Tailwind **v3.4** (pas v4) ; éviter le CSS et le JavaScript non pris en charge par Safari 15.
- Utilisation dans le navigateur ; l'installation (PWA) reste facultative. Pas de store.
- **Notifications push** : seule fonction qui exige plus qu'iOS 15. Sur iPhone : iOS 16.4 ou plus récent, et application ajoutée à l'écran d'accueil ; sur Android 10 : Chrome à jour. Sans elles, tous les écrans fonctionnent, mais l'appareil ne reçoit pas d'alerte ([ADR 0003](../adr/0003-push-notifications-instead-of-email.md)). Le script de l'encadré détecte la prise en charge : jamais d'erreur visible sur un appareil qui ne l'a pas.
- Encadré « Notifications » : boutons de taille tactile, changement d'état annoncé par une zone `role="status"`.
- Service worker minimal : notifications push, ressources statiques et page hors ligne, jamais de page de données.

## Ergonomie

- Déclaration d'un lot : **≤ 3 actions de navigation** depuis l'accueil du commerce (« trois clics, sinon j'arrête »), moins d'une minute.

## Performance

- Réponse **< 2 s** à 35 lots/h (voir [testing-quality.md](testing-quality.md#charge)).
- Pages légères, rendu serveur, JavaScript client minimal.
- Liste de suivi de la Coordination paginée (8 500 lots par an visés).
