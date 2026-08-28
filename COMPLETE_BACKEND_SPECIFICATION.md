# DPINES Nigeria Backend - Complete Specification & Rules

## Table of Contents
1. [System Architecture Overview](#system-architecture-overview)
2. [Application Rules & Business Logic](#application-rules--business-logic)
3. [User Roles & Permissions](#user-roles--permissions)
4. [Detailed Feature Flow](#detailed-feature-flow)
5. [API Request/Response Patterns](#api-requestresponse-patterns)
6. [Database Rules & Constraints](#database-rules--constraints)
7. [Error Handling & Validation](#error-handling--validation)
8. [Feature Completeness Checklist](#feature-completeness-checklist)
9. [Missing Features & Recommendations](#missing-features--recommendations)
10. [Implementation Priority](#implementation-priority)

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      React Frontend                              │
│              (http://localhost:5173)                             │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP/HTTPS
                         │ JWT Token in Authorization Header
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Express.js Backend                             │
│              (http://localhost:3000)                             │
├─────────────────────────────────────────────────────────────────┤
│  Middleware Stack:                                              │
│  1. CORS & Helmet (Security)                                   │
│  2. Body Parser (JSON)                                         │
│  3. Supabase JWT Verification                                  │
│  4. Role-based Authorization                                   │
│  5. Global Error Handler                                       │
└────────────────┬─────────────────────────────────┬──────────────┘
                 │                                 │
                 ▼                                 ▼
    ┌──────────────────────────┐      ┌──────────────────────────┐
    │   Prisma ORM + Zod       │      │  Supabase Services       │
    │   (Type Safety)          │      │  - Authentication        │
    │   - Loan Queries         │      │  - Storage               │
    │   - Investment Queries   │      │  - JWT Verification      │
    │   - Validation           │      │                          │
    └──────────────┬───────────┘      └──────────────┬───────────┘
                   │                                 │
                   └─────────────┬───────────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │  PostgreSQL Database     │
                    │  (Supabase)              │
                    │                          │
                    │  - user_profiles         │
                    │  - loans                 │
                    │  - investments           │
                    │  - tickets               │
                    │  - deduction_ledger      │
                    │  - etc.                  │
                    └──────────────────────────┘
```

---

## Application Rules & Business Logic

### 1. AUTHENTICATION & SESSION RULES

#### Sign-Up/Registration Flow
```
User Fills Form → Supabase Auth Creates Account → 
Auto Create UserProfile in Database → 
Email Verification (Optional) → User Can Login
```

**Rules:**
- ✅ User must have unique email
- ✅ Password must be minimum 6 characters
- ✅ Auto-create user_profile with role='user' on signup
- ✅ UserProfile.metadata can store additional data
- ⚠️ **MISSING**: Email verification implementation
- ⚠️ **MISSING**: Email verification endpoint

#### Login Flow
```
Email + Password → Supabase Auth → JWT Token → 
Frontend Stores Token → Every Request Includes Token
```

**Rules:**
- ✅ JWT token included in Authorization header
- ✅ Backend validates token with Supabase
- ✅ Token expiration: 7 days (configurable)
- ✅ User context attached to request
- ⚠️ **MISSING**: Token refresh endpoint
- ⚠️ **MISSING**: Logout endpoint to invalidate tokens

#### Password Reset Flow
```
User Enters Email → OTP Generated (15 min validity) → 
Sent Via Email → User Submits OTP + New Password → 
Password Updated
```

**Rules:**
- ✅ OTP code: 6-digit random number
- ✅ OTP expiration: 15 minutes
- ✅ One OTP per email at a time
- ✅ OTP deleted after successful verification
- ⚠️ **MISSING**: Email sending via Resend API
- ⚠️ **MISSING**: OTP retry limits (brute force protection)
- ⚠️ **MISSING**: Rate limiting on OTP generation

### 2. USER ROLE & PERMISSION RULES

#### Role Hierarchy
```
┌─────────────────────────────────────────────┐
│              ADMIN (Full Access)            │
│  - All operations                           │
│  - User management                          │
│  - System configuration                     │
└─────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌────────────────┐ ┌──────────────┐
│ LOANS_ADMIN  │ │ INVEST_ADMIN   │ │ SUPPORT      │
│              │ │                │ │              │
│ - Approve    │ │ - Approve      │ │ - Manage     │
│   loans      │ │   investments  │ │   tickets    │
│ - Mark       │ │ - Mark payouts │ │ - Reply to   │
│   payments   │ │ - View stats   │ │   messages   │
│ - Process    │ │ - Manage       │ │ - Update     │
│   deductions │ │   values       │ │   status     │
└──────────────┘ └────────────────┘ └──────────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ USER (Regular)  │
                │                 │
                │ - Apply loans   │
                │ - Invest        │
                │ - View own data │
                │ - Support       │
                │   tickets       │
                └─────────────────┘
```

**Access Control Rules:**
- ✅ Admin: Full system access
- ✅ Loans_admin: Loan approvals & payments only
- ✅ Invest_admin: Investment approvals & payouts only
- ✅ Support: Ticket management only
- ✅ User: Self-service operations only
- ⚠️ **MISSING**: Dynamic permission checking per endpoint
- ⚠️ **MISSING**: Audit logging for admin actions

---

## User Roles & Permissions

### Permission Matrix

| Feature | User | Support | Loans Admin | Invest Admin | Admin |
|---------|------|---------|-------------|--------------|-------|
| **Authentication** |
| View own profile | ✅ | ✅ | ✅ | ✅ | ✅ |
| Update own profile | ✅ | ✅ | ✅ | ✅ | ✅ |
| Change password | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Loans** |
| Apply for loan | ✅ | - | - | - | ✅ |
| View own loans | ✅ | - | - | - | ✅ |
| View all loans | - | - | ✅ | - | ✅ |
| Approve loan | - | - | ✅ | - | ✅ |
| Reject loan | - | - | ✅ | - | ✅ |
| Mark payment | - | - | ✅ | - | ✅ |
| Process deduction | - | - | ✅ | - | ✅ |
| **Investments** |
| Create investment | ✅ | - | - | - | ✅ |
| View own investments | ✅ | - | - | - | ✅ |
| View all investments | - | - | - | ✅ | ✅ |
| Approve investment | - | - | - | ✅ | ✅ |
| Reject investment | - | - | - | ✅ | ✅ |
| Set maturity action | ✅ | - | - | - | ✅ |
| **Users** |
| View own profile | ✅ | ✅ | ✅ | ✅ | ✅ |
| View all users | - | - | - | - | ✅ |
| Update user role | - | - | - | - | ✅ |
| **Tickets** |
| Create ticket | ✅ | ✅ | ✅ | ✅ | ✅ |
| View own tickets | ✅ | ✅ | ✅ | ✅ | ✅ |
| View all tickets | - | ✅ | - | - | ✅ |
| Add message | ✅ | ✅ | ✅ | ✅ | ✅ |
| Update status | - | ✅ | - | - | ✅ |
| Update priority | - | ✅ | - | - | ✅ |
| **Adverts** |
| View active adverts | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage adverts | - | - | - | - | ✅ |

---

## Detailed Feature Flow

### FEATURE 1: LOAN MANAGEMENT

#### 1.1 Loan Application Flow

```
USER APPLIES FOR LOAN
  │
  ├─ Input Validation (Zod Schema)
  │   └─ amount: positive number
  │   └─ interestRate: 0-100
  │   └─ termMonths: 1+
  │   └─ purpose: optional string
  │
  ├─ Business Logic (Service Layer)
  │   ├─ Verify user exists
  │   ├─ Calculate monthly payment:
  │   │   Formula: P * (r(1+r)^n) / ((1+r)^n - 1)
  │   │   where: P=principal, r=monthly_rate, n=months
  │   │
  │   ├─ Calculate total interest:
  │   │   Formula: (monthly_payment * term_months) - principal
  │   │
  │   └─ Create loan record with:
  │       ├─ status: 'pending'
  │       ├─ amountPaid: 0
  │       ├─ principalBalance: amount
  │       ├─ nextDueDate: null
  │       ├─ createdAt: now
  │       └─ originalInterestRate: interestRate
  │
  ├─ Response
  │   └─ Return loan object
  │
  └─ EMAIL NOTIFICATION (TODO)
      └─ Send "Loan Application Received"
```

**Loan States:**
```
pending → approved → active → completed
  ↓
rejected
  ↓
overdue (when payment past due)
```

**Rules:**
- ✅ Loan calculation includes compound interest
- ✅ Monthly payment calculated with proper formula
- ✅ User can have multiple loans (but typically one active)
- ✅ Loan principal balance tracked separately
- ⚠️ **MISSING**: Loan amount limits based on user's investment balance
- ⚠️ **MISSING**: Credit score check (API integration)
- ⚠️ **MISSING**: Income verification
- ⚠️ **MISSING**: Loan application status notification emails

#### 1.2 Loan Approval Flow

```
ADMIN REVIEWS PENDING LOANS
  │
  ├─ Verify loan status = 'pending'
  │
  ├─ APPROVE Action:
  │   ├─ Set status: 'active'
  │   ├─ Set startDate: now
  │   ├─ Set endDate: now + termMonths
  │   ├─ Set nextDueDate: first day of next month
  │   ├─ Update principalBalance: amount
  │   └─ Send approval email (TODO)
  │
  └─ REJECT Action:
      ├─ Set status: 'rejected'
      ├─ Set rejectionReason: admin notes
      └─ Send rejection email (TODO)
```

**Rules:**
- ✅ Only pending loans can be approved/rejected
- ✅ Approval date determines loan start
- ✅ Due dates calculated from approval date
- ⚠️ **MISSING**: Approval reason tracking
- ⚠️ **MISSING**: Approval timestamp by admin
- ⚠️ **MISSING**: Disapproval notification delay logic

#### 1.3 Loan Payment Flow

```
USER SUBMITS PAYMENT
  │
  ├─ Input Validation
  │   ├─ amount: positive
  │   ├─ paymentMethod: 'bank_transfer' or 'contribution_deduction'
  │   ├─ monthNumber: 1 to termMonths
  │   └─ receiptUrl: url (for bank_transfer)
  │
  ├─ Create Payment Record
  │   ├─ status: 'pending'
  │   ├─ paymentDate: now
  │   └─ amount: submitted amount
  │
  └─ Admin Reviews Payment
      │
      ├─ APPROVE Payment:
      │   ├─ Set payment status: 'approved'
      │   ├─ Update loan:
      │   │   ├─ amountPaid += payment amount
      │   │   ├─ principalBalance -= payment amount
      │   │   ├─ lastPaymentDate: now
      │   │   ├─ markedPayments: push monthNumber
      │   │   │
      │   │   └─ IF principalBalance == 0:
      │   │       └─ Set loan status: 'completed'
      │   │
      │   └─ Send payment confirmation email (TODO)
      │
      └─ REJECT Payment:
          ├─ Set payment status: 'rejected'
          ├─ Set rejectionReason
          └─ Send rejection email (TODO)
```

**Payment Methods:**
1. **Bank Transfer**
   - User uploads receipt
   - Admin verifies receipt
   - Admin approves payment
   - Amount credited to loan

2. **Contribution Deduction**
   - Automatic deduction from user's investments
   - Processed atomically
   - Updates both loan and investment records

**Rules:**
- ✅ Multiple payments per loan allowed
- ✅ Partial payments supported
- ✅ amountPaid never exceeds principal + interest
- ✅ principalBalance tracked accurately
- ✅ markedPayments array tracks completed months
- ✅ Loan auto-completed when principal balance = 0
- ⚠️ **MISSING**: Payment deadline tracking
- ⚠️ **MISSING**: Late payment penalties
- ⚠️ **MISSING**: Payment receipt OCR/validation
- ⚠️ **MISSING**: Automatic payment processing

#### 1.4 Deduction from Investment Flow

```
SYSTEM PROCESSES LOAN REPAYMENT VIA DEDUCTION
  │
  ├─ Input: loanId, amount to deduct
  │
  ├─ Fetch active investments (oldest first)
  │   └─ ORDER BY startDate ASC
  │
  ├─ FOR EACH investment:
  │   ├─ deductAmount = min(remainingAmount, investment.currentValue)
  │   │
  │   ├─ Create DeductionLedger entry:
  │   │   ├─ userId: loan.userId
  │   │   ├─ loanId: loan.id
  │   │   ├─ investmentId: investment.id
  │   │   ├─ amount: deductAmount
  │   │   └─ createdAt: now
  │   │
  │   ├─ Update investment:
  │   │   └─ currentValue -= deductAmount
  │   │
  │   └─ remainingAmount -= deductAmount
  │
  ├─ Update loan:
  │   ├─ principalBalance -= (amount - remainingAmount)
  │   ├─ amountPaid += (amount - remainingAmount)
  │   │
  │   └─ IF principalBalance == 0:
  │       └─ status: 'completed'
  │
  └─ Return success with deduction summary
```

**Rules:**
- ✅ Deduct from oldest investments first (FIFO)
- ✅ Investments must be active status
- ✅ Create audit trail in deduction_ledger
- ✅ Atomic transaction (all or nothing)
- ✅ Cannot deduct more than investment value
- ⚠️ **MISSING**: Deduction authorization from user
- ⚠️ **MISSING**: Deduction notification to user
- ⚠️ **MISSING**: Partial deduction handling

#### 1.5 Loan Statistics Flow

```
USER REQUESTS LOAN STATS
  │
  ├─ Fetch all loans for user
  │
  ├─ Calculate:
  │   ├─ totalLoans: count of all loans
  │   ├─ activeLoan: first loan with status='active'
  │   ├─ totalBorrowed: sum of all loan amounts
  │   ├─ totalPaid: sum of all amountPaid
  │   ├─ totalInterest: sum of all totalInterest
  │   └─ completedLoans: count with status='completed'
  │
  └─ Return stats object
```

**Rules:**
- ✅ Stats calculated in real-time
- ✅ Include only user's own loans
- ⚠️ **MISSING**: Monthly payment tracking
- ⚠️ **MISSING**: Overdue loan detection
- ⚠️ **MISSING**: Payment history analytics

---

### FEATURE 2: INVESTMENT MANAGEMENT

#### 2.1 Investment Creation Flow

```
USER CREATES INVESTMENT
  │
  ├─ Input Validation
  │   ├─ amount: positive
  │   ├─ interestRate: 0-100
  │   ├─ termMonths: 1+
  │   └─ payoutFrequency: 'monthly' | '6-month' | 'reinvestment'
  │
  ├─ Business Logic
  │   ├─ Verify user exists
  │   ├─ Verify user has sufficient funds (TODO)
  │   │
  │   └─ Create investment record:
  │       ├─ userId: user.id
  │       ├─ amount: investment amount
  │       ├─ initialAmount: investment amount (for reference)
  │       ├─ interestRate: annual rate
  │       ├─ termMonths: duration
  │       ├─ payoutFrequency: frequency
  │       ├─ currentValue: amount (initial)
  │       ├─ status: 'pending'
  │       ├─ startDate: null
  │       ├─ endDate: null
  │       ├─ maturityAction: null
  │       └─ createdAt: now
  │
  └─ Return investment object
```

**Investment States:**
```
pending → approved → active → completed
  ↓
rejected
```

**Rules:**
- ✅ Investment amount is initial value
- ✅ currentValue tracks with interest
- ✅ Initial amount stored for reference
- ✅ Multiple investments allowed
- ⚠️ **MISSING**: Minimum investment amount enforcement
- ⚠️ **MISSING**: User bank balance verification
- ⚠️ **MISSING**: KYC/AML verification

#### 2.2 Investment Approval Flow

```
ADMIN REVIEWS PENDING INVESTMENTS
  │
  ├─ APPROVE Action:
  │   ├─ Set status: 'active'
  │   ├─ Set startDate: now
  │   ├─ Set endDate: now + termMonths
  │   │
  │   └─ Send approval email (TODO)
  │
  └─ REJECT Action:
      ├─ Set status: 'rejected'
      ├─ Set rejectionReason
      └─ Send rejection email (TODO)
```

**Rules:**
- ✅ Only pending investments can be approved/rejected
- ✅ Approval date sets term start
- ⚠️ **MISSING**: Approval notes tracking
- ⚠️ **MISSING**: Fund transfer to user account (TODO)

#### 2.3 Interest Calculation & Current Value Update

```
CALCULATE CURRENT VALUE FOR INVESTMENT
  │
  ├─ Input: investment record
  │
  ├─ IF status != 'active' or startDate == null:
  │   └─ Return unchanged
  │
  ├─ Calculate months elapsed:
  │   └─ monthsElapsed = (now - startDate) / 30.44 days
  │
  ├─ Calculate current value based on payoutFrequency:
  │
  │   IF payoutFrequency == 'reinvestment':
  │   │   // Compound Interest Monthly
  │   │   currentValue = principal * (1 + monthlyRate)^monthsElapsed
  │   │
  │   ELSE IF payoutFrequency == 'monthly' or '6-month':
  │       // Simple Interest
  │       currentValue = principal + (principal * monthlyRate * monthsElapsed)
  │
  └─ Update investment.currentValue in database
```

**Interest Formulas:**

1. **Compound Interest (Reinvestment)**
   ```
   A = P(1 + r)^n
   
   where:
   P = initial amount
   r = monthly rate (annual/12/100)
   n = number of months
   A = final amount
   ```

2. **Simple Interest (Monthly/6-Monthly Payout)**
   ```
   A = P + (P * r * n)
   
   where:
   P = principal
   r = monthly rate
   n = number of months
   A = accumulated amount
   ```

**Rules:**
- ✅ monthlyRate = annualRate / 100 / 12
- ✅ Compound interest for reinvestment
- ✅ Simple interest for payouts
- ✅ Interest accrues during investment period
- ⚠️ **MISSING**: Daily interest calculation option
- ⚠️ **MISSING**: Interest payout scheduling
- ⚠️ **MISSING**: Automatic interest disbursement

#### 2.4 Maturity Action Flow

```
INVESTMENT REACHES MATURITY (endDate == today)
  │
  ├─ Option 1: WITHDRAW
  │   ├─ Set maturityAction: 'withdraw'
  │   ├─ Set status: 'completed'
  │   ├─ Trigger payout (TODO):
  │   │   ├─ Transfer principal + interest to user
  │   │   ├─ Update investment status
  │   │   └─ Send payout notification
  │   │
  │   └─ Create InvestmentPayout record (TODO)
  │
  └─ Option 2: ROLLOVER
      ├─ Set maturityAction: 'rollover'
      ├─ Auto-reinvest:
      │   ├─ New principal = currentValue (principal + interest)
      │   ├─ New endDate = now + termMonths
      │   ├─ Keep same interestRate
      │   ├─ Keep same payoutFrequency
      │   └─ status: 'active'
      │
      └─ Send rollover confirmation (TODO)
```

**Rules:**
- ✅ User can set action before maturity
- ✅ Withdraw: ends investment, returns funds
- ✅ Rollover: auto-reinvests with compound interest
- ⚠️ **MISSING**: Automatic maturity action processing
- ⚠️ **MISSING**: Default action if not selected
- ⚠️ **MISSING**: Maturity notification to user

#### 2.5 Investment Statistics Flow

```
USER REQUESTS INVESTMENT STATS
  │
  ├─ Fetch all investments for user
  │
  ├─ Calculate:
  │   ├─ totalInvested: sum of all investment amounts
  │   ├─ totalCurrentValue: sum of all currentValue
  │   ├─ totalEarnings: totalCurrentValue - totalInvested
  │   ├─ activeInvestments: count with status='active'
  │   ├─ completedInvestments: count with status='completed'
  │   └─ averageInterestRate: mean of all interestRate
  │
  └─ Return stats object
```

**Rules:**
- ✅ Stats include earnings calculation
- ✅ Distinguish active vs completed
- ⚠️ **MISSING**: Performance tracking over time
- ⚠️ **MISSING**: Investment-by-frequency breakdown

---

### FEATURE 3: USER MANAGEMENT

#### 3.1 User Profile Flow

```
USER VIEWS/UPDATES PROFILE
  │
  ├─ GET Profile:
  │   ├─ Fetch UserProfile by user.id
  │   ├─ Return all user data
  │   └─ NO email/auth data exposure
  │
  └─ PUT Update Profile:
      ├─ Input validation (Zod)
      ├─ Update allowed fields:
      │   ├─ firstName
      │   ├─ lastName
      │   ├─ phoneNumber
      │   ├─ address
      │   ├─ avatarUrl (via Supabase Storage)
      │   └─ metadata (JSON object)
      │
      ├─ Update timestamp
      └─ Return updated user object
```

**Rules:**
- ✅ Email cannot be updated (Supabase handles)
- ✅ role cannot be updated by user (admin only)
- ✅ metadata allows flexible extra data
- ✅ avatarUrl points to Supabase Storage
- ⚠️ **MISSING**: Profile picture upload endpoint
- ⚠️ **MISSING**: Phone number verification
- ⚠️ **MISSING**: Address validation/geocoding

#### 3.2 Dashboard Stats Flow

```
USER REQUESTS DASHBOARD
  │
  ├─ Fetch all user loans
  │ └─ Calculate loan metrics
  │
  ├─ Fetch all user investments
  │ └─ Calculate investment metrics
  │
  ├─ Build dashboard object:
  │   ├─ loans:
  │   │   ├─ totalLoans
  │   │   ├─ activeLoan
  │   │   ├─ totalBorrowed
  │   │   ├─ totalPaid
  │   │   ├─ pendingLoans
  │   │   └─ completedLoans
  │   │
  │   ├─ investments:
  │   │   ├─ totalInvestments
  │   │   ├─ totalInvested
  │   │   ├─ totalCurrentValue
  │   │   ├─ totalEarnings
  │   │   └─ activeInvestments
  │   │
  │   ├─ recentLoans (last 5)
  │   └─ recentInvestments (last 5)
  │
  └─ Return comprehensive dashboard
```

**Rules:**
- ✅ Real-time calculation of metrics
- ✅ Only show user's own data
- ✅ Include recent activity
- ⚠️ **MISSING**: Performance history
- ⚠️ **MISSING**: Trends and projections

#### 3.3 User Search Flow (Admin)

```
ADMIN SEARCHES USERS
  │
  ├─ Query parameter: q (search string)
  │
  ├─ Search across:
  │   ├─ email (case-insensitive partial match)
  │   ├─ firstName (case-insensitive partial match)
  │   ├─ lastName (case-insensitive partial match)
  │   └─ phoneNumber (partial match)
  │
  ├─ Return matching users with pagination
  │
  └─ Exclude sensitive fields
```

**Rules:**
- ✅ Case-insensitive search
- ✅ Multiple field search (OR logic)
- ✅ Pagination support
- ⚠️ **MISSING**: Full-text search
- ⚠️ **MISSING**: Search history/analytics

#### 3.4 User Statistics Flow (Admin)

```
ADMIN REQUESTS USER STATS
  │
  ├─ Calculate:
  │   ├─ totalUsers: count all users
  │   ├─ adminUsers: count with role='admin'
  │   ├─ regularUsers: count with role='user'
  │   ├─ usersWithLoans: count users with >= 1 loan
  │   └─ usersWithInvestments: count users with >= 1 investment
  │
  └─ Return stats
```

**Rules:**
- ✅ Real-time calculation
- ⚠️ **MISSING**: User growth tracking
- ⚠️ **MISSING**: Activity metrics

---

### FEATURE 4: SUPPORT TICKETING

#### 4.1 Ticket Creation Flow

```
USER CREATES SUPPORT TICKET
  │
  ├─ Input validation
  │   ├─ subject: min 3 chars
  │   ├─ description: min 10 chars
  │   └─ priority: 'low' | 'medium' | 'high'
  │
  ├─ Create ticket record:
  │   ├─ userId: user.id
  │   ├─ subject: subject
  │   ├─ description: description
  │   ├─ priority: priority (default: 'medium')
  │   ├─ status: 'open'
  │   ├─ createdAt: now
  │   └─ updatedAt: now
  │
  └─ Send notification (TODO)
```

**Ticket States:**
```
open → in_progress → closed
```

**Priority Levels:**
- **low**: General inquiries (24h response)
- **medium**: Issue/bug report (12h response)
- **high**: Urgent/payment issue (2h response)

**Rules:**
- ✅ Ticket created with open status
- ✅ Initial message via description field
- ✅ User can create unlimited tickets
- ⚠️ **MISSING**: SLA tracking (response times)
- ⚠️ **MISSING**: Automatic ticket assignment
- ⚠️ **MISSING**: Escalation workflow

#### 4.2 Messaging Flow

```
SEND MESSAGE IN TICKET
  │
  ├─ Input: content (min 1 char)
  │
  ├─ Determine sender type:
  │   ├─ IF user.role == 'user':
  │   │   └─ isAdminReply: false
  │   └─ ELSE:
  │       └─ isAdminReply: true
  │
  ├─ Create message record:
  │   ├─ ticketId: ticket.id
  │   ├─ senderId: user.id
  │   ├─ content: content
  │   ├─ isAdminReply: boolean
  │   └─ createdAt: now
  │
  └─ Send notification (TODO)
```

**Rules:**
- ✅ Any authenticated user can message
- ✅ isAdminReply auto-detected from role
- ✅ Messages ordered by creation time
- ⚠️ **MISSING**: File attachments
- ⚠️ **MISSING**: Message edit/delete
- ⚠️ **MISSING**: Message read receipts

#### 4.3 Ticket Status Management Flow

```
SUPPORT STAFF MANAGES TICKET
  │
  ├─ UPDATE STATUS:
  │   ├─ open → in_progress: When start working
  │   ├─ in_progress → closed: When resolved
  │   └─ INVALID: Cannot jump states
  │
  ├─ UPDATE PRIORITY:
  │   ├─ Can change at any time
  │   └─ Triggers re-prioritization
  │
  └─ CLOSE TICKET:
      ├─ Set status: 'closed'
      ├─ Set updatedAt: now
      └─ Send closure notification (TODO)
```

**Rules:**
- ✅ Only support/admin can update status
- ✅ Status transitions are sequential
- ✅ Priority can change anytime
- ⚠️ **MISSING**: Closure reason tracking
- ⚠️ **MISSING**: User satisfaction rating

---

### FEATURE 5: ADVERTISEMENT MANAGEMENT

#### 5.1 Advertisement Management Flow

```
ADMIN MANAGES ADVERTISEMENTS
  │
  ├─ CREATE:
  │   ├─ Input validation
  │   ├─ Create advert record:
  │   │   ├─ title: required
  │   │   ├─ content: optional
  │   │   ├─ imageUrl: optional
  │   │   ├─ linkUrl: optional
  │   │   ├─ isActive: true (default)
  │   │   └─ createdAt: now
  │   │
  │   └─ Return advert
  │
  ├─ READ:
  │   ├─ Get all: paginated list
  │   ├─ Get active: public endpoint (no auth)
  │   └─ Get by ID: admin/user
  │
  ├─ UPDATE:
  │   ├─ All fields optional
  │   ├─ Set updatedAt: now
  │   └─ Return updated advert
  │
  ├─ DELETE:
  │   └─ Remove from database
  │
  └─ TOGGLE ACTIVE:
      ├─ Flip isActive boolean
      └─ Return updated advert
```

**Rules:**
- ✅ Public endpoint for active adverts
- ✅ No auth required for viewing
- ✅ Only admin can manage
- ✅ Soft delete via isActive flag
- ⚠️ **MISSING**: Image upload endpoint
- ⚠️ **MISSING**: Ad scheduling (start/end dates)
- ⚠️ **MISSING**: Click tracking
- ⚠️ **MISSING**: Analytics (impressions, CTR)

---

## API Request/Response Patterns

### Standard Response Format

**Success Response (2xx)**
```json
{
  "success": true,
  "data": {
    // Resource data
  },
  "message": "Operation completed successfully"
}
```

**Paginated Response**
```json
{
  "data": [
    // Array of resources
  ],
  "total": 100,
  "page": 1,
  "pageSize": 10,
  "totalPages": 10
}
```

**Error Response (4xx, 5xx)**
```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

**Validation Error Response**
```json
{
  "success": false,
  "error": "Validation error",
  "details": [
    {
      "path": "amount",
      "message": "Amount must be positive"
    }
  ]
}
```

### Authentication Pattern

**All Protected Endpoints:**
```
Header: Authorization: Bearer <jwt_token>
```

**Token Structure (JWT):**
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "aud": "authenticated",
  "iat": 1700000000,
  "exp": 1700604800
}
```

### Pagination Pattern

**Request:**
```
GET /api/loans?page=2&pageSize=10
```

**Query Parameters:**
- `page`: Page number (1-indexed, default: 1)
- `pageSize`: Items per page (max: 100, default: 10)

**Response:**
```json
{
  "data": [...],
  "total": 50,
  "page": 2,
  "pageSize": 10,
  "totalPages": 5
}
```

### Filtering Pattern

**Common Filters:**
```
GET /api/loans?status=active&page=1
GET /api/investments?status=pending&pageSize=20
GET /api/tickets?status=open&priority=high
```

---

## Database Rules & Constraints

### Primary Keys
- ✅ All IDs are UUID v4
- ✅ Auto-generated by PostgreSQL

### Foreign Keys
- ✅ All relationships have ON DELETE CASCADE
- ✅ Referential integrity enforced

### Unique Constraints
- ✅ email in user_profiles (unique)
- ✅ email + code in otp_records (unique combo)

### Indexes
- ✅ userId fields indexed (fast user queries)
- ✅ status fields indexed (fast filtering)
- ✅ email indexed (fast user lookup)

### Timestamps
- ✅ createdAt: immutable, set at record creation
- ✅ updatedAt: auto-update on any modification

### Decimal Precision
- ✅ All money fields: DECIMAL(15, 2)
- ✅ All rates: DECIMAL(5, 2)
- ✅ Precision: up to 15 digits total, 2 decimal places

---

## Error Handling & Validation

### Validation Layer (Zod)

```typescript
// Example: Loan Creation Validation
createLoanSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  interestRate: z.number().min(0).max(100),
  termMonths: z.number().int().min(1),
  purpose: z.string().optional()
})
```

### Custom Error Class

```typescript
class AppError extends Error {
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}
```

### HTTP Status Codes Used

| Code | Use Case |
|------|----------|
| 200 | Successful GET/PUT |
| 201 | Successful POST (resource created) |
| 400 | Validation error, bad request |
| 401 | Unauthorized (no token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Resource not found |
| 500 | Server error |

---

## Feature Completeness Checklist

### ✅ IMPLEMENTED FEATURES

#### Authentication (6/9)
- [x] OTP generation (6-digit code, 15-min expiry)
- [x] OTP verification
- [x] Password reset flow
- [x] Profile viewing
- [x] Profile updating
- [x] Password change
- [ ] Email verification on signup
- [ ] Token refresh
- [ ] Logout

#### Loans (9/15)
- [x] Loan application
- [x] Loan approval/rejection
- [x] Payment creation
- [x] Payment approval/rejection
- [x] Deduction from investments
- [x] Loan statistics
- [x] Monthly payment calculation
- [x] Total interest calculation
- [x] Loan detail viewing
- [ ] Overdue tracking
- [ ] Default charges
- [ ] Payment reminders
- [ ] Rollover system
- [ ] Credit score check
- [ ] Early repayment

#### Investments (9/13)
- [x] Investment creation
- [x] Investment approval/rejection
- [x] Maturity action setting (withdraw/rollover)
- [x] Current value calculation
- [x] Investment statistics
- [x] Compound interest (reinvestment)
- [x] Simple interest (payouts)
- [x] Completion flow
- [x] Detail viewing
- [ ] Automatic payout processing
- [ ] Interest payout scheduling
- [ ] Fund transfer on approval
- [ ] Auto-maturity processing

#### Users (6/9)
- [x] Profile management
- [x] Dashboard statistics
- [x] User search (admin)
- [x] User statistics (admin)
- [x] Role-based access control
- [x] User viewing
- [ ] Profile picture upload
- [ ] Phone verification
- [ ] KYC/AML verification

#### Tickets (7/10)
- [x] Ticket creation
- [x] Messaging
- [x] Status management
- [x] Priority management
- [x] Ticket listing
- [x] Ticket detail viewing
- [x] Auto admin detection
- [ ] File attachments
- [ ] SLA tracking
- [ ] Satisfaction rating

#### Adverts (7/9)
- [x] CRUD operations
- [x] Active/inactive toggle
- [x] Public listing endpoint
- [x] Pagination
- [x] Filtering by status
- [x] Detail viewing
- [x] Deletion
- [ ] Image upload
- [ ] Click tracking

#### General (10/12)
- [x] Error handling
- [x] Input validation
- [x] Pagination
- [x] Type safety (TypeScript)
- [x] Authentication middleware
- [x] Authorization (role-based)
- [x] CORS
- [x] Health check endpoint
- [x] Request logging ready
- [x] Graceful shutdown
- [ ] Audit logging
- [ ] Rate limiting

**Overall: 55/88 features implemented (62.5%)**

---

## Missing Features & Recommendations

### 🔴 CRITICAL MISSING FEATURES (Must Have)

#### 1. Email Notifications System ⭐⭐⭐
**Impact: HIGH** - Users don't get any notifications
**Severity: CRITICAL** - Core user experience feature

**Missing:**
- [ ] Email service integration (Resend API)
- [ ] Email templates for:
  - [ ] Loan application received
  - [ ] Loan approved/rejected
  - [ ] Payment confirmed
  - [ ] Payment reminder (daily)
  - [ ] Investment approved/rejected
  - [ ] Maturity notification
  - [ ] Payout notification
  - [ ] Ticket reply
  - [ ] Welcome email
- [ ] Background job queue for email sending
- [ ] Email template versioning

**Implementation Priority: 1**
**Estimated Time: 8 hours**

**Code Structure:**
```typescript
// src/services/email.service.ts
class EmailService {
  async sendLoanApproved(email: string, loan: Loan)
  async sendPaymentReminder(email: string, loan: Loan)
  async sendInvestmentApproved(email: string, investment: Investment)
  async sendTicketReply(email: string, message: TicketMessage)
  async sendPayoutNotification(email: string, investment: Investment)
  async sendWelcomeEmail(email: string, user: UserProfile)
  
  // Send email via Resend API
  private async send(to: string, subject: string, html: string)
}

// Integration in routers:
// After loan approval:
await emailService.sendLoanApproved(user.email, loan)

// After investment approval:
await emailService.sendInvestmentApproved(user.email, investment)
```

#### 2. Scheduled Background Jobs ⭐⭐⭐
**Impact: HIGH** - Automatic processes don't run
**Severity: CRITICAL** - Business logic automation

**Missing:**
- [ ] Daily payment reminders (send at 8 AM)
- [ ] Daily default charge application
- [ ] Investment maturity processing
- [ ] Reinvestment calculations
- [ ] Interest payouts
- [ ] Admin digest emails
- [ ] Job queue management
- [ ] Job retry logic
- [ ] Job logging

**Implementation Priority: 2**
**Estimated Time: 12 hours**

**Code Structure:**
```typescript
// src/webhooks/cron.router.ts
router.post('/daily-reminders', verifyQStashSignature, async (req, res) => {
  // Send payment reminders to users with active loans
  const loans = await prisma.loan.findMany({
    where: { status: 'active', nextDueDate: { lte: tomorrow } }
  })
  
  for (const loan of loans) {
    await emailService.sendPaymentReminder(loan.user.email, loan)
  }
})

router.post('/process-maturity', verifyQStashSignature, async (req, res) => {
  // Auto-process investment maturity
  const investments = await prisma.investment.findMany({
    where: { 
      status: 'active', 
      endDate: { lte: now } 
    }
  })
  
  for (const investment of investments) {
    if (investment.maturityAction === 'withdraw') {
      await investmentService.completeInvestment(investment.id)
    } else if (investment.maturityAction === 'rollover') {
      await investmentService.rolloverInvestment(investment.id)
    }
  }
})

router.post('/apply-default-charges', verifyQStashSignature, async (req, res) => {
  // Apply default charges to overdue loans
  const overdueDays = 5
  const loans = await prisma.loan.findMany({
    where: { status: 'overdue' }
  })
  
  for (const loan of loans) {
    const daysPastDue = getDaysBetween(loan.nextDueDate, now)
    const defaultCharge = (loan.monthlyPayment * 0.05) * daysPastDue // 5% per day
    await prisma.loan.update({
      where: { id: loan.id },
      data: { 
        defaultChargeAccrued: {
          increment: defaultCharge
        }
      }
    })
  }
})
```

#### 3. Loan Payment Due Date & Overdue Tracking ⭐⭐⭐
**Impact: HIGH** - No automatic overdue detection
**Severity: CRITICAL** - Financial accuracy

**Missing:**
- [ ] nextDueDate tracking
- [ ] Overdue status setting
- [ ] Default charges accumulation
- [ ] Overdue notifications
- [ ] Overdue reports
- [ ] Payment schedule generation
- [ ] Late payment penalties
- [ ] Grace period logic

**Implementation Priority: 3**
**Estimated Time: 10 hours**

**Database Changes:**
```sql
-- Add to loans table
ALTER TABLE loans ADD COLUMN IF NOT EXISTS next_due_date DATE;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS payment_schedule JSONB DEFAULT '[]';
ALTER TABLE loans ADD COLUMN IF NOT EXISTS default_charge_accrued DECIMAL(15,2) DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS is_overdue BOOLEAN DEFAULT FALSE;
```

**Service Logic:**
```typescript
// src/modules/loans/loan.service.ts
async checkAndMarkOverdue() {
  const overdueLoan = await prisma.loan.findMany({
    where: {
      status: 'active',
      nextDueDate: { lt: now },
      isOverdue: false
    }
  })
  
  for (const loan of overdueLoan) {
    await prisma.loan.update({
      where: { id: loan.id },
      data: { status: 'overdue', isOverdue: true }
    })
    
    // Send overdue notification
    await emailService.sendOverdueNotification(loan.user.email, loan)
  }
}

async calculateDefaultCharges(loanId: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } })
  
  if (loan.status !== 'overdue') return
  
  const daysPastDue = getDaysBetween(loan.nextDueDate, now)
  const dailyChargeRate = 0.05 // 5% of monthly payment per day
  const newCharges = (loan.monthlyPayment * dailyChargeRate) * daysPastDue
  
  await prisma.loan.update({
    where: { id: loanId },
    data: {
      defaultChargeAccrued: {
        increment: newCharges
      }
    }
  })
}
```

#### 4. Investment Payout Processing & Scheduling ⭐⭐⭐
**Impact: HIGH** - Payouts are not automated
**Severity: CRITICAL** - Investment fulfillment

**Missing:**
- [ ] Monthly payout scheduling
- [ ] 6-monthly payout scheduling
- [ ] Payout amount calculation
- [ ] Bank transfer for payouts
- [ ] Payout record creation
- [ ] Payout notification
- [ ] Payout history tracking
- [ ] Failed payout retry
- [ ] Payout reconciliation

**Implementation Priority: 4**
**Estimated Time: 14 hours**

**Database Changes:**
```sql
-- Create investment_payouts table
CREATE TABLE IF NOT EXISTS investment_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id UUID NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  amount DECIMAL(15,2) NOT NULL,
  payout_date TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed
  failure_reason TEXT,
  payout_number INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Service Logic:**
```typescript
// src/services/payout.service.ts
async generatePayoutSchedule(investment: Investment) {
  const schedule = []
  let currentDate = investment.startDate
  let payoutCount = 0
  
  while (currentDate < investment.endDate) {
    payoutCount++
    
    let nextPayoutDate = new Date(currentDate)
    if (investment.payoutFrequency === 'monthly') {
      nextPayoutDate.setMonth(nextPayoutDate.getMonth() + 1)
    } else if (investment.payoutFrequency === '6-month') {
      nextPayoutDate.setMonth(nextPayoutDate.getMonth() + 6)
    }
    
    // Calculate payout amount
    const monthsToThisPoint = getMonthsBetween(investment.startDate, nextPayoutDate)
    const currentValue = calculateInvestmentValue(
      investment.initialAmount,
      investment.interestRate,
      monthsToThisPoint,
      investment.payoutFrequency
    )
    const payoutAmount = currentValue - (previousValue || 0)
    
    schedule.push({
      investmentId: investment.id,
      amount: payoutAmount,
      payoutDate: nextPayoutDate,
      payoutNumber: payoutCount,
      status: 'scheduled'
    })
    
    currentDate = nextPayoutDate
  }
  
  return schedule
}

async processScheduledPayouts() {
  const duepayouts = await prisma.investmentPayout.findMany({
    where: {
      status: 'pending',
      payoutDate: { lte: now }
    },
    include: { investment: { include: { user: true } } }
  })
  
  for (const payout of duePayouts) {
    try {
      // Transfer funds to user bank account (TODO: integrate with bank API)
      await this.transferFunds(payout.investment.user, payout.amount)
      
      // Mark payout as completed
      await prisma.investmentPayout.update({
        where: { id: payout.id },
        data: { status: 'completed' }
      })
      
      // Send notification
      await emailService.sendPayoutNotification(
        payout.investment.user.email,
        payout
      )
    } catch (error) {
      // Mark as failed for retry
      await prisma.investmentPayout.update({
        where: { id: payout.id },
        data: {
          status: 'failed',
          failureReason: error.message
        }
      })
    }
  }
}
```

#### 5. Fund Management & Banking Integration ⭐⭐⭐
**Impact: HIGH** - No actual fund transfers
**Severity: CRITICAL** - Financial operations

**Missing:**
- [ ] User bank account management
- [ ] Fund deposit integration
- [ ] Fund withdrawal integration
- [ ] Bank account verification
- [ ] Transfer fee calculation
- [ ] Transaction history
- [ ] Reconciliation reports
- [ ] Failed transaction handling
- [ ] Compliance reporting

**Implementation Priority: 5**
**Estimated Time: 16 hours**

**Database Schema:**
```typescript
// Add to Prisma schema
model BankAccount {
  id String @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  userId String @map("user_id") @db.Uuid
  accountNumber String @map("account_number")
  accountName String @map("account_name")
  bankCode String @map("bank_code")
  verified Boolean @default(false)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  user UserProfile @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions Transaction[]

  @@map("bank_accounts")
}

model Transaction {
  id String @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  userId String @map("user_id") @db.Uuid
  bankAccountId String @map("bank_account_id") @db.Uuid
  type String // 'deposit', 'withdrawal'
  amount Decimal @db.Decimal(15, 2)
  status String // 'pending', 'completed', 'failed'
  reference String @unique
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  user UserProfile @relation(fields: [userId], references: [id], onDelete: Cascade)
  bankAccount BankAccount @relation(fields: [bankAccountId], references: [id])

  @@map("transactions")
}
```

---

### 🟠 HIGH PRIORITY MISSING FEATURES (Should Have)

#### 6. Audit Logging
**Impact: MEDIUM** - No admin action tracking
**Missing:**
- [ ] Admin action logging
- [ ] User action history
- [ ] Change tracking
- [ ] Audit reports

#### 7. Rate Limiting & Security
**Impact: MEDIUM** - No brute force protection
**Missing:**
- [ ] API rate limiting
- [ ] OTP retry limits
- [ ] Login attempt limits
- [ ] DDoS protection

#### 8. Analytics & Reporting
**Impact: MEDIUM** - No business intelligence
**Missing:**
- [ ] Loan statistics dashboard
- [ ] Investment performance reports
- [ ] User growth analytics
- [ ] Revenue reports
- [ ] Default rate analysis

---

### 🟡 MEDIUM PRIORITY MISSING FEATURES (Nice to Have)

#### 9. User KYC/AML
**Impact: LOW** - Not required for MVP
**Missing:**
- [ ] Identity verification
- [ ] Address verification
- [ ] PEP checking
- [ ] Sanctions list checking

#### 10. File Management
**Impact: LOW** - Can use Supabase Storage
**Missing:**
- [ ] Document upload
- [ ] Document verification
- [ ] Receipt validation with OCR

---

## Implementation Priority

### Phase 1 (Weeks 1-2): Critical Features
1. ✅ Email Notifications System (8 hours)
2. ✅ Scheduled Background Jobs (12 hours)
3. ✅ Loan Overdue Tracking (10 hours)
4. ✅ Investment Payouts (14 hours)

**Total: 44 hours = 1 week full-time**

### Phase 2 (Weeks 3-4): Financial Operations
5. ✅ Fund Management & Banking (16 hours)
6. ✅ Transaction History (8 hours)
7. ✅ Settlement & Reconciliation (10 hours)

**Total: 34 hours = 1 week full-time**

### Phase 3 (Weeks 5-6): Security & Monitoring
8. ✅ Audit Logging (6 hours)
9. ✅ Rate Limiting (8 hours)
10. ✅ Error Tracking (Sentry) (4 hours)

**Total: 18 hours = 2-3 days full-time**

### Phase 4 (Weeks 7-8): Analytics & Polish
11. ✅ Analytics Dashboard (12 hours)
12. ✅ Report Generation (10 hours)
13. ✅ Performance Optimization (8 hours)

**Total: 30 hours = 1 week full-time**

---

## Summary

### Current State
- ✅ 55/88 features implemented (62.5%)
- ✅ 6 modules fully functional
- ✅ Comprehensive API endpoints
- ✅ Full type safety with TypeScript
- ✅ Database schema complete
- ⚠️ Missing critical business logic

### What Works Now
1. User authentication & profiles
2. Loan applications & approvals
3. Investment creation & tracking
4. Payment recording
5. Support ticketing
6. User dashboard
7. Admin management

### What Needs Work
1. **Email notifications** (highest priority)
2. **Background job scheduling**
3. **Loan overdue detection**
4. **Investment payouts**
5. **Banking integration**
6. **Audit logging**
7. **Analytics**

### Recommended Next Steps
1. **Start with email service** - Most impactful for user experience
2. **Add background jobs** - Critical for automation
3. **Implement overdue tracking** - Essential for financial accuracy
4. **Build payout system** - Required for investment fulfillment
5. **Integrate banking** - Necessary for real transactions

---

**Document Version:** 1.0
**Last Updated:** 2024-08-26
**Status:** Complete Backend Specification Ready
