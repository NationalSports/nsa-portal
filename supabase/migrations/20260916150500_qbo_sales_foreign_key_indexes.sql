-- Cover service-run foreign keys so cleanup and run-history joins stay indexed.
create index if not exists qbo_sales_manual_review_first_run
  on public.qbo_sales_manual_reviews(first_seen_run_id);

create index if not exists qbo_sales_manual_review_last_run
  on public.qbo_sales_manual_reviews(last_seen_run_id);

create index if not exists qbo_sales_source_claims_run
  on public.qbo_sales_source_claims(run_id);

create index if not exists qbo_oauth_refresh_claims_run
  on public.qbo_oauth_refresh_claims(run_id);
