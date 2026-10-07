-- NULL preserves existing flat rates and legacy All School UPS configuration.
ALTER TABLE public.webstores ADD COLUMN IF NOT EXISTS shipping_settings jsonb;
ALTER TABLE public.webstores ADD CONSTRAINT webstores_shipping_settings_object
CHECK (shipping_settings IS NULL OR jsonb_typeof(shipping_settings) = 'object');
COMMENT ON COLUMN public.webstores.shipping_settings IS 'Checkout shipping mode, optional free threshold in cents, lower-bound rate tiers, and live UPS package configuration. Server calculates all charges.';
