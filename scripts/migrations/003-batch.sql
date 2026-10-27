CREATE TABLE batch (
  id serial PRIMARY KEY,
  store_id integer NOT NULL REFERENCES account (id),
  nature text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  quantity_unit text NOT NULL,
  weight_kg numeric NOT NULL CHECK (weight_kg > 0),
  value_eur numeric NOT NULL CHECK (value_eur > 0),
  expiry_date date NOT NULL,
  date_type text NOT NULL CHECK (date_type IN ('DLC', 'DDM')),
  pickup_start timestamptz NOT NULL,
  pickup_end timestamptz NOT NULL CHECK (pickup_start < pickup_end),
  cold_requirement text NOT NULL CHECK (cold_requirement IN ('AMBIENT', 'CHILLED', 'FROZEN')),
  status text NOT NULL CHECK (status IN ('DECLARED', 'RESERVED', 'COLLECTED', 'CANCELLED', 'EXPIRED')),
  -- Jeton aléatoire placé dans le formulaire : une double soumission ne crée qu'un lot.
  submission_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  collected_at timestamptz,
  expired_at timestamptz
);

CREATE INDEX batch_store_id ON batch (store_id);
