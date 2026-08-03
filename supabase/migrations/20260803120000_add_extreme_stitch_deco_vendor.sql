INSERT INTO deco_vendors (id, name, is_active, created_at)
VALUES ('dv_extreme_stitch', 'Extreme Stitch', true, NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
