INSERT INTO deco_vendors (id, name, is_active, created_at)
VALUES ('dv_avery_dennison', 'Avery Dennison', true, NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
