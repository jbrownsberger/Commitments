-- Paywall & Tutorial
-- Adds Stripe premium status, customer ID, and tutorial-seen flag to user_preferences.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS is_premium           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_customer_id   text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS has_seen_tutorial    boolean NOT NULL DEFAULT false;

-- The stripe-webhook edge function runs as service-role, so no RLS needed for
-- updating these fields from the server. Existing RLS on user_preferences
-- already allows each user to read/write their own row.
