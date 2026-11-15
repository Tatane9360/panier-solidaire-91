-- Corrections et annulations d'un lot par la Coordination : une ligne par champ modifié.
-- reason est facultatif pour une correction, obligatoire (côté application) pour une annulation.
CREATE TABLE batch_history (
  id serial PRIMARY KEY,
  batch_id integer NOT NULL REFERENCES batch (id),
  changed_by integer NOT NULL REFERENCES account (id),
  changed_at timestamptz NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  reason text
);

CREATE INDEX batch_history_batch_id ON batch_history (batch_id);
