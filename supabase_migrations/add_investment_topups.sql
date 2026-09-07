-- Migration: add_investment_topups.sql
-- Adds a pending-approval workflow for investment top-ups:
-- the user submits a top-up request (with optional receipt), an admin
-- approves/rejects it, and only then is the investment updated.

CREATE TABLE IF NOT EXISTS public.investment_topups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id UUID NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  amount DECIMAL(15,2) NOT NULL,
  method VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
  receipt_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_investment_topups_investment_id ON public.investment_topups(investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_topups_status ON public.investment_topups(status);
CREATE INDEX IF NOT EXISTS idx_investment_topups_user_id ON public.investment_topups(user_id);

ALTER TABLE public.investment_topups ENABLE ROW LEVEL SECURITY;

-- Users can view and create their own top-up requests
DROP POLICY IF EXISTS "Users can view their own top-ups" ON public.investment_topups;
CREATE POLICY "Users can view their own top-ups"
  ON public.investment_topups FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create their own top-ups" ON public.investment_topups;
CREATE POLICY "Users can create their own top-ups"
  ON public.investment_topups FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Admins / invest admins can view and manage all top-ups
DROP POLICY IF EXISTS "Admins can manage all top-ups" ON public.investment_topups;
CREATE POLICY "Admins can manage all top-ups"
  ON public.investment_topups FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'invest_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'invest_admin')
    )
  );
