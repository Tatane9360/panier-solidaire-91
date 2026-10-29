-- Appareils abonnés aux notifications push, un par navigateur. Un compte d'association
-- est partagé : plusieurs appareils peuvent être abonnés au même compte.
-- `endpoint` : adresse fournie par le service de push du navigateur ; `p256dh` et `auth` :
-- clés publiques de l'appareil, qui servent à chiffrer le contenu pour lui seul.
CREATE TABLE push_subscription (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES account (id),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX push_subscription_account_id ON push_subscription (account_id);

-- L'alerte « Nouveau lot disponible » passe par le push : s'abonner ou se désabonner
-- se fait par appareil, la préférence par compte n'a plus d'usage (ADR 0003).
ALTER TABLE account DROP COLUMN notify_new_batches;
