-- Une réservation annulée est conservée : cancelled_at la met de côté.
CREATE TABLE reservation (
  id serial PRIMARY KEY,
  batch_id integer NOT NULL REFERENCES batch (id),
  association_id integer NOT NULL REFERENCES account (id),
  reserved_at timestamptz NOT NULL,
  reserved_by_name text NOT NULL,
  collected_by_name text,
  cancelled_by integer REFERENCES account (id),
  cancelled_at timestamptz
);

-- Une seule réservation active par lot, garantie par la base.
CREATE UNIQUE INDEX reservation_active_batch_id ON reservation (batch_id) WHERE cancelled_at IS NULL;
CREATE INDEX reservation_association_id ON reservation (association_id);
