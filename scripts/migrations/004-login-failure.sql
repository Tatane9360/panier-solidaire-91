-- Échecs de connexion par e-mail, que le compte existe ou non (le blocage ne doit pas le révéler).
-- starts_block marque le 5e échec en 15 minutes : il ouvre un blocage de 15 minutes.
CREATE TABLE login_failure (
  id serial PRIMARY KEY,
  email text NOT NULL,
  failed_at timestamptz NOT NULL,
  starts_block boolean NOT NULL
);

CREATE INDEX login_failure_email_failed_at ON login_failure (email, failed_at);
