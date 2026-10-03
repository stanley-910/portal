-- Legs with a booking in progress, so the scheduled sweep (/api/booking/expire) knows which rooms to check without
-- opening every trip. Written by the server when a leg is settled, removed when it is booked or back in planning.
create table if not exists public.booking_active (
  room_id text not null,
  leg_id text not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, leg_id)
);
alter table public.booking_active enable row level security;
