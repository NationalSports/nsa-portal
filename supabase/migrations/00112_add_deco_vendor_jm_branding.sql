-- Add JM Branding as an outside decoration vendor

INSERT INTO deco_vendors (id, name, is_active, created_at) VALUES
  ('dv_jm_branding', 'JM Branding', true, NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
