create table if not exists public.membership_requests (
  community_address text not null,
  member_address text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  primary key (community_address, member_address)
);

alter table public.membership_requests enable row level security;
grant select, insert on table public.membership_requests to anon;

drop policy if exists "membership requests are readable" on public.membership_requests;
create policy "membership requests are readable"
  on public.membership_requests for select using (true);

drop policy if exists "membership requests can be submitted" on public.membership_requests;
create policy "membership requests can be submitted"
  on public.membership_requests for insert with check (status = 'pending');

create table if not exists public.projects (
  community_address text not null,
  id text not null,
  title text not null,
  description text not null,
  location text not null,
  goal numeric not null check (goal > 0),
  milestones jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (community_address, id)
);

alter table public.projects enable row level security;
grant select, insert on table public.projects to anon;

drop policy if exists "projects are readable" on public.projects;
create policy "projects are readable"
  on public.projects for select using (true);

drop policy if exists "projects can be created" on public.projects;
create policy "projects can be created"
  on public.projects for insert with check (true);

insert into public.projects (community_address, id, title, description, location, goal, milestones)
values
  (
    '0x4bec102fc0ded9e5f934f570bed6de1a8bcefdf6',
    'garden',
    'Community garden',
    'Turn an unused courtyard into a shared garden with herbs and raised beds.',
    'Rue des Lilas courtyard',
    50,
    '[{"amount":10,"label":"Tools"},{"amount":25,"label":"First raised bed"},{"amount":50,"label":"Full garden"}]'::jsonb
  ),
  (
    '0x4bec102fc0ded9e5f934f570bed6de1a8bcefdf6',
    'repair-cafe',
    'Monthly repair cafe',
    'Fund tools and spare parts for a monthly neighbor-led repair afternoon.',
    'Commons workshop',
    50,
    '[{"amount":10,"label":"Starter toolkit"},{"amount":25,"label":"Spare parts"},{"amount":50,"label":"Three events"}]'::jsonb
  )
on conflict (community_address, id) do nothing;

create table if not exists public.services (
  community_address text not null,
  id text not null,
  title text not null,
  description text not null,
  provider text not null,
  provider_address text not null,
  duration text not null,
  price numeric not null check (price > 0),
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  primary key (community_address, id)
);

alter table public.services enable row level security;
grant select, insert on table public.services to anon;

drop policy if exists "services are readable" on public.services;
create policy "services are readable"
  on public.services for select using (status = 'active');

drop policy if exists "services can be published" on public.services;
create policy "services can be published"
  on public.services for insert with check (status = 'active');

create table if not exists public.communities (
  address text primary key,
  name text not null,
  description text not null default '',
  kind text not null default 'organization' check (kind in ('organization', 'group')),
  treasury_address text not null default '',
  source text not null default 'created' check (source in ('created', 'activated')),
  created_at timestamptz not null default now()
);

alter table public.communities add column if not exists kind text not null default 'organization' check (kind in ('organization', 'group'));
alter table public.communities add column if not exists treasury_address text not null default '';
alter table public.communities add column if not exists source text not null default 'created' check (source in ('created', 'activated'));
update public.communities set treasury_address = address where treasury_address = '';

alter table public.communities enable row level security;
grant select, insert on table public.communities to anon;

drop policy if exists "communities are readable" on public.communities;
create policy "communities are readable"
  on public.communities for select using (true);

drop policy if exists "communities can be registered" on public.communities;
create policy "communities can be registered"
  on public.communities for insert with check (true);

insert into public.communities (address, name, description, kind, treasury_address, source)
values (
  '0x4bec102fc0ded9e5f934f570bed6de1a8bcefdf6',
  'Commons Lab',
  'A community treasury for funding local projects and useful services with CRC.',
  'organization',
  '0x4bec102fc0ded9e5f934f570bed6de1a8bcefdf6',
  'created'
)
on conflict (address) do nothing;
