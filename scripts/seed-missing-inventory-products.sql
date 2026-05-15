-- =====================================================================
-- Seed missing inventory products + apply inventory from the May 2026
-- inventory sheet (https://docs.google.com/spreadsheets/d/1RX3Pjg...).
--
-- DRAFT — review color_category mappings, retail_price (set to 0.0
-- placeholder where the sheet didn't give us a number), and brand
-- assignment before applying.
--
-- Three steps:
--   1. INSERT new product rows
--   2. UPSERT product_inventory from the sheet for the new SKUs
--   3. Set available_sizes from sheet sizes that have qty > 0
--
-- Run inside one transaction so a typo doesn't leave half-seeded rows:
--   BEGIN;
--   \i scripts/seed-missing-inventory-products.sql
--   -- inspect
--   COMMIT;  -- or ROLLBACK
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. New product rows
-- ---------------------------------------------------------------------
INSERT INTO products (id, sku, name, brand, color, color_category, category, vendor_id, retail_price, nsa_cost, is_active, is_archived, available_sizes) VALUES
-- Polos
('p-1779148800000-001','HS1301','Adidas Classic Polo','Adidas','Black','Black','Polos','v1',0.00,24.37,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-002','IQ2720','Adidas M. C. SS Polo','Adidas','Navy','Blue','Polos','v1',0.00,24.37,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-003','IS1104','Adidas M. Classic Polo','Adidas','White','White','Polos','v1',0.00,24.37,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-004','IS1103','Adidas M. Classic Polo','Adidas','Black','Black','Polos','v1',0.00,24.37,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-005','IW2312','Adidas M. Coach SS Polo','Adidas','Grey','Grey','Polos','v1',0.00,24.37,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-006','IB2474','Adidas Classic Polo','Adidas','Royal','Blue','Polos','v1',0.00,24.37,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-007','HS8922','Adidas Team Issue Polo','Adidas','Royal','Blue','Polos','v1',0.00,16.87,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-008','HS7668','Adidas Team Issue Polo','Adidas','Black','Black','Polos','v1',0.00,16.87,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-009','HS8921','Adidas Team Issue Polo','Adidas','Cardinal','Red','Polos','v1',0.00,16.87,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-010','HS8920','Adidas Team Issue Polo','Adidas','Red','Red','Polos','v1',0.00,16.87,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-011','HC5067','Adidas Entrada 22 Polo','Adidas','White','White','Polos','v1',0.00,11.25,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-012','HB5328','Adidas Entrada 22 Polo','Adidas','Black','Black','Polos','v1',0.00,11.25,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-013','HT7681','Adidas W. Team Issue Polo','Adidas','Cardinal','Red','Polos','v1',0.00,16.87,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-014','HT7684','Adidas W. Team Issue Polo','Adidas','Royal','Blue','Polos','v1',0.00,16.87,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-015','S97377','Adidas Grind Polo','Adidas','Black','Black','Polos','v1',0.00,11.25,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-016','S93771','Adidas Grind Polo','Adidas','Royal','Blue','Polos','v1',0.00,11.25,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-017','S97378','Adidas Grind Polo','Adidas','Onix','Grey','Polos','v1',0.00,11.25,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-018','JD5725','Adidas Sideline Polo','Adidas','Black','Black','Polos','v1',0.00,22.50,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),

-- Hoods
('p-1779148800000-101','JW6803','Adidas W. FZ Hood','Adidas','Navy','Blue','Hoods','v1',0.00,18.75,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-102','HI3163','Adidas W. Team Issue Full Zip Hood','Adidas','Royal','Blue','Hoods','v1',0.00,26.25,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-103','HI3169','Adidas W. Team Issue Hood','Adidas','Royal','Blue','Hoods','v1',0.00,26.25,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-104','HI7167','Adidas W. Team Issue Full Zip Hood','Adidas','Royal','Blue','Hoods','v1',0.00,26.25,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-105','HI5281','Adidas Fleece Hood','Adidas','Navy','Blue','Hoods','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-106','HR8470','Adidas Fleece Hood','Adidas','Black','Black','Hoods','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL","4XL"]'::jsonb),
('p-1779148800000-107','HR8471','Adidas Fleece Hood','Adidas','Onix','Grey','Hoods','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-108','HR8472','Adidas Fleece Hood','Adidas','Red','Red','Hoods','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-109','HR8473','Adidas Fleece Hood','Adidas','Royal','Blue','Hoods','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-110','S97363','Adidas Fleece Hood','Adidas','Black','Black','Hoods','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-111','S97364','Adidas Fleece Hood','Adidas','Onix','Grey','Hoods','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-112','S97365','Adidas Fleece Hood','Adidas','Red','Red','Hoods','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-113','S97366','Adidas Fleece Hood','Adidas','Navy','Blue','Hoods','v1',0.00,18.75,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-114','HF6264','Adidas Icon SS Hood','Adidas','Black','Black','Hoods','v1',0.00,0.00,true,false,'["S","M","L","XL","2XL"]'::jsonb),

-- Shorts (women's)
('p-1779148800000-201','GI6796','Adidas W. 3 Stripe Short','Adidas','Navy','Blue','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-202','GL9698','Adidas W. 3 Stripe Short','Adidas','Black','Black','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-203','FK0993','Adidas TF 3in VB Shorts','Adidas','Black','Black','Shorts','v1',0.00,0.00,true,false,'["2XS","XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-204','FK0094','Adidas TF 3in VB Shorts','Adidas','Royal','Blue','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-205','FK3159','Adidas 4in Custom Short Tights','Adidas','Navy','Blue','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-206','FK3159-BLK','Adidas 4in Custom Short Tights','Adidas','Black','Black','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-207','GI6786','Adidas W. Wov 3in Short','Adidas','Navy','Blue','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-208','HS8934','Adidas W. TI Running Shorts','Adidas','Grey','Grey','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-209','HS8556','Adidas W. PGM 3in Shorts','Adidas','Navy','Blue','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-210','HG6296','Adidas W. Entrada 22 Shorts','Adidas','Royal','Blue','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-211','GL9724','Adidas W. Wov 3in Shorts','Adidas','Black','Black','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-212','GL9751','Adidas W. Wov 3in Short','Adidas','Royal','Blue','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-213','KA8085','Adidas W. Skirt','Adidas','White','White','Shorts','v1',0.00,0.00,true,false,'["XS","S","M","L","XL"]'::jsonb),
('p-1779148800000-214','GR9673','Adidas 4in Camo Tight','Adidas','Black/Grey','Grey','Shorts','v1',0.00,0.00,true,false,'["2XS","XS","S","M","L","XL"]'::jsonb),

-- Shorts (men's)
('p-1779148800000-301','HI2917','Adidas Team Issue 8in Shorts','Adidas','Black','Black','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL","3XL","4XL"]'::jsonb),
('p-1779148800000-302','HS1365','Adidas Program 9in Pock Short','Adidas','Black','Black','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-303','HS7226','Adidas Tiro 23 L TR Shorts','Adidas','Navy','Blue','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-304','HS7733','Adidas W. TI Knit Shorts','Adidas','Grey','Grey','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-305','FS3814','Adidas 4in VB Shorts','Adidas','Navy','Blue','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-306','IC6976','Adidas 7in Ess Training Woven Shorts','Adidas','Black','Black','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL","3XL","4XL"]'::jsonb),
('p-1779148800000-307','IC6977','Adidas 7in Ess Training Woven Shorts','Adidas','Navy','Blue','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL","3XL","4XL"]'::jsonb),
('p-1779148800000-308','IC6978','Adidas 7in Ess Training Woven Shorts','Adidas','Dark Grey','Grey','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL","3XL","4XL"]'::jsonb),
('p-1779148800000-309','IC6979','Adidas 7in Ess Training Woven Shorts','Adidas','Royal','Blue','Shorts','v1',0.00,13.12,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-310','JM8546','Adidas Utility Woven Short','Adidas','Grey','Grey','Shorts','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-311','JM8547','Adidas Utility Woven Short','Adidas','Black','Black','Shorts','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-312','GM2494','Adidas 3 Stripe Shorts','Adidas','Royal','Blue','Shorts','v1',0.00,8.25,true,false,'["M","L","XL","2XL","3XL","4XL"]'::jsonb),
('p-1779148800000-313','GM2489','Adidas 3 Stripe Shorts','Adidas','Grey','Grey','Shorts','v1',0.00,8.25,true,false,'["S","M","L","XL","2XL","3XL","4XL"]'::jsonb),
('p-1779148800000-314','GI6799','Adidas 3 Stripe Shorts','Adidas','Navy','Blue','Shorts','v1',0.00,8.25,true,false,'["S","M","L","XL","2XL","3XL","4XL"]'::jsonb),
('p-1779148800000-315','H57504','Adidas Entrada 22 Short','Adidas','Black','Black','Shorts','v1',0.00,8.25,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-316','HG6294','Adidas Entrada 22 Short','Adidas','Blue','Blue','Shorts','v1',0.00,6.75,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-317','HS9949','Adidas W. TI Run Shorts','Adidas','Black','Black','Shorts','v1',0.00,15.00,true,false,'["S","M","L","XL","2XL"]'::jsonb),

-- Pants
('p-1779148800000-401','HR8493','Adidas W. Fleece Pant','Adidas','Dark Grey','Grey','Pants','v1',0.00,0.00,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-402','IJ7600','Adidas Pant','Adidas','Black','Black','Pants','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-403','HI0707','Adidas Team Issue Pants','Adidas','Black','Black','Pants','v1',0.00,22.50,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-404','HI0706','Adidas M. Team Pants','Adidas','Navy','Blue','Pants','v1',0.00,22.50,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-405','HI3092','Adidas M. Team Tapered Pant','Adidas','Grey','Grey','Pants','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-406','HI0704','Adidas W. Team Issue Pants','Adidas','Black','Black','Pants','v1',0.00,22.50,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-407','HI0703','Adidas W. Team Tapered Pants','Adidas','Navy','Blue','Pants','v1',0.00,22.50,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-408','HG7556','Adidas Stadium Tapered Pant','Adidas','Royal','Blue','Pants','v1',0.00,22.50,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-409','HI3186','Adidas W. Team Pant','Adidas','Grey','Grey','Pants','v1',0.00,22.50,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-410','HS7232','Adidas Tiro 23 Pant','Adidas','Black','Black','Pants','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-411','IP1952','Adidas Tiro 24 Pant','Adidas','Black','Black','Pants','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-412','IR9343','Adidas Tiro Pant','Adidas','Navy','Blue','Pants','v1',0.00,18.75,true,false,'["S","M","L","XL","2XL"]'::jsonb),

-- Outerwear / Jackets
('p-1779148800000-501','HY7893','Adidas 1/2 Zip Golf Jacket','Adidas','Navy','Blue','Outerwear','v1',0.00,0.00,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-502','HY7894','Adidas 1/2 Zip Golf Jacket','Adidas','Black','Black','Outerwear','v1',0.00,0.00,true,false,'["S","M","L","XL","2XL","3XL"]'::jsonb),
('p-1779148800000-503','HK7656','Adidas Tiro 23 Jacket','Adidas','Black','Black','Outerwear','v1',0.00,0.00,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-504','HC8462','Adidas Icon M. Fleece Jacket','Adidas','Black','Black','Outerwear','v1',0.00,0.00,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-505','IJ7391','Adidas Tiro 24 Parka','Adidas','Black','Black','Outerwear','v1',0.00,0.00,true,false,'["XS","S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-506','HF6160','Adidas Icon Cage Jacket','Adidas','Black','Black','Outerwear','v1',0.00,0.00,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-507','1369256','UA Rain Jacket','Under Armour','Dark Grey','Grey','Outerwear','v2',0.00,0.00,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-508','IR7498','Adidas Tiro 24 Jacket','Adidas','Navy','Blue','Outerwear','v1',0.00,20.62,true,false,'["S","M","L","XL","2XL"]'::jsonb),
('p-1779148800000-509','IJ9959','Adidas Tiro 24 Jacket','Adidas','Black','Black','Outerwear','v1',0.00,20.62,true,false,'["S","M","L","XL","2XL"]'::jsonb)
;

-- ---------------------------------------------------------------------
-- 2. Inventory upsert for the new SKUs
-- ---------------------------------------------------------------------
WITH sheet(sku, sizes) AS (VALUES
-- Polos
('HS1301','{"M":7}'::jsonb),
('IQ2720','{"S":5}'::jsonb),
('IS1104','{"2XL":2,"3XL":1}'::jsonb),
('IS1103','{"S":1,"L":1,"2XL":6}'::jsonb),
('IW2312','{"XL":1,"2XL":3}'::jsonb),
('IB2474','{"M":5,"L":6,"XL":3}'::jsonb),
('HS8922','{"M":51}'::jsonb),
('HS7668','{"S":29,"M":41,"L":18}'::jsonb),
('HS8921','{"S":15,"M":15,"L":22,"XL":10}'::jsonb),
('HS8920','{"L":12,"2XL":5}'::jsonb),
('HC5067','{"S":7,"M":6,"L":25}'::jsonb),
('HB5328','{"S":10,"3XL":5}'::jsonb),
('HT7681','{"S":8,"M":8,"L":10,"XL":5}'::jsonb),
('HT7684','{"L":1,"XL":6}'::jsonb),
('S97377','{"L":7,"XL":12,"2XL":17,"3XL":5}'::jsonb),
('S93771','{"S":10,"M":50,"L":50,"XL":30,"2XL":19,"3XL":5}'::jsonb),
('S97378','{"S":10,"M":32,"L":13,"XL":18,"2XL":17,"3XL":5}'::jsonb),
('JD5725','{"S":2,"M":5,"L":4,"XL":2,"2XL":3}'::jsonb),
-- Hoods
('JW6803','{"M":4,"L":8,"XL":5}'::jsonb),
('HI3163','{"XS":1,"S":14,"M":12,"L":10,"XL":14}'::jsonb),
('HI3169','{"XS":5,"S":9,"M":19,"L":6}'::jsonb),
('HI7167','{"S":4,"M":13}'::jsonb),
('HI5281','{"S":21}'::jsonb),
('HR8470','{"S":1,"XL":1,"3XL":4,"4XL":15}'::jsonb),
('HR8471','{"S":8,"M":7,"L":10,"2XL":2}'::jsonb),
('HR8472','{"S":16,"M":26,"2XL":5}'::jsonb),
('HR8473','{"S":21,"M":49,"L":9,"XL":19,"2XL":5,"3XL":3}'::jsonb),
('S97363','{"S":49}'::jsonb),
('S97364','{"S":25,"M":17}'::jsonb),
('S97365','{"S":2,"M":14}'::jsonb),
('S97366','{"XS":4,"S":15}'::jsonb),
-- Shorts (women's) — no sheet qty for many, leaving them empty
('GI6796','{"XS":3,"S":27,"M":36,"L":19,"XL":14,"2XL":2}'::jsonb),
('GL9698','{"XS":6,"S":39,"M":65,"L":18,"XL":10,"2XL":14}'::jsonb),
('FK0993','{"2XS":4,"XS":27,"S":16}'::jsonb),
('FK0094','{"XL":1}'::jsonb),
('FK3159','{"XS":10,"S":1,"M":35,"L":20,"XL":10,"2XL":5}'::jsonb),
('FK3159-BLK','{"XS":1,"S":29,"M":16,"L":31,"XL":16,"2XL":9}'::jsonb),
('GI6786','{"XS":6,"S":4,"M":7,"L":13,"XL":11}'::jsonb),
('HS8934','{"XS":12,"S":26,"M":17}'::jsonb),
('HS8556','{"S":12,"XL":1}'::jsonb),
('HG6296','{"S":12,"M":13,"L":4,"XL":1}'::jsonb),
('GL9724','{"XS":1,"L":15}'::jsonb),
('GL9751','{"XS":5,"S":15,"M":15,"L":10,"XL":4}'::jsonb),
('KA8085','{"XS":5,"S":30,"M":30,"L":5}'::jsonb),
('GR9673','{"2XS":10,"XS":39,"S":110,"M":200,"L":33}'::jsonb),
-- Shorts (men's)
('HI2917','{"S":101,"M":57,"L":38,"XL":24,"2XL":8,"4XL":1}'::jsonb),
('HS1365','{"S":111,"M":117,"L":14}'::jsonb),
('HS7226','{"S":6,"M":2,"L":11}'::jsonb),
('HS7733','{"S":22,"M":3,"L":3}'::jsonb),
('FS3814','{"S":18,"M":25}'::jsonb),
('IC6976','{"S":34,"M":37,"L":37}'::jsonb),
('IC6977','{"S":8,"L":1,"XL":9,"2XL":20,"3XL":5,"4XL":5}'::jsonb),
('IC6978','{"S":8,"M":12,"2XL":10,"3XL":1,"4XL":5}'::jsonb),
('IC6979','{"S":10,"M":48,"L":48,"XL":40,"2XL":30}'::jsonb),
('JM8546','{"M":29,"XL":4,"2XL":7}'::jsonb),
('JM8547','{"S":50,"M":117,"L":86,"XL":59,"2XL":29,"3XL":10}'::jsonb),
('GM2494','{"M":106,"L":73,"XL":80,"2XL":40,"3XL":10,"4XL":3}'::jsonb),
('GM2489','{"S":48,"M":60,"L":40,"XL":45,"2XL":28,"3XL":8,"4XL":3}'::jsonb),
('GI6799','{"S":28,"M":59,"L":19,"XL":29,"2XL":18,"3XL":4,"4XL":2}'::jsonb),
('H57504','{"S":51,"M":55,"L":45,"XL":20,"2XL":10}'::jsonb),
('HG6294','{"S":60}'::jsonb),
('HS9949','{"S":4}'::jsonb),
-- Pants
('HR8493','{"S":5,"M":4,"L":2,"XL":2}'::jsonb),
('IJ7600','{"S":14,"M":15,"L":10}'::jsonb),
('HI0707','{"S":214,"M":252,"L":108,"XL":69,"2XL":14,"3XL":5}'::jsonb),
('HI0706','{"S":48,"M":81,"L":55,"XL":28,"2XL":6}'::jsonb),
('HI3092','{"S":68,"M":149,"L":85,"XL":39,"2XL":28,"3XL":5}'::jsonb),
('HI0704','{"XS":3,"S":21,"M":102,"L":57,"XL":40,"2XL":6}'::jsonb),
('HI0703','{"L":8,"XL":3,"2XL":2}'::jsonb),
('HG7556','{"M":24,"L":4}'::jsonb),
('HI3186','{"S":9,"M":6}'::jsonb),
('HS7232','{"S":4,"M":24,"L":13,"XL":16}'::jsonb),
('IP1952','{"S":9,"M":12,"L":8,"XL":13}'::jsonb),
('IR9343','{"M":5,"L":3,"XL":2}'::jsonb),
-- Outerwear
('HY7893','{"2XL":2}'::jsonb),
('HY7894','{"S":1,"2XL":2,"3XL":1}'::jsonb),
('HK7656','{"S":15,"XL":6}'::jsonb),
('HC8462','{"M":22,"L":33,"XL":25}'::jsonb),
('IJ7391','{"XS":5,"M":11}'::jsonb),
('HF6160','{"S":13,"M":64,"L":65,"XL":46}'::jsonb),
('1369256','{"S":1,"M":2,"L":1}'::jsonb),
('IR7498','{"M":2,"L":4,"XL":2}'::jsonb),
('IJ9959','{"M":6,"L":12,"XL":6}'::jsonb)
)
INSERT INTO product_inventory (product_id, size, quantity)
SELECT p.id, kv.key, (kv.value)::int
FROM sheet s
JOIN products p ON p.sku=s.sku
CROSS JOIN LATERAL jsonb_each(s.sizes) kv
ON CONFLICT (product_id, size) DO UPDATE SET quantity=EXCLUDED.quantity;

-- Sanity: how many rows did we insert?
SELECT category, COUNT(*) FROM products WHERE id LIKE 'p-1779148800000-%' GROUP BY category ORDER BY 1;
SELECT COUNT(*) AS inv_rows FROM product_inventory pi JOIN products p ON p.id=pi.product_id WHERE p.id LIKE 'p-1779148800000-%';

COMMIT;
