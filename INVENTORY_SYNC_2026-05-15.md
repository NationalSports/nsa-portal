# Inventory Sync — 2026-05-15

Source: Google Sheet `1RX3PjgTVUidR9i-vQOFAvY7ym_CiDkytMnsTnuCbuzg` (gid 1497183956).

Categories covered: Tees, Polos, Hoods, Shorts & Pants.

## Applied

| Category | SKUs updated | Notes |
|---|---|---|
| Tees   | 73 | Existing rows zeroed, sheet values upserted, `available_sizes` extended for new 3XL/4XL where present. |
| Polos  | 8  | `JN5174, JM5223, 1370399-001, 1370399-400, KD2999, KD2995, JM5231, KC3589`. Set `category='Polos'` where it was null. |
| Hoods  | 12 | `JM1033, JM5286, JW6597, JW6601, JW6602, JX6793, JX6802, JY2498, IS9752, IS9765, IS9767, IS9769`. Normalized `category='Hoods'` (was `Hood`/`Other` on a few). |
| Shorts & Pants | 17 | `GM2365, IP3085, IS1111, JH3620, JL5410, JL5412, JL6888, JM5103, JM5104, JW5115, JW6604, JW6607, JY2483, JZ4600, JZ7651, KB5248, KC5466`. Recategorized `JM5104` (Tees→Shorts), `KB5248` (Jersey→Shorts), `JL5410/JL5412` (Pants→Shorts). |

## Skipped — SKUs in sheet but not in `products` table

These need a product row created before inventory can land. Cost/description from the sheet is listed for convenience.

### Tees (UA + youth — also size grid in the sheet was a misaligned side-table)
- `1376842-001` Black UA SS Tech M. Team Tee
- `1376842-012` Grey UA SS Tech M. Team Tee
- `1376842-100` White UA SS Tech M. Team Tee
- `1376842-400` Royal UA SS Tech M. Team Tee
- `1360695-410` Navy UA Athletics SS Tee
- `1360695-001` Black UA Athletics SS Tee
- `1326413-001` Black UA Tech 2.0 SS Tee
- `1376843-001` Black UA Tech LS Tee
- `1376843-400` Royal UA Tech LS TEAM Tee
- `1383264-001` Black UA Athletics Tee
- `1383264-011` Gray UA Athletics Tee
- `1383264-100` White UA Athletics Tee
- `1383264-400` Royal UA Athletics SS Tee
- `CL4591` Red Youth AMP Tee

### Polos
- `HS1301` Black Classic Polo ($24.37)
- `IQ2720` Navy M. C. SS Polo ($24.37)
- `IS1104` White M. Classic Polo ($24.37)
- `IS1103` Black M. Classic Polo ($24.37)
- `IW2312` Grey M. Coach SS Polo ($24.37)
- `IB2474` Royal Classic Polo ($24.37)
- `HS8922` Royal TI Polo ($16.87)
- `HS7668` Black TI Polo ($16.87)
- `HS8921` Cardinal TI Polo ($16.87)
- `HS8920` Red TI Polo ($16.87)
- `HC5067` White ENT 22 Polo ($11.25)
- `HB5328` Black ENT 22 Polo ($11.25)
- `HT7681` Cardinal W. TI Polo ($16.87)
- `HT7684` Royal W. TI Polo ($16.87)
- `A230` White Golf Polo ($18.97) — DB row exists with color=null; needs split per color
- `A230` Green Golf Polo ($18.97) — same
- `S97377` Black Grind Polo ($11.25)
- `S93771` Royal Grind Polo ($11.25)
- `S97378` Onix Grind Polo ($11.25)
- `JD5725` Black Sideline Polo ($22.50)

### Hoods
- `JW6803` Navy W. FZ Hood ($18.75)
- `HI3163` Royal W TI Full Zip Hood ($26.25)
- `HI3169` Royal W. Adi Team Issue Hood ($26.25)
- `HI7167` Royal W TI Full Zip Hood ($26.25)
- `HI5281` Navy Fleece Hood ($18.75)
- `HR8470` Black Fleece Hood ($18.75)
- `HR8471` Onix Fleece Hood ($18.75)
- `HR8472` Red Fleece Hood ($18.75)
- `HR8473` Royal Fleece Hood ($18.75)
- `S97363` Black Fleece Hood ($18.75)
- `S97364` Onix Fleece Hood ($18.75)
- `S97365` Red Fleece Hood ($18.75)
- `S97366` Navy Fleece Hood ($18.75)
- `HF6264` Black Icon SS Hood
- `IA0408` Cardinal ENT 22 Hood — DB row exists but `color='CUSTOM'`; sheet color is Cardinal

### Shorts & Pants
- `GI6796` Navy W. 3 Stripe Short
- `GL9698` Black W. 3 Stripe Short
- `FK0993` Black TF 3in VB Shorts
- `FK0094` Royal TF 3in VB Shorts
- `FK3159` Navy 4" Adi Custom Short Tights
- `FK3159` Black 4" Adi Custom Short Tights — second color, needs separate row
- `GI6786` Navy W. Wov 3in Short
- `HR8493` Dark Grey W. Fleece Pant
- `HS8934` Grey W. TI Running Shorts
- `HS8556` Navy W. PGM 3in Shorts
- `HG6296` Royal W. Entrada 22 Shorts
- `GL9724` Black W Wov 3in Shorts
- `GL9751` Royal W. Wov 3in Short
- `KA8085` White W. White Skirt
- `GR9673` Black/Grey 4" Camo Tight
- `HI2917` Black Team Issue 8in Shorts ($13.12)
- `HS1365` Black Program 9" Pock Short ($13.12)
- `HS7226` Navy Tiro 23 L TR Shorts ($13.12)
- `HS7733` Grey W TI Knit Shorts ($13.12)
- `FS3814` Navy 4" VB Shorts ($13.12)
- `IC6976` Black 7" Ess Training Woven Shorts ($13.12)
- `IC6977` Navy 7" Ess Training Woven Shorts ($13.12)
- `IC6978` Dark Grey 7" Ess Training Woven Shorts ($13.12)
- `IC6979` Royal 7" Ess Training Woven Shorts ($13.12)
- `JM8546` Grey Utility Woven Short ($18.75)
- `JM8547` Black Utility Woven Short ($18.75)
- `GM2494` Royal 3 Stripe Shorts ($8.25)
- `GM2489` Grey 3 Stripe Shorts ($8.25)
- `GI6799` Navy 3 Stripe Shorts ($8.25)
- `H57504` Black Adidas Entrada22 Short ($8.25)
- `IJ7600` Black pant ($18.75)
- `HI0707` Black TI Pants ($22.50)
- `HI0706` Navy M. Team Pants ($22.50)
- `HI3092` Grey M. Team Tap. Pant ($18.75)
- `HI0704` Black W TI Pants ($22.50)
- `HI0703` Navy W Team Tap Pants ($22.50)
- `HG7556` Royal Stadium Tapered Pant ($22.50)
- `HI3186` Grey W. Team Pant ($22.50)
- `HS7232` Black Tiro 23 Pant ($18.75)
- `HG6294` Blue ENT Short ($6.75)
- `HS9949` Black W. TI Run Shorts ($15.00)
- `IP1952` Black Tiro24 Pant ($18.75)
- `IR9343` Navy Tiro Pant ($18.75)
