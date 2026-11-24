create table if not exists public.precision_scalper_observations (
 ticker text primary key, symbol text not null, side text not null check(side in ('yes','no')), ask numeric not null, bid numeric not null, seconds_left numeric not null, observed_at timestamptz not null, close_at timestamptz not null, result text check(result in ('yes','no')), settled_at timestamptz
);
alter table public.precision_scalper_observations enable row level security;
revoke all on public.precision_scalper_observations from anon, authenticated;
grant select, insert, update on public.precision_scalper_observations to service_role;
create index if not exists precision_scalper_pending_idx on public.precision_scalper_observations(close_at) where result is null;
