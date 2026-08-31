-- Add collector_id field to loans table
-- This allows tracking which loan officer/collector is responsible for a loan

ALTER TABLE public.loans 
ADD COLUMN collector_id UUID;

-- Create foreign key relationship to user_profiles
ALTER TABLE public.loans
ADD CONSTRAINT fk_loans_collector
FOREIGN KEY (collector_id) 
REFERENCES public.user_profiles(id) 
ON DELETE SET NULL 
ON UPDATE NO ACTION;

-- Create index on collector_id for faster lookups
CREATE INDEX idx_loans_collector_id ON public.loans(collector_id);

-- Add comment for documentation
COMMENT ON COLUMN public.loans.collector_id IS 'UUID of the loan officer/collector responsible for this loan';
