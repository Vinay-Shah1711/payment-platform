-- ACCOUNTS
CREATE TABLE accounts (
  id             BIGSERIAL PRIMARY KEY,
  owner          TEXT NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  status         TEXT NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  balance        BIGINT NOT NULL DEFAULT 0,          -- paise mein, kabhi float nahi
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE,     -- sirf system account ke liye true
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT balance_non_negative CHECK (allow_negative OR balance >= 0)
);

-- System account (id = 1): isse "virtual paisa" users ko fund hota hai
INSERT INTO accounts (owner, allow_negative) VALUES ('SYSTEM_FUNDING', TRUE);

-- TRANSFERS
CREATE TABLE transfers (
  id              BIGSERIAL PRIMARY KEY,
  from_account_id BIGINT NOT NULL REFERENCES accounts(id),
  to_account_id   BIGINT NOT NULL REFERENCES accounts(id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  state           TEXT NOT NULL DEFAULT 'CREATED'
                  CHECK (state IN ('CREATED', 'COMPLETED', 'FAILED', 'REVERSED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)
);

-- LEDGER (double-entry)
CREATE TABLE ledger_entries (
  id          BIGSERIAL PRIMARY KEY,
  transfer_id BIGINT NOT NULL REFERENCES transfers(id),
  account_id  BIGINT NOT NULL REFERENCES accounts(id),
  direction   TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_account  ON ledger_entries(account_id);
CREATE INDEX idx_ledger_transfer ON ledger_entries(transfer_id);

-- AUDIT LOG
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   BIGINT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RULE 1: ledger aur audit_log immutable (update/delete/truncate block)
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable: % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- RULE 2: har transfer ke liye total debit = total credit (commit ke time check hota hai)
CREATE FUNCTION check_transfer_balanced() RETURNS trigger AS $$
DECLARE
  d BIGINT;
  c BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0),
         COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)
    INTO d, c
    FROM ledger_entries
   WHERE transfer_id = NEW.transfer_id;

  IF d <> c THEN
    RAISE EXCEPTION 'transfer % unbalanced: debit % credit %', NEW.transfer_id, d, c;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_transfer_balanced();