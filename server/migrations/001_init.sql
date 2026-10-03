-- MILES · the first schema.
-- Distances are metres, durations seconds, areas square metres, as in the app.
-- Times are timestamptz here and epoch milliseconds on the wire.

-- --- Runners -----------------------------------------------------------------

create table users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  email_norm        text not null unique,          -- lower(trim(email)), what logins match on
  password_hash     text not null,
  name              text not null,
  initials          text not null,
  friend_code       text not null unique,          -- how a friend adds you
  prefs             jsonb not null default '{}'::jsonb,
  trial_ends_at     timestamptz,                   -- one Pro trial per account, ever
  banned_at         timestamptz,
  ban_reason        text,
  terms_accepted_at timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- A session is a random token the app holds; only its SHA-256 is stored, so a
-- leaked database cannot be replayed as anyone.
create table sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    bytea not null unique,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index sessions_user on sessions (user_id);

create table password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  code_hash   bytea not null,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index password_resets_user on password_resets (user_id, created_at desc);

-- --- Races ---------------------------------------------------------------------
-- Declared before runs, which point at the race they were run in.

create table races (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references users(id) on delete cascade,
  target      double precision not null,
  created_at  timestamptz not null default now()
);

create table race_entrants (
  race_id     uuid not null references races(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  invited_at  timestamptz not null default now(),
  primary key (race_id, user_id)
);
create index race_entrants_user on race_entrants (user_id);

-- --- Runs ----------------------------------------------------------------------

create table runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  client_id     text not null,                    -- the app's own id, so a retried upload is the same run
  kind          text not null check (kind in ('free', 'territory', 'race')),
  title         text not null,
  started_at    timestamptz not null,
  distance      double precision not null,
  duration      double precision not null,
  elevation     double precision,                 -- null: the phone gave no altitude
  route         jsonb not null,
  splits        jsonb not null default '[]'::jsonb,
  loop_closed   boolean not null default false,
  claimed_area  double precision not null default 0,
  source        text not null,
  race_id       uuid references races(id) on delete set null,
  target        double precision,
  place         int,                              -- the app calls this `placing`, a reserved word here
  field_size    int,
  finished      boolean,
  results       jsonb,
  created_at    timestamptz not null default now(),
  unique (user_id, client_id)
);
create index runs_user_started on runs (user_id, started_at desc);

create table kudos (
  run_id      uuid not null references runs(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (run_id, user_id)
);

-- --- Territory -----------------------------------------------------------------
-- `polygon` is the loop as it was run and never changes; `pieces` and `area`
-- are what is still held once every later claim has been cut out of it. Both
-- are worked out by the app's own land.js, run here on the server.

create table claims (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  run_id         uuid references runs(id) on delete cascade,
  claimed_at     timestamptz not null,
  polygon        jsonb not null,
  pieces         jsonb not null default '[]'::jsonb,
  area           double precision not null default 0,
  original_area  double precision not null,
  min_lat        double precision not null,
  min_lng        double precision not null,
  max_lat        double precision not null,
  max_lng        double precision not null,
  -- Postgres's own box type and a GiST index answer "what overlaps this
  -- view" without PostGIS.
  bounds         box generated always as (box(point(min_lng, min_lat), point(max_lng, max_lat))) stored,
  label          text,                             -- Supporter: your name for it
  color          text,                             -- Supporter: your colour for it
  created_at     timestamptz not null default now()
);
create index claims_bounds on claims using gist (bounds);
create index claims_user on claims (user_id, claimed_at desc);
create unique index claims_run on claims (run_id) where run_id is not null;

-- One row per bite: which claim took how much of which, and when. Replayed in
-- full whenever the claims around them change.
create table takes (
  victim_claim_id  uuid not null references claims(id) on delete cascade,
  taker_claim_id   uuid not null references claims(id) on delete cascade,
  victim_user_id   uuid not null references users(id) on delete cascade,
  taker_user_id    uuid not null references users(id) on delete cascade,
  area             double precision not null,
  at               timestamptz not null,
  primary key (victim_claim_id, taker_claim_id)
);
create index takes_taker on takes (taker_user_id, at);
create index takes_victim on takes (victim_user_id);

-- --- Crews -----------------------------------------------------------------------

create table crews (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  tagline         text not null default '',
  color           text not null,
  photo           text,                            -- a small JPEG data URL
  home_lat        double precision not null,
  home_lng        double precision not null,
  schedule        jsonb not null,                  -- { days, time, spot }
  open_join       boolean not null default true,
  xp              int not null default 0,
  missions_done   int not null default 0,
  mission         jsonb,                           -- { week, key, type, heads, target, xp, setAt, completedAt }
  founded_at      timestamptz not null default now()
);
create index crews_home on crews (home_lat, home_lng);

create table crew_members (
  crew_id    uuid not null references crews(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       text not null check (role in ('leader', 'pacer', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create unique index crew_members_one_crew on crew_members (user_id);
create unique index crew_members_one_leader on crew_members (crew_id) where role = 'leader';

create table crew_requests (
  crew_id  uuid not null references crews(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  at       timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index crew_requests_user on crew_requests (user_id);

create table crew_notices (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references crews(id) on delete cascade,
  author_id   uuid not null references users(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now(),
  hidden_at   timestamptz
);
create index crew_notices_crew on crew_notices (crew_id, created_at desc);

-- --- Friends and blocks ------------------------------------------------------------
-- A friendship is stored both ways round, so "my friends" is one index lookup.

create table friendships (
  user_id     uuid not null references users(id) on delete cascade,
  friend_id   uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table blocks (
  user_id     uuid not null references users(id) on delete cascade,
  blocked_id  uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);

-- --- Moderation ----------------------------------------------------------------------

create table reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references users(id) on delete set null,
  target_type  text not null check (target_type in ('user', 'crew', 'notice', 'run', 'claim')),
  target_id    text not null,
  reason       text not null,
  note         text,
  status       text not null default 'open' check (status in ('open', 'resolved')),
  resolution   text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index reports_open on reports (status, created_at);

-- --- Payments ------------------------------------------------------------------------
-- What the store says a runner has paid for. Written by the RevenueCat webhook
-- (or by hand, for an App Review account); read by every Pro gate.

create table entitlements (
  user_id      uuid primary key references users(id) on delete cascade,
  plan         text not null,
  tier         text not null check (tier in ('supporter', 'pro')),
  expires_at   timestamptz,
  will_renew   boolean not null default true,
  source       text not null,
  store        text,
  product_id   text,
  updated_at   timestamptz not null default now()
);

create table billing_events (
  id           text primary key,
  user_id      uuid,
  type         text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);
