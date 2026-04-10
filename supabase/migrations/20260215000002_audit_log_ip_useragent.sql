-- DATA-01: Add IP address and user-agent tracking to audit_logs
--
-- Adds two columns to capture client context for each audit log entry:
-- - ip_address: the client IP (from x-forwarded-for / x-real-ip headers)
-- - user_agent: the client user-agent string
--
-- These fields improve forensic capability and comply with security audit
-- requirements for traceability.

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS ip_address inet,
  ADD COLUMN IF NOT EXISTS user_agent text;

-- Add comments for documentation
COMMENT ON COLUMN public.audit_logs.ip_address IS
  'DATA-01: Client IP address captured from x-forwarded-for or x-real-ip request headers.';

COMMENT ON COLUMN public.audit_logs.user_agent IS
  'DATA-01: Client User-Agent string captured from request headers.';
