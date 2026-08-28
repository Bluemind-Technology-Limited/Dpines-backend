# Quick Database Sync Checklist

## 🎯 Get Your Supabase Info First

- [ ] Go to Supabase Dashboard
- [ ] Project Settings → Database
- [ ] Copy the connection string (contains your DATABASE_URL)
- [ ] Get your SUPABASE_URL from project settings
- [ ] Get your SUPABASE_ANON_KEY from API keys
- [ ] Get your SUPABASE_SERVICE_ROLE_KEY from API keys

**Looks like:**
```
postgresql://postgres:xxxxxx@db.xxxxx.supabase.co:5432/postgres
https://xxxxx.supabase.co
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## ✅ Setup Steps (Copy-Paste Ready)

### Step 1: Navigate and Copy Environment
```bash
cd backend
cp .env.example .env.local
```

### Step 2: Edit .env.local
Open `.env.local` and fill in (replace XXXXX with your values):

```env
DATABASE_URL="postgresql://postgres:XXXXX@db.XXXXX.supabase.co:5432/postgres"
SUPABASE_URL="https://XXXXX.supabase.co"
SUPABASE_ANON_KEY="XXXXX"
SUPABASE_SERVICE_ROLE_KEY="XXXXX"
PORT=3000
NODE_ENV=development
FRONTEND_URL="http://localhost:5173"
CORS_ORIGIN="http://localhost:5173"
```

- [ ] DATABASE_URL filled
- [ ] SUPABASE_URL filled
- [ ] SUPABASE_ANON_KEY filled
- [ ] SUPABASE_SERVICE_ROLE_KEY filled
- [ ] File saved

### Step 3: Install Dependencies
```bash
npm install
```
- [ ] No errors
- [ ] Packages installed

### Step 4: Pull Your Database Schema
```bash
npx prisma db pull
```
- [ ] Runs successfully
- [ ] Shows "Introspected X tables"
- [ ] schema.prisma is updated

### Step 5: Generate Prisma Client
```bash
npm run prisma:generate
```
- [ ] Client generated
- [ ] No errors

### Step 6: Test Connection (Optional)
```bash
npm run prisma:studio
```
- [ ] Opens browser window
- [ ] Can see your tables
- [ ] Can see your data
- [ ] Close when done

### Step 7: Start Backend
```bash
npm run dev
```
- [ ] Server starts
- [ ] Listening on http://localhost:3000
- [ ] No connection errors

---

## 🧪 Test It Works

### Test 1: Health Check
```bash
curl http://localhost:3000/health
```
Expected: `{"status":"ok","timestamp":"2024-08-26T..."}`

### Test 2: Authentication Endpoints (if needed)
```bash
curl -X POST http://localhost:3000/api/auth/otp/generate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

---

## ✅ Final Checklist

**Environment:**
- [ ] .env.local exists
- [ ] DATABASE_URL set
- [ ] All 4 Supabase keys set

**Dependencies:**
- [ ] npm install completed
- [ ] node_modules exists

**Database:**
- [ ] Prisma client generated
- [ ] schema.prisma updated
- [ ] Connection works (prisma:studio opened)

**Backend:**
- [ ] npm run dev works
- [ ] Server on http://localhost:3000
- [ ] Health check responds

**Data:**
- [ ] All data still in database
- [ ] No tables deleted
- [ ] No columns changed

---

## 🚀 You're Ready!

Once all checkboxes are done:
- ✅ Backend is connected to your database
- ✅ Your data is safe
- ✅ Prisma is synced
- ✅ Ready to build features
- ✅ Ready for frontend to connect

---

## ❌ If Something Goes Wrong

### "Cannot find database"
- Check DATABASE_URL spelling
- Copy fresh from Supabase
- Make sure it has `postgresql://` at start

### "Permission denied"
- Check you're using SERVICE_ROLE_KEY in DATABASE_URL
- Check Supabase user has permissions

### "Connection refused"
- Check Supabase project is active
- Check internet connection
- Try again in a few seconds

### "Port 3000 already in use"
- Stop other process using port 3000
- Or change PORT in .env.local to 3001

### Schema doesn't look right
- Run `npx prisma db pull` again
- It will re-sync

---

## 📞 Need Help?

**Issue:** Database connection won't work
→ Check: DATABASE_URL in .env.local matches Supabase

**Issue:** Prisma client won't generate
→ Run: `npm run prisma:generate` again

**Issue:** Server won't start
→ Check: Port 3000 isn't already in use

**Issue:** Can't see my data in Prisma Studio
→ Check: DATABASE_URL is correct

---

**Status:** Ready to sync! 🚀
**Data Risk:** Zero - only reading, not modifying
**Time:** 5-10 minutes
