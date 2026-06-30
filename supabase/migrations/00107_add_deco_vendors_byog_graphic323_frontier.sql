-- Add BYOG Screenprinting, GraphiC323, and Frontier Screen Printing as outside decoration vendors

INSERT INTO deco_vendors (id, name, is_active, created_at) VALUES
  ('dv_byog_screenprinting', 'BYOG Screenprinting', true, NOW()::TEXT),
  ('dv_graphic323', 'GraphiC323', true, NOW()::TEXT),
  ('dv_frontier_screen', 'Frontier Screen Printing', true, NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
