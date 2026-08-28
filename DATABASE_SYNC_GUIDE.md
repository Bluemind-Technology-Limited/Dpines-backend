# Database Sync Guide - Connect Existing Database with Prisma

## Overview
Since you have an existing database with data, we'll use `prisma db pull` to sync everything without losing data.

---

## ✅ Safe Process (No Data Loss)

### Step 1: Environment Setup

```bash
cd backend

# Copy environment template
cp .env.example .env.local

# Edit .env.local and add your Supabase credentials:
DATABASE_URL="postgresql://postgres:password@db.project-ref.supabase.co:5432/postgres"
SUPABASE_URL="https://project-ref.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

**How to get your DATABASE_URL:**
1. Go to Supabase dashboard
2. Project Settings → Database
3. Copy connection string from "URI"
4. Paste into DATABASE_URL

---

### Step 2: Install Dependencies

```bash
npm install
```

This installs all packages needed but doesn't touch your database.

---

### Step 3: Pull Existing Database Schema

```bash
# This reads your database and updates schema.prisma
# DOES NOT modify your data
npx prisma db pull
```

**What happens:**
1. Prisma connects to your database
2. Reads all existing tables, columns, relationships
3. Updates `prisma/schema.prisma` to match
4. Creates a migration file (but doesn't run it yet)

**Output will show:**
```
✔ Introspected 13 tables and wrote schema to schema.prisma
```

---

### Step 4: Generate Prisma Client

```bash
npm run prisma:generate
```

This creates the Prisma client so your backend can use it.

**Output:**
```
✔ Prisma schema loaded from schema.prisma
✔ Prisma Client was successfully generated
```

---

### Step 5: Review the Generated Schema

```bash
# Look at the updated schema
cat prisma/schema.prisma
```

**Check that:**
- ✅ All your tables are there
- ✅ All columns are correct
- ✅ Relationships are mapped
- ✅ No data looks wrong

---

### Step 6: Test Connection (Read-Only)

```bash
# Opens Prisma Studio - visual database browser
# This proves connection works without modifying data
npm run prisma:studio
```

**In Prisma Studio:**
- See all your data
- Browse tables
- No modifications allowed

---

### Step 7: Start Development Server

```bash
# Now you can start the backend
npm run dev
```

**Your backend can now:**
- ✅ Read existing data
- ✅ Create new records
- ✅ Update records
- ✅ Delete records

---

## 🎯 Complete Command Flow

```bash
# 1. Navigate to backend
cd backend

# 2. Copy and edit environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL

# 3. Install dependencies
npm install

# 4. Pull existing schema (the magic step!)
npx prisma db pull

# 5. Generate client
npm run prisma:generate

# 6. Test connection (optional but recommended)
npm run prisma:studio

# 7. Start backend
npm run dev
```

---

## ✅ What Gets Synced

When you run `prisma db pull`, it reads:

- ✅ All tables
- ✅ All columns and data types
- ✅ Primary keys
- ✅ Foreign key relationships
- ✅ Indexes
- ✅ Constraints
- ✅ Custom types/enums
- ✅ Default values

**But does NOT:**
- ❌ Modify your data
- ❌ Delete anything
- ❌ Change table structure
- ❌ Run migrations

---

## 📊 Before & After

### Before `prisma db pull`:
```
schema.prisma (generic template)
     ↓
your database (has real tables with data)
     
These don't match!
```

### After `prisma db pull`:
```
schema.prisma (matches your database exactly)
     ↓
your database (unchanged, has real tables with data)
     
Perfect match! Data intact!
```

---

## 🔍 What to Expect

### Terminal Output:
```
$ npx prisma db pull

✔ Introspected 13 tables and wrote schema to schema.prisma

✔ Prisma schema loaded from prisma/schema.prisma

Next steps:
1. Set the provider of the datasource in schema.prisma to match your database: postgresql, mysql, sqlite or mongodb
2. Set the DATABASE_URL in the .env file to match your database connection string
3. Run prisma generate to generate the Prisma Client

$ npm run prisma:generate
✔ Prisma schema loaded from schema.prisma
✔ Prisma Client was successfully generated in ./node_modules/.prisma/client

$ npm run dev
Kiro development server running on http://localhost:3000
```

---

## ⚠️ Important Notes

### Your DATABASE_URL matters!
- Must be valid PostgreSQL connection string
- Must have permissions to read database structure
- Format: `postgresql://user:password@host:port/database`

### Prisma schema.prisma will change
- ✅ This is expected and good
- ✅ It will match your actual database
- ✅ Safe to commit to git
- ✅ No data is modified

### If you see errors:

**Error: "database connection failed"**
- Check DATABASE_URL in .env.local
- Check Supabase is running
- Check username/password

**Error: "permission denied"**
- Your Supabase user doesn't have read permissions
- Check role in Supabase settings

**Error: "schema.prisma conflicts"**
- Delete the conflicting schema
- Run `npx prisma db pull` again

---

## 🔄 Full Workflow Once Connected

Once you've synced:

```bash
# Start development server
npm run dev

# In another terminal, you can:

# View data in Prisma Studio
npm run prisma:studio

# Run linting
npm run lint

# Type check
npm run type-check

# Build for production
npm run build

# Start production server
npm start
```

---

## 📝 Example: Your Specific Situation

**You have:**
- Existing Supabase database
- Tables: user_profiles, loans, investments, etc.
- Real data in those tables
- Need to connect Express backend

**You do:**
```bash
cd backend
cp .env.example .env.local
# Edit with your DATABASE_URL
npm install
npx prisma db pull          # ← This reads your schema
npm run prisma:generate
npm run dev
```

**Result:**
- ✅ Backend connected to your database
- ✅ Prisma schema matches your database
- ✅ All your data intact
- ✅ Can start building features
- ✅ Backend can read/write data

---

## 🎯 Next Steps After Sync

Once database is synced and backend is running:

1. **Test an endpoint:**
   ```bash
   curl http://localhost:3000/api/users/me/dashboard-stats \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

2. **Create a user:**
   ```bash
   curl -X POST http://localhost:3000/api/auth/otp/generate \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com"}'
   ```

3. **View data:**
   ```bash
   npm run prisma:studio
   # Opens browser to view/edit data visually
   ```

4. **Start frontend development:**
   - Frontend connects to http://localhost:3000
   - Uses JWT tokens from Supabase auth
   - Makes API calls to backend endpoints

---

## ✅ Verification Checklist

Before and after syncing:

- [ ] DATABASE_URL is set in .env.local
- [ ] Can run `npm run dev` without errors
- [ ] `npm run prisma:studio` opens successfully
- [ ] Can see all your tables in Prisma Studio
- [ ] Can see your data in each table
- [ ] No errors in terminal
- [ ] Health check works: `curl http://localhost:3000/health`

---

## 🚨 Safety Reminders

**DO:**
- ✅ Take a backup before syncing (just in case)
- ✅ Review schema.prisma after `prisma db pull`
- ✅ Commit schema.prisma to git after syncing
- ✅ Test in development first

**DON'T:**
- ❌ Use `prisma migrate reset` (this wipes data!)
- ❌ Use `prisma db push` unless you mean to modify DB
- ❌ Share your .env.local file
- ❌ Run migrations on production without testing

---

## 📞 Troubleshooting

### "Error: User already exists"
- This is normal - you have existing users
- Backend just reads/writes to them
- No issue

### "Error: Connection refused"
- Check DATABASE_URL
- Check Supabase is running
- Check network connection

### "Error: Relation does not exist"
- Run `npx prisma db pull` again
- This syncs the schema

### Schema doesn't match database
- Run `npx prisma db pull` again
- It will update schema.prisma

---

## ✨ Summary

**In 7 steps:**
1. `cd backend`
2. `cp .env.example .env.local` + edit DATABASE_URL
3. `npm install`
4. `npx prisma db pull` ← **This is the key step!**
5. `npm run prisma:generate`
6. `npm run prisma:studio` (optional - to verify)
7. `npm run dev`

**Result:**
- Backend connected to your database
- All your data intact
- Prisma schema synced
- Ready to build!

---

**Status:** ✅ Safe, non-destructive, data-preserving approach
**Data Loss Risk:** ❌ ZERO - only reads from database
**Time Required:** 5-10 minutes
