-- Attestation de don : émise pour un commerce et une période, jamais modifiée.
-- Une attestation remplacée garde son contenu ; replaced_by pointe vers la nouvelle.
CREATE TABLE donation_certificate (
  id serial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  store_id integer NOT NULL REFERENCES account (id),
  issued_by integer NOT NULL REFERENCES account (id),
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_start <= period_end),
  total_weight_kg numeric NOT NULL,
  total_value_eur numeric NOT NULL,
  issued_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ISSUED', 'REPLACED')),
  replaced_by integer REFERENCES donation_certificate (id)
);

CREATE INDEX donation_certificate_store_id ON donation_certificate (store_id);

-- Nature, quantité, poids et valeur sont figés à l'émission : une correction ultérieure du lot ne change pas l'attestation.
CREATE TABLE certificate_batch (
  certificate_id integer NOT NULL REFERENCES donation_certificate (id),
  batch_id integer NOT NULL REFERENCES batch (id),
  nature text NOT NULL,
  quantity integer NOT NULL,
  quantity_unit text NOT NULL,
  weight_kg numeric NOT NULL,
  value_eur numeric NOT NULL,
  PRIMARY KEY (certificate_id, batch_id)
);

CREATE INDEX certificate_batch_batch_id ON certificate_batch (batch_id);
