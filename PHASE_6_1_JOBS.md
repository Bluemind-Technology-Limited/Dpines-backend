# Phase 6.1: Background Job System - Setup & Configuration

**Status**: ✅ COMPLETE

## Overview

Implemented complete background job orchestration system using **Upstash QStash** for scheduled cron jobs. Three core jobs handle critical financial operations:

1. **Payment Reminders** - Daily at 8 AM UTC
2. **Late Fee Application** - Daily at 9 AM UTC  
3. **Maturity Processing** - Daily at 10 AM UTC

## Implementation

### 1. Jobs Service (`/src/services/jobs.service.ts`)

**Core Features**:

#### Payment Reminders Job
```typescript
schedulePaymentReminders()  // Schedule job via QStash cron
executePaymentReminders()   // Execute job (called by cron/manual)
```

- **Trigger**: Daily at 8 AM UTC
- **Criteria**: Active loans with `next_due_date` within 3-day window
- **Action**: Send notification 3 days before payment due
- **Integration**: Uses `notificationService.notifyLoanPaymentReminder()`
- **Failure Mode**: Non-blocking (email failure doesn't stop payment system)

Algorithm:
1. Find all active loans due in 3 days (±1 day tolerance for daily cron)
2. Filter by user notification preferences (`loanReminders` enabled)
3. Send reminder via email + in-app notification
4. Log processed count and failures

#### Late Fee Application Job
```typescript
scheduleLateFeeApplication()   // Schedule job via QStash cron
executeLateFeeApplication()    // Execute job (called by cron/manual)
```

- **Trigger**: Daily at 9 AM UTC
- **Criteria**: Active loans with `next_due_date` < now (overdue)
- **Action**: Apply 1% daily late fee (max 7 days = 7%)
- **Integration**: Uses `loanService.applyLateFeeWithNotification()`
- **Duplicate Prevention**: Checks ledger for same-day fees

Algorithm:
1. Find all active loans where `next_due_date` is in the past
2. Calculate days overdue (capped at 7 days per run)
3. Check if fee already applied today (prevents duplicate)
4. Calculate: `feeAmount = monthlyPayment * (feeDays * 0.01)`
5. Apply via `loanService.applyLateFeeWithNotification()`
6. Send notification to borrower
7. Log transaction + audit trail

#### Maturity Processing Job
```typescript
scheduleMaturityProcessing()   // Schedule job via QStash cron
executeMaturityProcessing()    // Execute job (called by cron/manual)
```

- **Trigger**: Daily at 10 AM UTC
- **Criteria**: Active investments where `end_date <= now` and `maturity_action = "rollover"`
- **Action**: Auto-reinvest matured investment
- **Integration**: Uses `investmentService.processMaturedInvestments()`

Algorithm:
1. Find all active investments past `end_date`
2. With `maturityAction = "rollover"` and `maturityProcessed = false`
3. Call `investmentService.processMaturedInvestments()` for batch processing
4. Each investment:
   - Calculate final matured value (compound interest over full term)
   - Mark old investment as "completed" with `maturityProcessed = true`
   - Create NEW investment with matured value as principal
   - Create ledger entry (reinvestment transaction)
   - Create audit log (old→new investment)
   - Send maturity notification
5. Return summary: `{processed, failed, reinvestedAmount}`

### 2. Jobs Controller (`/src/modules/jobs/jobs.controller.ts`)

**Endpoints**:

```typescript
POST /api/jobs/setup
// Admin-only: Initial setup of all three background jobs
// Schedules payment reminders, late fees, and maturity processing
// Returns: {success, message, data: {paymentReminders, lateFees, maturityProcessing}}

POST /api/jobs/trigger/payment_reminders
// Manual trigger for payment reminder job (for testing/cron)
// No auth required (use QStash signature verification in production)
// Returns: {success, message, data: {processedCount, failedCount, details}}

POST /api/jobs/trigger/late_fees
// Manual trigger for late fee application job
// No auth required (use QStash signature verification in production)
// Returns: {success, message, data: {processedCount, failedCount, totalFeesAmount}}

POST /api/jobs/trigger/maturity
// Manual trigger for maturity processing job
// No auth required (use QStash signature verification in production)
// Returns: {success, message, data: {processedCount, failedCount}}

GET /api/jobs/status
// Get status of all scheduled jobs (authenticated)
// Returns: {success, message, data: [{id, name, type, schedule, enabled, nextRun}]}

GET /api/jobs/status/:jobId
// Get status of specific job (authenticated)
// Returns: {success, message, data: {jobId, status, lastUpdated}}

POST /api/jobs/manual-trigger
// Admin-only: Manually trigger any job immediately (for testing)
// Body: {jobType: "payment_reminder" | "late_fee_application" | "maturity_processing"}
// Returns: Same as trigger endpoints
```

### 3. Environment Configuration

Add to `.env`:

```env
# QStash (Upstash)
QSTASH_CURRENT_SIGNING_KEY="your-current-signing-key"
QSTASH_NEXT_SIGNING_KEY="your-next-signing-key"
QSTASH_TOKEN="your-qstash-token"

# Site URL (used for webhook callbacks)
SITE_URL="http://localhost:3000"
```

**Note**: Get credentials from [Upstash Console](https://console.upstash.com) → QStash section

### 4. QStash Integration

**How it Works**:

1. **Setup Phase**: `/api/jobs/setup` calls `jobsService.scheduleAllJobs()`
   - Each method publishes to QStash with cron expression
   - QStash stores the scheduled job

2. **Scheduled Execution**: QStash triggers endpoints at scheduled times
   - Daily at 8 AM UTC: `POST http://your-domain/api/jobs/trigger/payment_reminders`
   - Daily at 9 AM UTC: `POST http://your-domain/api/jobs/trigger/late_fees`
   - Daily at 10 AM UTC: `POST http://your-domain/api/jobs/trigger/maturity`

3. **Job Execution**: Endpoints call corresponding `execute*()` methods
   - Query database for affected records
   - Process each record (send notification, apply fee, reinvest)
   - Return summary results

4. **Error Handling**:
   - Individual record failures don't stop other records
   - All errors logged to console
   - Job returns success=true even if some records failed (best-effort)
   - Non-blocking: if notification fails, business logic still completes

## Key Features

### ✅ Scheduling
- **QStash Cron**: Industry-standard cron expressions (0 8 * * * = 8 AM daily)
- **Timezone**: All times in UTC (configure in Upstash for your timezone)
- **Reliability**: QStash guaranteed delivery with retries

### ✅ Duplicate Prevention
- Daily fee application checks ledger for same-day fees
- Investment maturity uses `maturityProcessed` flag
- Payment reminders use date window to avoid duplicates

### ✅ Error Handling
- Individual record failures don't block batch processing
- Non-blocking: failures don't stop business logic
- Console logging for debugging
- Graceful error messages in response bodies

### ✅ Monitoring & Control
- `/api/jobs/status` - View all scheduled jobs + next run times
- `/api/jobs/manual-trigger` - Force immediate execution for testing
- `/api/jobs/trigger/*` - Manual endpoints for debugging

### ✅ Integration
- **Payment Reminders**: Integrate with Phase 5 notification system
- **Late Fees**: Integrate with Phase 1.1 loan payment processing
- **Maturity**: Integrate with Phase 3.2 investment auto-reinvestment

## Database Schema Requirements

No new tables created. Jobs service uses existing tables:

- `loans` - Query for overdue/upcoming payments
- `investments` - Query for matured investments
- `user_notifications` - Create notification records
- `transaction_ledger` - Log financial movements
- `audit_logs` - Log admin actions
- `user_profiles` - Get notification preferences

## Testing

### Local Testing (No QStash)

```bash
# Manually trigger payment reminders
curl -X POST http://localhost:3000/api/jobs/trigger/payment_reminders

# Manually trigger late fees
curl -X POST http://localhost:3000/api/jobs/trigger/late_fees

# Manually trigger maturity processing
curl -X POST http://localhost:3000/api/jobs/trigger/maturity

# View scheduled jobs
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/jobs/status
```

### Production QStash Setup

1. Create Upstash account: https://upstash.com
2. Get QStash credentials from console
3. Add to `.env`:
   ```env
   QSTASH_TOKEN="your-token"
   QSTASH_CURRENT_SIGNING_KEY="your-key"
   QSTASH_NEXT_SIGNING_KEY="your-key"
   ```
4. Call `/api/jobs/setup` once to schedule all jobs
5. QStash will automatically call webhook endpoints daily

## Security Notes

### Current (Development)
- Trigger endpoints accept all requests (no auth)
- Add QStash signature verification in Phase 8

### Production Checklist (Phase 8)
- Verify QStash signature on trigger endpoints
- Use admin-only middleware for `/api/jobs/setup`
- Use admin-only middleware for `/api/jobs/manual-trigger`
- Add rate limiting to prevent abuse
- Add logging/monitoring to detect anomalies

## Next Phase: Phase 6.2

Build on this infrastructure to:
- Add per-loan late fee calculation logic
- Add maturity notification templates
- Add job retry logic for failed executions
- Add job execution history/audit trail

## Files Created

- `/src/services/jobs.service.ts` (455 lines)
- `/src/modules/jobs/jobs.controller.ts` (175 lines)
- `/src/modules/jobs/index.ts` (1 line)

## Files Modified

- `/src/index.ts` - Added jobs routes

## Build Status

✅ All services compile cleanly (0 TypeScript errors in Phase 6.1 code)

---

**Phase 6.1 Complete**: Background job infrastructure ready for Phase 6.2 integration testing.
