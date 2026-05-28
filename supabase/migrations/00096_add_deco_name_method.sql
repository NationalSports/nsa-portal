-- Names decorations now carry a decoration method (heat_press | embroidery),
-- mirroring num_method on numbers. Lets embroidered names build their own
-- production job and surface the digitized-names file link.
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS name_method TEXT;
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS name_method TEXT;
