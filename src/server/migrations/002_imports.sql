-- Additive: preserve the original fixture walk and every existing offline operation.
CREATE TABLE outreach.imports (
  campaign_id uuid PRIMARY KEY REFERENCES outreach.campaigns ON DELETE CASCADE,
  id uuid NOT NULL UNIQUE,
  source_digest text NOT NULL CHECK(length(source_digest)=64),
  counts jsonb NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outreach.buildings (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES outreach.campaigns ON DELETE CASCADE,
  grouping_key text NOT NULL,
  address text NOT NULL,
  zip text NOT NULL,
  ward text NOT NULL,
  UNIQUE(campaign_id, grouping_key)
);
ALTER TABLE outreach.households ADD COLUMN source_key text;
CREATE UNIQUE INDEX households_source_key ON outreach.households(campaign_id, source_key) WHERE source_key IS NOT NULL;
CREATE TABLE outreach.import_people (
  person_id uuid PRIMARY KEY REFERENCES outreach.people ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES outreach.imports(campaign_id) ON DELETE CASCADE,
  source_id text NOT NULL,
  residence_address text NOT NULL,
  zip text NOT NULL CHECK(zip ~ '^[0-9]{5}$'),
  ward text NOT NULL CHECK(ward IN ('A','B','C','D','E','F')),
  block text NOT NULL,
  lot text NOT NULL,
  qual text NOT NULL,
  property_location text NOT NULL,
  verified_unit text NOT NULL,
  tier text NOT NULL CHECK(tier IN ('1','2')),
  household_key text NOT NULL,
  UNIQUE(campaign_id,source_id)
);
-- The synthetic rehearsal is a fixed fixture selector, never a raw-upload surface.
CREATE TABLE outreach.import_rehearsals (
  campaign_id uuid PRIMARY KEY REFERENCES outreach.campaigns ON DELETE CASCADE,
  end_at timestamptz NOT NULL,
  assignment_id uuid UNIQUE REFERENCES outreach.assignments ON DELETE SET NULL
);
