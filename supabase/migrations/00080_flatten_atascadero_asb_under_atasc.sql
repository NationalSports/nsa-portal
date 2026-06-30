-- Reparent Atascadero High School - ASB (ATAA) and all of its current sub-customers
-- to be direct sub-customers of Atascadero High School (ATASC).

UPDATE customers
SET parent_id = 'c-inv-atascadero-high-school',
    updated_at = NOW()
WHERE id = 'c-ns-4867'
   OR parent_id = 'c-ns-4867';
