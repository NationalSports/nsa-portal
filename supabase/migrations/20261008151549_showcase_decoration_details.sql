-- Candidate details live in qa_result alongside the candidate hero. Approval
-- copies the set here atomically with approved_showcase_image_url; regeneration
-- never replaces a shopper-visible image before staff review.
alter table public.webstore_showcase_assets
  add column approved_detail_images jsonb not null default '[]'::jsonb
  check (jsonb_typeof(approved_detail_images) = 'array');
