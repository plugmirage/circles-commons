alter table public.projects
  add column if not exists contract_version text not null default 'v1';

alter table public.projects
  add column if not exists vault_address text;

alter table public.projects
  drop constraint if exists projects_contract_version_check;

alter table public.projects
  add constraint projects_contract_version_check
  check (contract_version in ('v1', 'v2'));

update public.projects
set contract_version = 'v1'
where contract_version is null;
