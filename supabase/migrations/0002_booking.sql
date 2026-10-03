-- Booking a leg (docs/booking/README.md): what the server keeps outside the trip room. Idempotent: safe to re-run.
-- Row-level security is on with no policies, so only the server's secret key can read or write these tables.

-- Traveller details, sealed with BOOKING_ENCRYPTION_KEY, kept only until the order exists.
create table if not exists public.booking_travellers (
  room_id text not null,
  leg_id text not null,
  rider_id text not null,
  sealed text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, leg_id, rider_id)
);
alter table public.booking_travellers enable row level security;

-- One row per rider per leg: the card hold or ticket purchase the server trusts.
create table if not exists public.booking_payments (
  room_id text not null,
  leg_id text not null,
  rider_id text not null,
  provider text not null check (provider in ('stripe', 'test')),
  session_id text,
  payment_intent_id text,
  amount numeric(12, 2) not null,
  currency char(3) not null,
  status text not null check (status in ('pending', 'held', 'captured', 'cancelled', 'failed')),
  capture_before timestamptz,
  offer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, leg_id, rider_id)
);
create index if not exists booking_payments_session on public.booking_payments (session_id);
create index if not exists booking_payments_intent on public.booking_payments (payment_intent_id);
alter table public.booking_payments enable row level security;

-- Short leases so a purchase runs once even when a webhook and a return visit race.
create table if not exists public.booking_leases (
  key text primary key,
  expires_at timestamptz not null
);
alter table public.booking_leases enable row level security;
