-- Customer-side subdomain captured during onboarding Step 2 (proxy/DNS setup).
-- Example: a customer with apex acme.com chooses experiments.acme.com and points
-- a CNAME from there at <proxy_slug>.zybit.run. We store the chosen subdomain so
-- (a) the wizard + settings page can re-render the CNAME instructions, and (b)
-- the DNS-verification action knows what to resolve.
ALTER TABLE "phase1_sites" ADD COLUMN IF NOT EXISTS "customer_subdomain" TEXT;
