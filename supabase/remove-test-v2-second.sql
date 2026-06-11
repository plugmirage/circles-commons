delete from public.referral_visits
where project_id = '1de923c2-92f7-4874-bf0f-9e82963de375';

delete from public.projects
where id = '1de923c2-92f7-4874-bf0f-9e82963de375'
  and title = 'test v2 second'
  and contract_version = 'v2'
  and lower(vault_address) = lower('0x275639E3fbce00Fd0AEF5F6fCfE3d38AD99999f7');
