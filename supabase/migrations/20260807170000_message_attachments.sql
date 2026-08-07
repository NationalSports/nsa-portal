-- Image / PDF attachments on internal messages.
-- Shape: [{"url":"https://res.cloudinary.com/...","name":"proof.pdf","type":"application/pdf","size":123456}]
-- Files live in Cloudinary (same path art files use); this column only holds the references.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachments jsonb;
