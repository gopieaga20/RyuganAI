-- Ryugan AI — Paper Trading Database Schema (PostgreSQL)
-- Run this once to set up your database:
--   psql -U postgres -d trading_app -f init_db.sql

CREATE TABLE IF NOT EXISTS portfolio (
    id          SERIAL PRIMARY KEY,
    capital     NUMERIC(14, 2) NOT NULL DEFAULT 1000000.00,
    used_margin NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    total_pnl   NUMERIC(14, 2) NOT NULL DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS positions (
    id          SERIAL PRIMARY KEY,
    symbol      TEXT        NOT NULL,
    type        TEXT        NOT NULL CHECK (type IN ('LONG', 'SHORT')),
    qty         INTEGER     NOT NULL CHECK (qty > 0),
    entry_price NUMERIC(12, 2) NOT NULL,
    sl          NUMERIC(12, 2) NOT NULL,
    tp          NUMERIC(12, 2) NOT NULL,
    entry_time  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS history (
    id          SERIAL PRIMARY KEY,
    symbol      TEXT        NOT NULL,
    type        TEXT        NOT NULL,
    qty         INTEGER     NOT NULL,
    entry_price NUMERIC(12, 2) NOT NULL,
    exit_price  NUMERIC(12, 2) NOT NULL,
    pnl         NUMERIC(12, 2) NOT NULL,
    reason      TEXT,
    exit_time   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the default portfolio (only if empty)
INSERT INTO portfolio (id, capital, used_margin, total_pnl)
SELECT 1, 1000000.00, 0.00, 0.00
WHERE NOT EXISTS (SELECT 1 FROM portfolio WHERE id = 1);
