-- Recompute Adidas locker-room item costs using floor(retail_price * 0.4125)
-- (retail × 0.55 × 0.75, floored to the nearest cent).
-- These are the 413 items uploaded with brand='Adidas' and color='CUSTOM'.
-- Previous values were rounded; this normalizes them to floor.
UPDATE public.products
   SET nsa_cost   = floor(retail_price * 0.4125 * 100) / 100,
       updated_at = now()
 WHERE brand = 'Adidas'
   AND color = 'CUSTOM'
   AND retail_price IS NOT NULL
   AND nsa_cost <> floor(retail_price * 0.4125 * 100) / 100;
