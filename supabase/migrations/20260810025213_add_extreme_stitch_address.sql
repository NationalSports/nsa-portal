-- Extreme Stitch ship-to address so their POs stop falling back to the NSA dock.
-- Avery Dennison intentionally has no address: they supply DTF transfers that
-- ship to NSA for in-house application, so the dock fallback is correct.
UPDATE deco_vendors
SET address_line1 = '7250 Auburn Blvd # F',
    city = 'Citrus Heights',
    state = 'CA',
    zip = '95610'
WHERE id = 'dv_extreme_stitch';
