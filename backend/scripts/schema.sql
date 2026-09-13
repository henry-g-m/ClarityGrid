-- ClarityGrid synthetic-data schema.
-- Relational lookup tables (locations, tariffs) + append-mostly time-series
-- tables (price_series, usage_series), per PLAN.md section 7.
--
-- Tariff charge structure (customer/energy/demand, each with tiers and an
-- optional time_period) is stored as JSONB rather than fully normalized --
-- it's nested and only ever read/written whole, so a charges table with a
-- basis/range/time_period per row would add join complexity with no
-- query-pattern benefit at this scale.

CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL DEFAULT 0,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    iso TEXT NOT NULL,
    utility TEXT NOT NULL,
    price_level DOUBLE PRECISION NOT NULL,
    map_x DOUBLE PRECISION NOT NULL,
    map_y DOUBLE PRECISION NOT NULL
);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS ordinal INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tariffs (
    location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    blurb TEXT NOT NULL,
    charges JSONB NOT NULL,
    PRIMARY KEY (location_id, id)
);

CREATE TABLE IF NOT EXISTS price_series (
    location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (location_id, ts)
);

CREATE TABLE IF NOT EXISTS usage_series (
    location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    building_type TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    kwh DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (location_id, building_type, ts)
);

CREATE INDEX IF NOT EXISTS idx_usage_series_location_building
    ON usage_series (location_id, building_type, ts);
