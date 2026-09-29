-- Mark an Art TBD placeholder by flag instead of by name.
--
-- Reps "Rename" an Art TBD to tell the art team what it is ("9in Basketball"). The name used to
-- keep an "ART TBD n —" prefix because the order editor recognised placeholders by that prefix
-- alone. With this flag the name can be just the rep's label while the art still reads as
-- Art Needed until real art lands (isTbdArt in src/lib/orderArtSwap.js).
-- NULL/false = not flagged; "ART TBD n" names are still recognised by name, as before.
ALTER TABLE public.estimate_art_files ADD COLUMN IF NOT EXISTS is_tbd BOOLEAN;
ALTER TABLE public.so_art_files ADD COLUMN IF NOT EXISTS is_tbd BOOLEAN;
