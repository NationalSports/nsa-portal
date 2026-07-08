INSERT INTO deco_vendors (id, name, is_active, vendor_id, created_at)
VALUES ('dv_astra_sport', 'Astra Sport', true, 'ns_4080', NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
