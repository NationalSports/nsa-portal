INSERT INTO deco_vendors (id, name, is_active, created_at)
VALUES ('dv_new_star_embroidery', 'New Star Embroidery', true, NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
