-- Ship-to address on the main vendors table so a vendor's address can be entered
-- on the Vendors page and reused by decoration / drop-ship POs (Manual Ship).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS zip text;

-- Link each decoration vendor to its supply-vendor record. Manual Ship falls back
-- to this vendor's address when the decorator has no address of its own.
ALTER TABLE deco_vendors ADD COLUMN IF NOT EXISTS vendor_id text;

-- Seed links: exact match after stripping case/punctuation/spaces
-- (covers BYOG, Frontier, GraphiC323, JM Branding, Olympic, Pacific Embroidery, WePrintIt).
UPDATE deco_vendors dv
SET vendor_id = v.id
FROM vendors v
WHERE dv.vendor_id IS NULL
  AND regexp_replace(lower(dv.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v.name), '[^a-z0-9]', '', 'g');

-- Seed links for the two names that differ by more than punctuation.
UPDATE deco_vendors SET vendor_id = (SELECT id FROM vendors WHERE name = 'Silver Screen Printing & Embroidery' LIMIT 1)
  WHERE name = 'Silver Screen' AND vendor_id IS NULL;
UPDATE deco_vendors SET vendor_id = (SELECT id FROM vendors WHERE name = 'Pacific Screen Printing' LIMIT 1)
  WHERE name = 'Pacific Screen Print' AND vendor_id IS NULL;
