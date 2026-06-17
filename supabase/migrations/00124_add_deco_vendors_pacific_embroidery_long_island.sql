-- Add Pacific Embroidery and Long Island Print Co as outside decoration vendors

INSERT INTO deco_vendors (id, name, is_active, created_at) VALUES
  ('dv_pacific_embroidery', 'Pacific Embroidery', true, NOW()::TEXT),
  ('dv_long_island_print', 'Long Island Print Co', true, NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
