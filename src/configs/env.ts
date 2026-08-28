import dotenv from "dotenv";

dotenv.config();

export const env = {
  // Server
  PORT: parseInt(process.env.PORT || "3000", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  SITE_URL: process.env.SITE_URL || "http://localhost:3000",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",

  // Database
  DATABASE_URL: process.env.DATABASE_URL || "",

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",

  // Email Service
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  ADMIN_NOTIFICATION_EMAIL: process.env.ADMIN_NOTIFICATION_EMAIL || "",

  // QStash (Upstash)
  QSTASH_URL: process.env.QSTASH_URL || "https://qstash-us-east-1.upstash.io",
  QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
  QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY || "",
  QSTASH_TOKEN: process.env.QSTASH_TOKEN || "",

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || "your-secret-key",
  JWT_EXPIRY: process.env.JWT_EXPIRY || "7d",

  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",
};

// Validate required environment variables
const requiredVars = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
];

if (process.env.NODE_ENV === "production") {
  for (const variable of requiredVars) {
    if (!process.env[variable]) {
      console.warn(`Missing environment variable: ${variable}`);
    }
  }
}
