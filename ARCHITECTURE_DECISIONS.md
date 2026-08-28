# Architecture Decisions & Design Rationale

## Overview
This document explains the architectural choices made for the DPINES Nigeria backend and why they were chosen.

---

## 1. Express.js + TypeScript

### Decision: Use Express.js instead of other frameworks

**Alternatives Considered:**
- Fastify (modern, fast)
- NestJS (enterprise, opinionated)
- Hono (edge runtime ready)
- Django/Flask (Python-based)

### Why Express.js?
✅ Industry standard for Node.js
✅ Mature ecosystem (8 years+)
✅ Large community
✅ Easy to learn and maintain
✅ Lightweight (no overhead)
✅ Perfect for monolithic API

### Why TypeScript?
✅ Catches errors at compile time
✅ Better IDE support & autocomplete
✅ Self-documenting code
✅ Easier refactoring
✅ Team collaboration

---

## 2. Prisma ORM

### Decision: Use Prisma instead of raw SQL

**Alternatives Considered:**
- Raw SQL queries
- Sequelize ORM
- TypeORM
- Knex.js
- Drizzle ORM

### Why Prisma?
✅ Type-safe database operations
✅ Automatic migrations
✅ Intuitive query syntax
✅ Built-in pagination
✅ Excellent TypeScript support
✅ Schema as single source of truth
✅ Dev tools (Prisma Studio)

### Design Pattern: Service Layer
```
Router → Controller → Service → Prisma → Database

Benefits:
- Controllers: Request/response mapping
- Services: Business logic (reusable)
- Prisma: Data access (testable)
```

---

## 3. PostgreSQL + Supabase

### Decision: Use PostgreSQL (via Supabase)

**Alternatives Considered:**
- MongoDB (document-based)
- Firebase (real-time)
- DynamoDB (serverless)
- MySQL (traditional)

### Why PostgreSQL + Supabase?
✅ ACID compliance (financial accuracy)
✅ Complex queries support
✅ Mature and reliable
✅ Supabase provides managed hosting
✅ JWT authentication built-in
✅ Row Level Security for multi-tenancy
✅ Free tier for development

### Database Design Choices

#### UUID over Serial IDs
```sql
-- Why UUID?
✅ Globally unique (no collisions)
✅ No sequential pattern (security)
✅ Better for distributed systems
✅ Can generate client-side
```

#### Decimal over Float for Money
```sql
-- Why Decimal(15,2)?
✅ Exact precision (no rounding errors)
✅ Perfect for financial calculations
✅ Prevents money loss
✅ Standard in accounting
```

#### ON DELETE CASCADE
```sql
-- Why?
✅ Automatic cleanup (no orphaned records)
✅ Maintains referential integrity
✅ Simpler application logic
✅ Prevents data inconsistency
```

---

## 4. Supabase Authentication

### Decision: Delegate auth to Supabase

**Alternatives Considered:**
- Custom JWT implementation
- Auth0
- Firebase Auth
- Okta
- Passport.js + sessions

### Why Supabase Auth?
✅ JWT-based (stateless)
✅ OTP support out-of-box
✅ No session management needed
✅ Integrated with Supabase
✅ Secure password hashing
✅ OAuth ready (future)

### Implementation Pattern
```
Frontend                      Backend                     Supabase
────────────────────────────────────────────────────────────────
   │                            │                            │
   ├─ Login →─────────────────→ │                            │
   │                            ├─ Verify JWT ──────────────→ │
   │                            │ ←─ User data ─────────────┤
   │                            │                            │
   │ ←─ JWT token ─────────────┤                            │
   │                            │                            │
   └─ API call + token ──────→ │                            │
                                ├─ Verify token ───────────→ │
                                │ ←─ User context ──────────┤
```

---

## 5. Zod Validation

### Decision: Use Zod over Joi, Yup, or Validator.js

**Why Zod?**
✅ TypeScript-first design
✅ Type inference from schema
✅ Composable validators
✅ Clear error messages
✅ Zero dependencies
✅ Excellent performance

### Validation Pattern
```typescript
// Schema defines both validation AND types
const schema = z.object({
  amount: z.number().positive(),
  email: z.string().email()
})

// Inferred type from schema
type Input = z.infer<typeof schema>

// Both validation and type safety
const data = schema.parse(input) // throws on invalid
const safe = schema.safeParse(input) // returns result
```

---

## 6. Module-Based Architecture

### Decision: Organize by feature (module), not by layer

**Alternative Structure (NOT used):**
```
backend/
├── controllers/
├── services/
├── models/
├── utils/
└── routes/
```

**Chosen Structure (Module-based):**
```
backend/
└── modules/
    ├── auth/
    │   ├── auth.controller.ts
    │   ├── auth.service.ts
    │   └── auth.router.ts
    ├── loans/
    │   ├── loan.controller.ts
    │   ├── loan.service.ts
    │   └── loan.router.ts
    └── ...
```

### Why Module-Based?
✅ Feature-focused organization
✅ Easier to find related code
✅ Self-contained modules
✅ Scales well as codebase grows
✅ Clear separation of concerns
✅ Easy to remove/add features
✅ Better code reusability

---

## 7. Error Handling Strategy

### Decision: Centralized error middleware + Custom AppError class

```typescript
// Custom AppError
class AppError extends Error {
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

// Global error middleware
app.use(errorHandler)

// Usage in services
if (!user) throw new AppError(404, "User not found")
```

### Why This Approach?
✅ Consistent error format
✅ Proper HTTP status codes
✅ No sensitive data leakage
✅ Easy to add logging/monitoring
✅ Type-safe error handling
✅ Graceful error recovery

---

## 8. Financial Logic Design

### Decision: Keep calculations in service layer

```typescript
// NOT in database
✓ Monthly payment calculation
✓ Interest calculations
✓ Deduction processing

// NOT in controller
✓ Validation passes to service
✓ Service handles all math
✓ Controller just responds
```

### Why Service Layer?
✅ Testable in isolation
✅ No database round trips
✅ Reusable across endpoints
✅ Easy to unit test
✅ Consistent calculations
✅ Clear business logic

### Formula Implementation Examples

#### Loan Monthly Payment
```typescript
function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number
): number {
  const monthlyRate = annualRate / 100 / 12
  
  if (monthlyRate === 0) {
    return principal / termMonths
  }
  
  return (
    (principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
    (Math.pow(1 + monthlyRate, termMonths) - 1)
  )
}
```

#### Investment Interest
```typescript
function calculateInvestmentCurrentValue(
  principal: number,
  annualRate: number,
  monthsElapsed: number,
  frequency: string
): number {
  const monthlyRate = annualRate / 100 / 12
  
  if (frequency === "reinvestment") {
    // Compound interest monthly
    return principal * Math.pow(1 + monthlyRate, monthsElapsed)
  }
  
  // Simple interest for monthly/6-monthly
  return principal + principal * monthlyRate * monthsElapsed
}
```

---

## 9. Deduction Logic (Loan Repayment from Investments)

### Decision: FIFO (First-In-First-Out) deduction

```
Why FIFO?
✅ Fair to all investments
✅ Oldest investments deducted first
✅ Predictable for users
✅ Easy to understand
✅ Standard in accounting
```

### Implementation
```typescript
// Get active investments oldest first
const investments = await prisma.investment.findMany({
  where: { userId, status: 'active' },
  orderBy: { startDate: 'asc' }
})

// Deduct amount from each investment
for (const investment of investments) {
  const deductAmount = min(remainingAmount, investment.currentValue)
  
  // Update investment
  await prisma.investment.update({
    where: { id: investment.id },
    data: { currentValue: subtract(investment.currentValue, deductAmount) }
  })
  
  // Create audit entry
  await prisma.deductionLedger.create({
    data: { userId, loanId, investmentId, amount: deductAmount }
  })
  
  remainingAmount -= deductAmount
  
  if (remainingAmount <= 0) break
}
```

---

## 10. Pagination Design

### Decision: Page-based (not cursor-based)

**Alternatives:**
- Cursor-based pagination
- Offset-based
- Keyset pagination

### Why Page-Based?
✅ Simple for users (page numbers)
✅ Easy to implement
✅ Works well for small datasets
✅ Matches user expectations
✅ Can add cursor later if needed

### Implementation
```typescript
// Frontend requests page
GET /api/loans?page=2&pageSize=10

// Backend calculates skip
const skip = (page - 1) * pageSize
const take = pageSize

// Database query
const [items, total] = await Promise.all([
  prisma.loan.findMany({ skip, take }),
  prisma.loan.count()
])

// Response includes pagination info
{
  data: [...],
  total: 50,
  page: 2,
  pageSize: 10,
  totalPages: 5
}
```

---

## 11. Response Format Design

### Decision: Consistent JSON wrapper

```json
// Success
{
  "success": true,
  "data": { /* resource */ },
  "message": "Optional message"
}

// Error
{
  "success": false,
  "error": "Error message"
}

// Paginated
{
  "data": [/* items */],
  "total": 100,
  "page": 1,
  "pageSize": 10,
  "totalPages": 10
}
```

### Why Wrapper Format?
✅ Consistent across all endpoints
✅ Easy for frontend to handle
✅ Includes metadata (pagination)
✅ Clear success/error distinction
✅ Message support
✅ Extensible for future additions

---

## 12. Middleware Stack Order

### Decision: Specific middleware ordering

```typescript
// 1. Security
app.use(helmet())
app.use(cors())

// 2. Parsing
app.use(express.json())

// 3. Logging (can add)
app.use(requestLogger)

// 4. Routes
app.use('/api/auth', authRouter)
app.use('/api/loans', loanRouter)

// 5. Error handling (must be last)
app.use(errorHandler)
```

### Why This Order?
✅ Security first
✅ Parse before routing
✅ Logging for debugging
✅ Error handler catches everything
✅ Middleware can't catch if out of order

---

## 13. Environment Configuration

### Decision: Centralized env.ts file

```typescript
// src/configs/env.ts
export const env = {
  PORT: parseInt(process.env.PORT || "3000"),
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL: process.env.DATABASE_URL || "",
  // ... all env vars
}

// Usage anywhere
import { env } from '@/configs/env'
console.log(env.PORT)
```

### Why Centralized?
✅ Single source of truth
✅ Type-safe access
✅ Easy to add/remove vars
✅ Validation in one place
✅ IDE autocomplete support
✅ No scattered process.env calls

---

## 14. Missing Features Design (Future)

### Email Service Architecture (Not Yet Implemented)

```typescript
// src/services/email.service.ts
class EmailService {
  private resend: Resend
  
  async send(to: string, subject: string, html: string) {
    // Send via Resend API
  }
  
  async sendLoanApproved(email: string, loan: Loan) {
    const html = this.templates.loanApproved(loan)
    await this.send(email, "Loan Approved", html)
  }
}
```

### Background Jobs Architecture (Not Yet Implemented)

```typescript
// src/webhooks/cron.router.ts
router.post('/daily-reminders', async (req, res) => {
  // Verify QStash signature
  const isValid = await verifyQStashSignature(req)
  
  // Send reminders to all users with due payments
  const loans = await getLoansDueToday()
  for (const loan of loans) {
    await emailService.sendPaymentReminder(loan)
  }
})
```

### Fund Management Architecture (Not Yet Implemented)

```typescript
// src/services/bank.service.ts
class BankService {
  async transferFunds(
    fromUser: UserProfile,
    toUser: UserProfile,
    amount: number
  ) {
    // Initiate bank transfer
    // Create transaction record
    // Send confirmation emails
  }
}
```

---

## 15. Testing Strategy (Future)

### Recommended Testing Approach

```typescript
// Unit Tests (service layer)
describe('LoanService', () => {
  it('calculates monthly payment correctly', () => {
    const payment = calculateMonthlyPayment(100000, 12, 12)
    expect(payment).toBe(expectedValue)
  })
})

// Integration Tests (API endpoints)
describe('POST /api/loans', () => {
  it('creates loan with valid input', async () => {
    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50000, ... })
    
    expect(res.status).toBe(201)
    expect(res.body.data.id).toBeDefined()
  })
})

// E2E Tests (full user flows)
describe('Loan Application Flow', () => {
  it('allows user to apply and get loan approved', async () => {
    // User applies
    // Admin approves
    // User makes payment
    // Loan completed
  })
})
```

---

## Summary of Architectural Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Framework | Express.js | Industry standard, lightweight |
| Language | TypeScript | Type safety, better tooling |
| Database | PostgreSQL | ACID compliance, reliability |
| ORM | Prisma | Type-safe, intuitive |
| Auth | Supabase | JWT, no session overhead |
| Validation | Zod | TypeScript-first, clean |
| Organization | Module-based | Feature-focused, scalable |
| Errors | Custom AppError | Consistent error handling |
| Calculations | Service layer | Testable, reusable |
| Deduction | FIFO | Fair, predictable |
| Pagination | Page-based | Simple, intuitive |
| Responses | JSON wrapper | Consistent across endpoints |
| Config | Centralized env | Type-safe, organized |

---

## Trade-offs & Rationale

### Simplicity vs. Power
✅ Chose simplicity
- Express.js is lightweight (can upgrade later to NestJS)
- Page-based pagination (cursor available if needed)

### Built-in vs. Custom
✅ Chose built-in where possible
- Supabase Auth (don't reinvent)
- Resend for email (not custom SMTP)

### Quick Start vs. Enterprise-Ready
✅ Chose quick start + extensibility
- Can add features without major refactoring
- Foundation is solid

---

## Performance Considerations

### Database Optimization
```typescript
// Always use indexes
✅ userId (fast user lookups)
✅ status (fast filtering)
✅ email (user search)

// Avoid N+1 queries
✅ Use Prisma include/select
✅ Batch operations
```

### API Optimization
```typescript
// Pagination
✅ Limits large result sets

// Caching (future)
✅ Redis for frequently accessed data

// Compression
✅ gzip via Express middleware
```

---

**Document Version:** 1.0
**Last Updated:** 2024-08-26
**Architecture Status:** Production-Ready
