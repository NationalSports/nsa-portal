-- Web logos never persisted on order/estimate art copies: the save whitelist
-- (_artCols) stripped web_logos/web_logo_url, so CustDetail's fan-out and the
-- webstore->SO handoff wrote them in memory and lost them on reload. Same for
-- the webstore-derived decoration fields (web_url/placement/side/color_label/
-- transfer_code) dropped by _decoCols. Add the columns so the whitelists can
-- carry them. All additive + nullable; legacy rows read as null.

alter table so_art_files add column if not exists web_logos jsonb;
alter table so_art_files add column if not exists web_logo_url text;
alter table estimate_art_files add column if not exists web_logos jsonb;
alter table estimate_art_files add column if not exists web_logo_url text;

alter table so_item_decorations add column if not exists web_url text;
alter table so_item_decorations add column if not exists placement text;
alter table so_item_decorations add column if not exists side text;
alter table so_item_decorations add column if not exists color_label text;
alter table so_item_decorations add column if not exists transfer_code text;

alter table estimate_item_decorations add column if not exists web_url text;
alter table estimate_item_decorations add column if not exists placement text;
alter table estimate_item_decorations add column if not exists side text;
alter table estimate_item_decorations add column if not exists color_label text;
alter table estimate_item_decorations add column if not exists transfer_code text;
