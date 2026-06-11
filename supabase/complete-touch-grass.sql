alter table public.projects
  drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in ('open', 'completed', 'withdrawn'));

update public.projects
set
  status = 'completed',
  withdraw_note = ''
where id = '18b7ce03-0545-4aa5-89da-50a4c944ddbf'
  and title = 'I need to touch grass'
  and contract_version = 'v1';
