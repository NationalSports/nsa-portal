-- Add sent_history and print_history columns to estimates, sales_orders, and so_jobs.
-- These columns exist on invoices (added in 00028) but were missing from these tables,
-- causing order history (e.g. "estimate sent") to be lost on poll refresh.

-- estimates
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS sent_history JSONB DEFAULT '[]';
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS print_history JSONB DEFAULT '[]';
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS email_status TEXT;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS email_sent_at TEXT;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS email_opened_at TEXT;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS email_viewed_at TEXT;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS follow_up_at TEXT;

-- sales_orders
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS sent_history JSONB DEFAULT '[]';
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS print_history JSONB DEFAULT '[]';
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS email_status TEXT;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS email_sent_at TEXT;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS email_opened_at TEXT;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS email_viewed_at TEXT;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS follow_up_at TEXT;

-- so_jobs
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS sent_history JSONB DEFAULT '[]';
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS follow_up_at TEXT;
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS sent_to_coach_at TEXT;
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS coach_approved_at TEXT;
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS coach_email_opened_at TEXT;
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS coach_rejected BOOLEAN DEFAULT false;
