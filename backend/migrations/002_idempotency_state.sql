-- IDEMPOTENCY KEYS
CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  request_hash  TEXT NOT NULL,
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TRANSFER STATE MACHINE (DB level pe enforce)
CREATE FUNCTION enforce_transfer_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.state = NEW.state THEN
    RETURN NEW;
  END IF;
  IF (OLD.state, NEW.state) NOT IN (
       ('CREATED', 'COMPLETED'),
       ('CREATED', 'FAILED'),
       ('COMPLETED', 'REVERSED')
     ) THEN
    RAISE EXCEPTION 'invalid transfer state transition % -> %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transfer_state_machine
  BEFORE UPDATE OF state ON transfers
  FOR EACH ROW EXECUTE FUNCTION enforce_transfer_transition();