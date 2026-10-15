-- One-off data fix (already applied to prod): San Mateo Track (CFVEW) and Orange
-- Lutheran Basketball (NA3DS) are native club stores that were inserted with a
-- stray OMG sale code, which hid them from the Club Webstores list. Neither has an
-- omg_stores row or any orders. The lasting guard is
-- 20261015150000_webstore_omg_code_only_on_omg.sql.
update webstores
set omg_sale_code = null
where store_code in ('CFVEW', 'NA3DS')
  and source = 'webstore'
  and status = 'draft';
