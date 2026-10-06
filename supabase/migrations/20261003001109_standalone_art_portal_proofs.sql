-- Immutable proof snapshots keep customer decisions separate from order approval.
alter table public.standalone_art_requests add column portal_proofs jsonb not null default '[]' check (jsonb_typeof(portal_proofs)='array');

create function public.share_standalone_art_proof(p_id uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r standalone_art_requests; proof jsonb; n integer;
begin
  if auth.uid() is null or not public.is_team_member() then raise exception 'Active staff session required'; end if;
  select * into r from standalone_art_requests where id=p_id for update;
  if not found or r.status <> 'completed' or jsonb_array_length(r.result_files)=0 then raise exception 'Complete the artwork before sharing a proof'; end if;
  n := jsonb_array_length(r.portal_proofs);
  proof := r.portal_proofs->(n-1);
  if proof->>'status' in ('pending','approved') and proof->'files'=r.result_files then return to_jsonb(r); end if;
  proof := jsonb_build_object('version',n+1,'status','pending','files',r.result_files,'shared_at',now(),'shared_by',auth.uid());
  update standalone_art_requests set portal_proofs=portal_proofs||jsonb_build_array(proof),updated_at=now() where id=p_id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.share_standalone_art_proof(uuid) from public,anon;
grant execute on function public.share_standalone_art_proof(uuid) to authenticated;

-- Called only by the server endpoint. Scope is checked again inside the locked transaction.
create function public.decide_standalone_art_proof(p_id uuid,p_alpha_tag text,p_version integer,p_decision text,p_comment text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r standalone_art_requests; proof jsonb; n integer;
begin
  if p_decision is null or p_decision not in ('approve','reject') then raise exception 'Invalid decision'; end if;
  if p_decision='reject' and length(trim(coalesce(p_comment,'')))=0 then raise exception 'Describe the changes needed'; end if;
  if length(coalesce(p_comment,''))>5000 then raise exception 'Comment is too long'; end if;
  select * into r from standalone_art_requests where id=p_id for update;
  if not found or not exists(select 1 from customers c join customers p on (c.id=p.id or c.parent_id=p.id) where c.id=r.customer_id and p.alpha_tag=nullif(trim(p_alpha_tag),'')) then raise exception 'Artwork not in this portal'; end if;
  n := jsonb_array_length(r.portal_proofs);
  proof := r.portal_proofs->(n-1);
  if p_version is null or n=0 or (proof->>'version')::integer<>p_version or proof->>'status'<>'pending' or r.status<>'completed' or proof->'files'<>r.result_files then raise exception 'Proof changed or already reviewed. Refresh to see the latest artwork'; end if;
  proof := proof||jsonb_build_object('status',case when p_decision='approve' then 'approved' else 'changes_requested' end,'comment',trim(coalesce(p_comment,'')),'decided_at',now());
  update standalone_art_requests set portal_proofs=jsonb_set(portal_proofs,array[(n-1)::text],proof),
    status=case when p_decision='reject' then 'requested' else status end,
    instructions=case when p_decision='reject' then instructions||E'\nCustomer changes (proof '||p_version||'): '||trim(p_comment) else instructions end,
    result_files=case when p_decision='reject' then '[]'::jsonb else result_files end,
    completed_at=case when p_decision='reject' then null else completed_at end,updated_at=now()
  where id=p_id;
  return proof;
end $$;
revoke all on function public.decide_standalone_art_proof(uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.decide_standalone_art_proof(uuid,text,integer,text,text) to service_role;
