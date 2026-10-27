CREATE TABLE territory (
  id serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE account (
  id serial PRIMARY KEY,
  territory_id integer NOT NULL REFERENCES territory (id),
  role text NOT NULL CHECK (role IN ('STORE', 'ASSOCIATION', 'COORDINATOR')),
  status text NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'REFUSED', 'ANONYMIZED')),
  email text NOT NULL UNIQUE,
  password_hash text,
  organization_name text NOT NULL,
  address text NOT NULL,
  cold_capacity text[] NOT NULL DEFAULT '{AMBIENT}'
    CHECK (cold_capacity <@ ARRAY['AMBIENT', 'CHILLED', 'FROZEN']),
  notify_new_batches boolean NOT NULL DEFAULT true,
  decided_by integer REFERENCES account (id),
  decided_at timestamptz,
  refusal_reason text,
  created_at timestamptz NOT NULL
);

-- account_id est nul pour une session anonyme : elle porte le jeton CSRF
-- des formulaires affichés avant la connexion.
CREATE TABLE session (
  sid text PRIMARY KEY,
  account_id integer REFERENCES account (id),
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
