-- ═══════════════════════════════════════════════════════════
-- Quarto Poll Extension v2 — Supabase Schema
-- Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- 1. Poll sessions
create table if not exists poll_sessions (
  poll_id        text primary key,
  status         text not null default 'idle',   -- idle | open | closed
  poll_type      text not null default 'mc',      -- mc | free
  question       text,
  options        text,             -- JSON array (mc only)
  correct_answer text,             -- plain text (free response only)
  correct_indices text,            -- JSON array of ints e.g. [1,3] (MC only)
  timer_secs     integer default 0,
  timer_end      timestamptz,      -- absolute end time when running
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- 2. Poll votes (handles both MC and free response)
create table if not exists poll_votes (
  id             bigserial primary key,
  poll_id        text not null references poll_sessions(poll_id) on delete cascade,
  voter_name     text not null,
  option_index   integer,          -- MC only (null for free response)
  response_text  text,             -- free response only (null for MC)
  voted_at       timestamptz default now(),
  unique (poll_id, voter_name)     -- one submission per person per poll
);

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists idx_poll_votes_poll   on poll_votes(poll_id);
create index if not exists idx_poll_sessions_upd on poll_sessions(updated_at);

-- ── Row Level Security ────────────────────────────────────────
alter table poll_sessions enable row level security;
alter table poll_votes     enable row level security;

-- Anyone can read sessions (needed for status checks)
create policy "public read poll_sessions"
  on poll_sessions for select using (true);

-- Anyone can upsert sessions (admin password enforced in frontend)
create policy "public insert poll_sessions"
  on poll_sessions for insert with check (true);

create policy "public update poll_sessions"
  on poll_sessions for update using (true);

-- Anyone can read votes (needed for results display)
create policy "public read poll_votes"
  on poll_votes for select using (true);

-- Anyone can submit a vote
create policy "public insert poll_votes"
  on poll_votes for insert with check (true);

-- ── Realtime ─────────────────────────────────────────────────
-- Enable realtime for poll_sessions so status and timer changes
-- are broadcast to all connected audience members instantly.
alter publication supabase_realtime add table poll_sessions;

-- ═══════════════════════════════════════════════════════════
-- Migration: if upgrading from v1, run these:
-- ═══════════════════════════════════════════════════════════
-- alter table poll_sessions add column if not exists poll_type      text default 'mc';
-- alter table poll_sessions add column if not exists correct_answer  text;
-- alter table poll_sessions add column if not exists correct_indices text;
-- alter table poll_sessions add column if not exists timer_secs     integer default 0;
-- alter table poll_sessions add column if not exists timer_end      timestamptz;
-- alter table poll_votes    add column if not exists option_index   integer;
-- alter table poll_votes    add column if not exists response_text  text;
