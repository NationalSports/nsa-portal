// Shared size vocabulary for the portal and vendor server resolvers.
const SZ_NORM={'XXS':'XXS','2XS':'XXS','XS':'XS','XSMALL':'XS','X-SMALL':'XS','SM':'S','SML':'S','SMALL':'S','MD':'M','MED':'M','MEDIUM':'M','LG':'L','LRG':'L','LARGE':'L',
  'XLG':'XL','XLARGE':'XL','X-LARGE':'XL','XXL':'2XL','2X':'2XL','2XLARGE':'2XL','2X-LARGE':'2XL',
  'XXXL':'3XL','3X':'3XL','3XLARGE':'3XL','3X-LARGE':'3XL','XXXXL':'4XL','4X':'4XL','4XLARGE':'4XL','4X-LARGE':'4XL',
  '5X':'5XL','6X':'6XL','ST':'ST','MT':'MT','LT':'LT','XLT':'XLT','2XLT':'2XLT','3XLT':'3XLT','4XLT':'4XLT','5XLT':'5XLT',
  'MENS SMALL':'S','MENS MEDIUM':'M','MENS LARGE':'L','MENS XL':'XL','MENS XXL':'2XL',
  'WOMENS SMALL':'S','WOMENS MEDIUM':'M','WOMENS LARGE':'L','WOMENS XL':'XL',
  'YOUTH SMALL':'YS','YOUTH MEDIUM':'YM','YOUTH LARGE':'YL','YOUTH XL':'YXL',
  'YSM':'YS','YMD':'YM','YLG':'YL',  // Under Armour youth labels
  'BOYS SMALL':'YS','BOYS MEDIUM':'YM','BOYS LARGE':'YL','GIRLS SMALL':'YS','GIRLS MEDIUM':'YM','GIRLS LARGE':'YL',
  'NONE':'OSFA','ONE SIZE':'OSFA','OS':'OSFA','O/S':'OSFA','OSFM':'OSFA','N/A':'OSFA',  // OSFM = One Size Fits Most (UA)
  // Spelled-out one-size labels reps type on orders. SanMar (and most vendors) return the
  // bare token 'OSFA', so without these an order line reading "One Size Fits All" never
  // matched the catalog and stayed without a SanMar Part ID / Unique_Key (blocked PO — STC21).
  'ONE SIZE FITS ALL':'OSFA','ONE SIZE FITS MOST':'OSFA','ONESIZE':'OSFA','ONE SIZE FIT ALL':'OSFA',
  // Toddler labels. SanMar returns '2T'…'6T'; orders often carry the spelled-out
  // "<n> Toddler" form, which never matched (PC450TD "4 Toddler" → no Part ID).
  '2 TODDLER':'2T','3 TODDLER':'3T','4 TODDLER':'4T','5 TODDLER':'5T','6 TODDLER':'6T',
  'TODDLER 2':'2T','TODDLER 3':'3T','TODDLER 4':'4T','TODDLER 5':'5T','TODDLER 6':'6T',
  // Sports Inc's EDI feed truncates spelled-out sizes to 5 chars (seen on Augusta): MEDIUM->MEDIU,
  // EXTRA LARGE->EXTRA, DOUBLE->DOUBL, TRIPLE->TRIPL, ONE SIZE->ONE S. Recover them so billed sizes
  // align to the order instead of falsely reading as 0 ordered. (EXTRA = Extra LARGE on this book;
  // an Augusta extra-small would truncate the same way and gets caught by the order/over-bill check.)
  'MEDIU':'M','EXTRA':'XL','DOUBL':'2XL','TRIPL':'3XL','ONE S':'OSFA',
  'LGT':'LT','XXLT':'2XLT'};
// Gender/audience qualifiers that OMG (and some vendors) prepend to a size
// label — e.g. "Mens S", "Women's Large", "Youth M". The size itself is the
// same garment size, so strip the qualifier and normalize the bare size.
// Adult/unisex labels collapse to the plain size (S/M/L…); youth-class labels
// map to the Y-prefixed size (S→YS, M→YM…) to match the catalog/vendor feeds.
// Without this, "Mens S" never matched a vendor's "S", so genuinely in-stock
// OMG items read as out of stock.
const _ADULT_QUAL=/^(?:MEN|MENS|MEN'S|WOMEN|WOMENS|WOMEN'S|LADIES|LADIES'|LADY|ADULT|UNISEX)\s+(.+)$/;
const _YOUTH_QUAL=/^(?:YOUTH|YTH|BOYS|BOY'S|GIRLS|GIRL'S|JUNIOR|JUNIORS|JR)\s+(.+)$/;
const _YOUTH_SZ={'XS':'YXS','S':'YS','SMALL':'YS','SM':'YS','M':'YM','MEDIUM':'YM','MD':'YM','L':'YL','LARGE':'YL','LG':'YL','XL':'YXL','XLARGE':'YXL','X-LARGE':'YXL'};
// A fit range that names itself one-size — headwear catalogs label Richardson caps
// "MD-LG (ONE SIZE FITS MOST)". SanMar lists the same cap as the bare 'OSFA', so the
// parenthetical is what carries the meaning and the fit range is decoration. Checked
// LAST, so any label the exact maps already know keeps its own answer.
const _ONE_SIZE_PHRASE=/\bONE\s*SIZE\b|\bOSFA\b|\bOSFM\b/;
const normSzName=s=>{if(!s)return s;const u=String(s).toUpperCase().trim();if(SZ_NORM[u])return SZ_NORM[u];let m=u.match(_ADULT_QUAL);if(m){const r=m[1].trim();return SZ_NORM[r]||r}m=u.match(_YOUTH_QUAL);if(m){const r=m[1].trim();return _YOUTH_SZ[r]||SZ_NORM[r]||r}if(_ONE_SIZE_PHRASE.test(u))return'OSFA';return u};

module.exports = { SZ_NORM, normSzName };
