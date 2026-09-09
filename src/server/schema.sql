CREATE SCHEMA IF NOT EXISTS outreach;
REVOKE ALL ON SCHEMA outreach FROM PUBLIC;

CREATE TABLE IF NOT EXISTS outreach.campaigns (
  id uuid PRIMARY KEY, name text NOT NULL, deletion_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS outreach.assignments (
  id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES outreach.campaigns ON DELETE CASCADE,
  name text NOT NULL, event_name text NOT NULL, event_ends_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS outreach.households (
  id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES outreach.campaigns ON DELETE CASCADE,
  building_id uuid NOT NULL, address text NOT NULL, unit text NOT NULL,
  suppressed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS outreach.people (
  id uuid PRIMARY KEY, household_id uuid NOT NULL REFERENCES outreach.households ON DELETE CASCADE,
  first_name text NOT NULL, last_name text NOT NULL
);
CREATE TABLE IF NOT EXISTS outreach.memberships (
  assignment_id uuid REFERENCES outreach.assignments ON DELETE CASCADE,
  household_id uuid REFERENCES outreach.households ON DELETE CASCADE,
  position integer NOT NULL, PRIMARY KEY (assignment_id, household_id)
);
CREATE TABLE IF NOT EXISTS outreach.credentials (
  token_hash text PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES outreach.assignments ON DELETE CASCADE,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS outreach.operations (
  id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES outreach.assignments ON DELETE CASCADE,
  payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outreach.visits (
  id uuid PRIMARY KEY, household_id uuid NOT NULL REFERENCES outreach.households ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE REFERENCES outreach.operations ON DELETE CASCADE,
  latest_operation_id uuid NOT NULL REFERENCES outreach.operations,
  result text NOT NULL CHECK(result IN ('resident','other','no_answer','inaccessible','declined'))
);
CREATE TABLE IF NOT EXISTS outreach.help_requests (
  id uuid PRIMARY KEY, visit_id uuid NOT NULL REFERENCES outreach.visits ON DELETE CASCADE,
  person_id uuid REFERENCES outreach.people ON DELETE CASCADE,
  phone text NOT NULL, consent boolean NOT NULL,
  arrangement text NOT NULL,
  status text NOT NULL DEFAULT 'New' CHECK(status IN ('New', 'In progress', 'Resolved')),
  CHECK(phone = '' OR consent)
);
CREATE TABLE IF NOT EXISTS outreach.corrections (
  id uuid PRIMARY KEY, visit_id uuid NOT NULL REFERENCES outreach.visits ON DELETE CASCADE,
  person_id uuid REFERENCES outreach.people ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('rents','moved','deceased','address')),
  CHECK(kind NOT IN ('moved','deceased') OR person_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS outreach.building_attempts (
  operation_id uuid PRIMARY KEY REFERENCES outreach.operations ON DELETE CASCADE,
  building_id uuid NOT NULL, reason text NOT NULL
);
