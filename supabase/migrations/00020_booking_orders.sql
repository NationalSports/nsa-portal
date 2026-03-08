-- Migration: Add booking order support
-- Booking orders are planning orders (6-9 months out) for brands like Adidas/UA.
-- They stay out of the active pipeline until ~100 days before expected ship date.

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'at_once'
    CHECK (order_type IN ('at_once', 'booking')),
  ADD COLUMN IF NOT EXISTS expected_ship_date DATE,
  ADD COLUMN IF NOT EXISTS booking_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS booking_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS booking_alert_days INTEGER NOT NULL DEFAULT 100;

COMMENT ON COLUMN sales_orders.order_type IS 'at_once = standard order, booking = planning order 6-9 months out';
COMMENT ON COLUMN sales_orders.expected_ship_date IS 'When the rep expects this booking order to ship';
COMMENT ON COLUMN sales_orders.booking_confirmed IS 'Whether the rep has confirmed the order with the coach (at ~100 days out)';
