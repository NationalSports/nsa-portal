-- Supplier authorization for All School must not enable ordinary Team Shop POs.
alter table public.teamshop_auto_po_settings
  add column all_school_auto_submit_enabled boolean not null default false;
do $$ declare d text; f regprocedure; begin
  foreach f in array array[
    'public.plan_all_school_purchase(uuid,text,text,bigint[],text,boolean,text,bigint,text,jsonb)'::regprocedure,
    'public.claim_all_school_po_submission(uuid,uuid)'::regprocedure,
    'public.promote_all_school_regular_purchase(uuid)'::regprocedure
  ] loop
    d:=pg_get_functiondef(f);
    if position('auto_submit_enabled' in d)=0 then raise exception 'Missing supplier gate in %',f; end if;
    execute replace(d,'auto_submit_enabled','all_school_auto_submit_enabled');
  end loop;
end $$;
