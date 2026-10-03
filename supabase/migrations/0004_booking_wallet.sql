-- What a person keeps between bookings (docs/booking/README.md): their traveller details, sealed with
-- BOOKING_ENCRYPTION_KEY, and the Stripe customer their saved cards hang off. Keyed by person id (an account or a
-- guest). Idempotent; RLS on with no policies, so only the server's secret key reads or writes them.

create table if not exists public.traveller_profiles (
  person_id text primary key,
  sealed text not null,
  updated_at timestamptz not null default now()
);
alter table public.traveller_profiles enable row level security;

create table if not exists public.payment_customers (
  person_id text primary key,
  customer_id text not null,
  updated_at timestamptz not null default now()
);
alter table public.payment_customers enable row level security;
