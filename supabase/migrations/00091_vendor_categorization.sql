-- 00091_vendor_categorization.sql
-- Add vendor categorization columns and import the full NetSuite vendor list.
-- Each vendor can be flagged as a product vendor (eligible for sales orders /
-- product POs) and/or a decorator (eligible for decoration POs). Both flags
-- default to false so they can be set per-vendor later.

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS netsuite_internal_id text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS is_product_vendor boolean NOT NULL DEFAULT false;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS is_decorator boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS vendors_netsuite_internal_id_key
  ON public.vendors(netsuite_internal_id) WHERE netsuite_internal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendors_is_product_vendor_idx
  ON public.vendors(is_product_vendor) WHERE is_product_vendor;
CREATE INDEX IF NOT EXISTS vendors_is_decorator_idx
  ON public.vendors(is_decorator) WHERE is_decorator;

-- The 10 already-existing vendors are all product vendors (they're API or upload-feed brands).
UPDATE public.vendors SET is_product_vendor=true WHERE id IN ('v1','v2','v3','v4','v5','v6','v7','v8','v1777312659133','v1778884085240');

-- Attach NetSuite internal IDs to existing vendors (manual mapping):
UPDATE public.vendors SET netsuite_internal_id='25' WHERE id='v1';
UPDATE public.vendors SET netsuite_internal_id='3249' WHERE id='v2';
UPDATE public.vendors SET netsuite_internal_id='129' WHERE id='v3';
UPDATE public.vendors SET netsuite_internal_id='128' WHERE id='v4';
UPDATE public.vendors SET netsuite_internal_id='125' WHERE id='v5';
UPDATE public.vendors SET netsuite_internal_id='123' WHERE id='v6';
UPDATE public.vendors SET netsuite_internal_id='36' WHERE id='v8';
UPDATE public.vendors SET netsuite_internal_id='29' WHERE id='v1777312659133';
UPDATE public.vendors SET netsuite_internal_id='88' WHERE id='v1778884085240';

-- Copy emails from the NetSuite CSV onto existing vendors (only if contact_email is currently empty):
UPDATE public.vendors SET contact_email=COALESCE(NULLIF(contact_email,''), 'dgordinier@agron.com') WHERE id='v1777312659133';
UPDATE public.vendors SET contact_email=COALESCE(NULLIF(contact_email,''), 'jmendoza@kwikgoal.com') WHERE id='v1778884085240';

-- Insert remaining vendors from the NetSuite vendor list.
-- New vendors are inserted unmarked — set is_product_vendor/is_decorator per row when you categorize.
INSERT INTO public.vendors (id, name, netsuite_internal_id, contact_email, is_active, is_decorator) VALUES
  ('ns_23', 'A4', '23', NULL, true, false),
  ('ns_27', 'Adidas Golf', '27', NULL, true, false),
  ('ns_3798', 'AER-FLO', '3798', NULL, true, false),
  ('ns_4794', 'Ahava Design', '4794', NULL, true, false),
  ('ns_33', 'All Star Lettering', '33', NULL, true, false),
  ('ns_31', 'All-Star Sporting Goods Products', '31', NULL, true, false),
  ('ns_4326', 'Anytime Signs', '4326', 'ernesto@anytimesigns.com', true, false),
  ('ns_5069', 'Apex', '5069', NULL, true, false),
  ('ns_4080', 'Astra Sport', '4080', 'astrasportgroup@gmail.com', true, false),
  ('ns_34', 'Athletic Connection', '34', NULL, true, false),
  ('ns_35', 'Athletic Specialties', '35', NULL, true, false),
  ('ns_4007', 'Avery Dennison', '4007', NULL, true, false),
  ('ns_37', 'Baden Sports', '37', NULL, true, false),
  ('ns_4632', 'BAW Online', '4632', NULL, true, false),
  ('ns_5133', 'Bell Promo', '5133', 'orders@belpromo.com', true, false),
  ('ns_4949', 'Bison Inc', '4949', 'orderdesk@bisoninc.com', true, false),
  ('ns_43', 'Bownet', '43', NULL, true, false),
  ('ns_4052', 'Boxercraft', '4052', NULL, true, false),
  ('ns_44', 'Branding Out', '44', NULL, true, false),
  ('ns_4076', 'BYOG Screenprinting', '4076', NULL, true, false),
  ('ns_4780', 'Cap America', '4780', NULL, true, false),
  ('ns_48', 'Champion', '48', NULL, true, false),
  ('ns_49', 'Champro', '49', NULL, true, false),
  ('ns_53', 'Cliff Keen', '53', NULL, true, false),
  ('ns_60', 'Diamond Sports', '60', NULL, true, false),
  ('ns_3750', 'Diamondback Branding', '3750', 'orders@diamondbackbranding.com', true, false),
  ('ns_61', 'Discount Mugs', '61', NULL, true, false),
  ('ns_63', 'Dolfin', '63', NULL, true, false),
  ('ns_4440', 'Dollamur', '4440', NULL, true, false),
  ('ns_3775', 'Douglas Pads', '3775', NULL, true, false),
  ('ns_3568', 'Dreamseats', '3568', NULL, true, false),
  ('ns_3873', 'DUC', '3873', NULL, true, false),
  ('ns_5231', 'Dynamic Fitness & Strength', '5231', NULL, true, false),
  ('ns_5048', 'Eclectic Printing', '5048', 'jolie@eclecticprinting.com', true, false),
  ('ns_4322', 'EG Pro', '4322', NULL, true, false),
  ('ns_3872', 'Extreme Stitch Embroidery', '3872', NULL, true, false),
  ('ns_4383', 'Fiberlok Technologies Inc.', '4383', 'christieh@fiberlok.com', true, false),
  ('ns_3847', 'Fisher Athletic', '3847', NULL, true, false),
  ('ns_74', 'Frazier Sports Inc', '74', NULL, true, false),
  ('ns_4509', 'Frontier Screenprinting', '4509', NULL, true, false),
  ('ns_76', 'Gamebreaker', '76', NULL, true, false),
  ('ns_77', 'Garb', '77', NULL, true, false),
  ('ns_4994', 'Gared Sports', '4994', NULL, true, false),
  ('ns_79', 'Gill Porter', '79', NULL, true, false),
  ('ns_80', 'GoalInn', '80', NULL, true, false),
  ('ns_4552', 'GraphiC323', '4552', NULL, true, false),
  ('ns_3401', 'Guardian Caps', '3401', 'SALES@GUARDIANSPORTS.COM', true, false),
  ('ns_4591', 'Hardhits', '4591', NULL, true, false),
  ('ns_4255', 'Head', '4255', 'cbrandt@us.head.com', true, false),
  ('ns_3302', 'Healy Awards', '3302', 'sales@healyawards.com', true, false),
  ('ns_3595', 'HOA LAM-Seamstress', '3595', NULL, true, false),
  ('ns_4185', 'Hockey West Wholesale', '4185', NULL, true, false),
  ('ns_82', 'Howard Custom Transfers', '82', NULL, true, false),
  ('ns_83', 'HPI Emblem', '83', NULL, true, false),
  ('ns_4026', 'Hummel', '4026', NULL, true, false),
  ('ns_84', 'Icon Screening, Inc.', '84', NULL, true, false),
  ('ns_4588', 'Integrity Designs', '4588', 'cheryl@integritydesignusa.com', true, false),
  ('ns_3488', 'Iron Gritt LLC', '3488', NULL, true, false),
  ('ns_87', 'Jaypro Sports LLC', '87', NULL, true, false),
  ('ns_3700', 'JM Branding', '3700', 'orders@jmbranding.net', true, false),
  ('ns_4356', 'Joma USA', '4356', 'julio@jomausa.com', true, false),
  ('ns_4546', 'Kap 7', '4546', NULL, true, false),
  ('ns_5199', 'Kiefer Aquatics', '5199', NULL, true, false),
  ('ns_4740', 'Korney Board Aids', '4740', NULL, true, false),
  ('ns_3753', 'Landway', '3753', NULL, true, false),
  ('ns_4495', 'Left Coast Tees', '4495', NULL, true, false),
  ('ns_4286', 'Legends Sport', '4286', NULL, true, false),
  ('ns_5060', 'Light Helmets', '5060', NULL, true, false),
  ('ns_4990', 'Linda MacDonald', '4990', NULL, true, false),
  ('ns_4213', 'MARKWORT SPORTING GOODS CO.', '4213', NULL, true, false),
  ('ns_3531', 'Matman', '3531', 'orders@matmanusa.com', true, false),
  ('ns_91', 'McDavid/Shock Doctor', '91', NULL, true, false),
  ('ns_4202', 'Michael Waltrip', '4202', NULL, true, false),
  ('ns_95', 'Mikasa Sports, USA', '95', NULL, true, false),
  ('ns_96', 'Mission Imprintables', '96', NULL, true, false),
  ('ns_97', 'Mizuno USA, Inc.', '97', NULL, true, false),
  ('ns_99', 'Molten USA Inc', '99', NULL, true, false),
  ('ns_4260', 'Monarch Printing', '4260', NULL, true, false),
  ('ns_100', 'MUELLER SPORTS MEDICINE', '100', NULL, true, false),
  ('ns_102', 'New Balance', '102', NULL, true, false),
  ('ns_103', 'New Star Embroidery Services', '103', NULL, true, false),
  ('ns_104', 'Nfinity Athletic', '104', NULL, true, false),
  ('ns_4515', 'Olympic Embroidery', '4515', NULL, true, true),
  ('ns_4701', 'Omni Cheer', '4701', NULL, true, false),
  ('ns_5190', 'OTTO CAP', '5190', 'order@ottocap.com', true, false),
  ('ns_115', 'Outdoor Cap', '115', NULL, true, false),
  ('ns_116', 'Outer Circle', '116', NULL, true, false),
  ('ns_117', 'Pacific Embroidery', '117', NULL, true, false),
  ('ns_3290', 'Pacific Headwear', '3290', NULL, true, false),
  ('ns_4538', 'Pacific Screen Printing', '4538', 'levit@pacificscreenprint.com', true, true),
  ('ns_120', 'Pro Feet', '120', NULL, true, false),
  ('ns_4510', 'Prolook', '4510', NULL, true, false),
  ('ns_4448', 'Pugg Company', '4448', 'puggco@hotmail.com', true, false),
  ('ns_122', 'Pukka', '122', NULL, true, false),
  ('ns_4188', 'Puma', '4188', NULL, true, false),
  ('ns_5333', 'Reusch', '5333', NULL, true, false),
  ('ns_4798', 'Rivers Promo', '4798', NULL, true, false),
  ('ns_3863', 'Rocket Science', '3863', 'steve@nationalsportsapparel.com', true, false),
  ('ns_126', 'Rogers Athletic', '126', NULL, true, false),
  ('ns_127', 'RSD Digitize', '127', NULL, true, false),
  ('ns_4282', 'Ruffneck', '4282', 'brian@ruffneckwear.com', true, false),
  ('ns_3839', 'S&S Seating Inc.', '3839', NULL, true, false),
  ('ns_131', 'Saranac Glove & Mitten Company', '131', NULL, true, false),
  ('ns_132', 'Schutt Sports', '132', NULL, true, false),
  ('ns_134', 'Select Sport America', '134', NULL, true, false),
  ('ns_3297', 'Silver Screen Printing & Embroidery', '3297', NULL, true, true),
  ('ns_135', 'Sonic Patch', '135', NULL, true, false),
  ('ns_3332', 'Spalding Russell', '3332', NULL, true, false),
  ('ns_3716', 'Spalding/Dudley', '3716', 'Ezra.Bartley@fotlinc.com', true, false),
  ('ns_4829', 'Spartan Merch', '4829', NULL, true, false),
  ('ns_137', 'Speedo', '137', NULL, true, false),
  ('ns_138', 'Sport Decals', '138', NULL, true, false),
  ('ns_5377', 'Sports Attack', '5377', NULL, true, false),
  ('ns_4777', 'Sports Imports', '4777', NULL, true, false),
  ('ns_139', 'Sports Inc', '139', NULL, true, false),
  ('ns_5129', 'Sports Locker', '5129', NULL, true, false),
  ('ns_3429', 'Sports Venue Padding', '3429', NULL, true, false),
  ('ns_4012', 'Stackhouse Athletic', '4012', NULL, true, false),
  ('ns_3337', 'Stadium Chair', '3337', NULL, true, false),
  ('ns_140', 'Stahls', '140', NULL, true, false),
  ('ns_145', 'Steven Peterson', '145', NULL, true, false),
  ('ns_148', 'Susan Kays', '148', NULL, true, false),
  ('ns_3825', 'SV Padding', '3825', 'steve@nationalsportsapparel.com', true, false),
  ('ns_151', 'Tanner Tees', '151', NULL, true, false),
  ('ns_5263', 'TaylorMade', '5263', NULL, true, false),
  ('ns_152', 'Team Gear Flow', '152', NULL, true, false),
  ('ns_4924', 'Theory Printing & Signs', '4924', 'hello@theoryprint.com', true, false),
  ('ns_156', 'To The Game LLC', '156', NULL, true, false),
  ('ns_157', 'TopStar Digitizing', '157', NULL, true, false),
  ('ns_158', 'Transfer Express', '158', NULL, true, false),
  ('ns_3583', 'Trigon Sports', '3583', 'neal@trigonsports.com', true, false),
  ('ns_159', 'TSC Apparel', '159', NULL, true, false),
  ('ns_4342', 'TUCCI', '4342', NULL, true, false),
  ('ns_160', 'Twin City TCK', '160', NULL, true, false),
  ('ns_4150', 'Tyr Sports', '4150', NULL, true, false),
  ('ns_3801', 'UBIX', '3801', NULL, true, false),
  ('ns_162', 'Uni-Sport', '162', NULL, true, false),
  ('ns_4584', 'Varsity Scoreboards', '4584', 'jay.poston@varsityscoreboards.com', true, false),
  ('ns_3756', 'Vuline Direct', '3756', 'bryan@vulinedirect.com', true, false),
  ('ns_4606', 'Wellington House Inc.', '4606', NULL, true, false),
  ('ns_3879', 'WePrintIt', '3879', NULL, true, true),
  ('ns_3777', 'Wheelin Water', '3777', 'wheelinwater@frontier.com', true, false),
  ('ns_166', 'Wilson Sporting Goods', '166', NULL, true, false)
ON CONFLICT (id) DO NOTHING;

-- Note: the existing public.deco_vendors table (used for decoration pricing tiers)
-- is left untouched. Future work can join vendors.is_decorator=true with
-- deco_vendors via name or by adding a foreign key once vendors are categorized.
