# DPINES Nigeria - Express.js Backend

A robust, TypeScript-based Express.js backend for the DPINES Nigeria fintech platform, providing comprehensive APIs for loans, investments, user management, and admin operations.

## 🚀 Features

- **Loan Management**: Complete loan lifecycle from application to repayment
- **Investment Management**: Fixed-term deposits with compound interest calculations
- **User Management**: Profile management with role-based access control
- **Ticketing System**: Support tickets with messaging
- **Admin Dashboard**: Comprehensive administration tools
- **Type Safety**: Full TypeScript implementation with strict type checking
- **Security**: JWT authentication via Supabase, role-based authorization
- **Error Handling**: Centralized error management with proper HTTP status codes

## 📋 Prerequisites

- Node.js >= 18.0.0
- npm or pnpm or bun
- PostgreSQL database (Supabase recommended)
- Supabase project credentials

## 🛠️ Setup

### 1. Install Dependencies

```bash
npm install
# or
pnpm install
# or
bun install
```

### 2. Environment Configuration

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

**Required environment variables:**

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/dpines_db"

# Supabase
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Email Service
RESEND_API_KEY="your-resend-api-key"
ADMIN_NOTIFICATION_EMAIL="admin@dpines.com"

# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL="http://localhost:5173"
```

### 3. Database Setup

Generate Prisma client:

```bash
npm run prisma:generate
```

Run migrations:

```bash
npm run prisma:migrate
```

### 4. Development Server

Start the development server with hot-reload:

```bash
npm run dev
```

The server will run on `http://localhost:3000`

## 📁 Project Structure

```
src/
├── configs/           # Configuration files (database, env, Supabase)
├── middlewares/       # Express middlewares (auth, error handling)
├── modules/           # Feature modules
│   ├── auth/         # Authentication routes, controllers, services
│   ├── loans/        # Loan management
│   ├── investments/  # Investment management
│   ├── tickets/      # Support ticketing
│   ├── adverts/      # Advertisements
│   └── users/        # User management
├── lib/              # Utilities and validators
├── types/            # TypeScript type definitions
└── index.ts          # Main Express app entry point

prisma/
└── schema.prisma     # Database schema
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/otp/generate` - Generate OTP for password reset
- `POST /api/auth/otp/verify` - Verify OTP
- `POST /api/auth/reset-password` - Reset password
- `GET /api/auth/profile` - Get user profile (protected)
- `PUT /api/auth/profile` - Update user profile (protected)
- `POST /api/auth/change-password` - Change password (protected)

### Loans
- `POST /api/loans` - Create loan application
- `GET /api/loans/user/my-loans` - Get user's loans
- `GET /api/loans/:loanId` - Get loan details
- `POST /api/loans/:loanId/payments` - Create payment
- `POST /api/loans/:loanId/approve` - Approve loan (admin)
- `POST /api/loans/:loanId/reject` - Reject loan (admin)
- `POST /api/loans/:loanId/deduct` - Process deduction (admin)

### Investments
- `POST /api/investments` - Create investment
- `GET /api/investments/user/my-investments` - Get user's investments
- `GET /api/investments/:investmentId` - Get investment details
- `POST /api/investments/:investmentId/approve` - Approve investment (admin)
- `POST /api/investments/:investmentId/maturity-action` - Set maturity action
- `GET /api/investments/user/stats` - Get investment statistics

### Users
- `GET /api/users/me/profile` - Get current user profile
- `PUT /api/users/me/profile` - Update profile
- `GET /api/users/me/dashboard-stats` - Get dashboard statistics
- `GET /api/users` - List all users (admin)
- `GET /api/users/search` - Search users (admin)
- `PUT /api/users/:userId/role` - Update user role (admin)

### Tickets
- `POST /api/tickets` - Create support ticket
- `GET /api/tickets/user/my-tickets` - Get user's tickets
- `GET /api/tickets/:ticketId` - Get ticket details
- `POST /api/tickets/:ticketId/messages` - Add message to ticket

### Adverts
- `GET /api/adverts/active` - Get active advertisements (public)
- `GET /api/adverts` - Get all advertisements
- `POST /api/adverts` - Create advertisement (admin)
- `PUT /api/adverts/:advertId` - Update advertisement (admin)
- `DELETE /api/adverts/:advertId` - Delete advertisement (admin)

## 🔐 Authentication

The backend uses Supabase JWT authentication. Include the token in the Authorization header:

```bash
curl -H "Authorization: Bearer <your_jwt_token>" http://localhost:3000/api/users/me/profile
```

## 🛡️ Role-Based Access Control

Supported roles:
- `user` - Regular user
- `admin` - Full system access
- `loans_admin` - Loan management only
- `invest_admin` - Investment management only
- `support` - Support ticket handling

## 📊 Database Models

- **UserProfile** - User accounts and profiles
- **Loan** - Loan records with payment tracking
- **Investment** - Investment/contribution records
- **LoanPayment** - Individual loan payment records
- **DeductionLedger** - Audit trail for deductions
- **Ticket** - Support tickets
- **TicketMessage** - Ticket messages
- **Advert** - Advertisements
- **OtpRecord** - OTP records for password reset

## 🧪 Development

### Build
```bash
npm run build
```

### Type Check
```bash
npm run type-check
```

### Lint
```bash
npm run lint
```

### Production Start
```bash
npm run start
```

## 📝 API Response Format

**Success Response:**
```json
{
  "success": true,
  "data": {...},
  "message": "Success message"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message"
}
```

**Paginated Response:**
```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "pageSize": 10,
  "totalPages": 10
}
```

## 🚀 Deployment

### Vercel
1. Push code to GitHub
2. Import repository in Vercel
3. Set environment variables
4. Deploy

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/index.js"]
```

Build and run:
```bash
docker build -t dpines-backend .
docker run -p 3000:3000 --env-file .env dpines-backend
```

## 📚 Documentation

For more detailed documentation, see:
- [Architecture Documentation](../Architecture/express_repo_structure.md)
- [Migration Guide](../Architecture/migration.md)
- [Database Rules](../Architecture/db_rules_and_functions.md)

## 🤝 Contributing

Follow these guidelines:
1. Use TypeScript for all new code
2. Follow the module structure pattern
3. Add proper error handling
4. Include type definitions
5. Use Zod for validation
6. Write clear commit messages

## 📄 License

MIT License - See LICENSE file for details

## 🆘 Support

For issues and questions:
1. Check existing GitHub issues
2. Create a new issue with detailed description
3. Contact the development team

---

**Built with ❤️ for DPINES Nigeria**
