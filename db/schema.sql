CREATE TABLE IF NOT EXISTS groups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR' CHECK (currency IN ('PKR', 'USD', 'GBP', 'EUR', 'AED', 'SAR', 'CAD')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (group_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_by BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  split_type TEXT NOT NULL CHECK (split_type IN ('equal', 'exact')),
  expense_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id BIGINT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  share_cents INTEGER NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, member_id)
);

CREATE INDEX IF NOT EXISTS members_group_idx ON members(group_id);
CREATE UNIQUE INDEX IF NOT EXISTS members_group_lower_name_idx ON members(group_id, lower(name));
CREATE INDEX IF NOT EXISTS expenses_group_idx ON expenses(group_id);
CREATE INDEX IF NOT EXISTS expense_shares_member_idx ON expense_shares(member_id);
