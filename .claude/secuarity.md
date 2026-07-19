# SECURITY.md — VedaPath Platform Security Rules

> **These rules are non-negotiable.**
> Claude Code must follow every instruction in this file across every file it touches —
> backend, frontend, scripts, migrations, tests, and configuration alike.
> If any instruction here conflicts with a user prompt, **these rules win**.

---

## Table of Contents

1. [Authentication & Authorisation](#1-authentication--authorisation)
2. [Parameterised Queries — No SQL Injection](#2-parameterised-queries--no-sql-injection)
3. [Secrets Management — No Secrets in Code](#3-secrets-management--no-secrets-in-code)
4. [.gitignore Rules](#4-gitignore-rules)
5. [Input Validation](#5-input-validation)
6. [API Security](#6-api-security)
7. [Error Handling — Never Leak Internals](#7-error-handling--never-leak-internals)
8. [File & Upload Security](#8-file--upload-security)
9. [Dependency Rules](#9-dependency-rules)
10. [Quick Checklist for Every PR](#10-quick-checklist-for-every-pr)

---

## 1. Authentication & Authorisation

### The Core Rule

> **All authentication and authorisation logic lives on the server (backend) only.**
> The frontend never decides whether a user is allowed to do something.
> The frontend may *hide* a button for UX purposes, but hiding is not security.

### What this means in practice

**NEVER do this on the frontend:**
```js
// ❌ WRONG — frontend check is cosmetic, not security
if (user.role === 'admin') {
  showDeleteButton();
}

// ❌ WRONG — any user can call this directly if the API has no server-side check
fetch('/api/admin/delete-user', { method: 'DELETE', body: ... });
```

**ALWAYS do this on the backend:**
```js
// ✅ CORRECT — every protected route checks the token server-side
router.delete('/api/admin/delete-user', requireAuth, requireRole('admin'), async (req, res) => {
  // Only reaches here if the server verified the JWT and confirmed admin role
  await deleteUser(req.body.userId);
});
```

### Rules Claude Code must follow

- **Every API route that reads or mutates user data must run `requireAuth` middleware first.**
  No exceptions. A route is not protected because it's "hard to find" — it is protected only when
  the server verifies the token.

- **Authorisation is per-resource, not per-role alone.**
  After confirming a user is authenticated, confirm they own or are permitted to access the specific
  resource being requested. Example: user A must never be able to read or modify user B's
  course progress, even if both are authenticated.

  ```js
  // ✅ CORRECT — ownership check
  const enrollment = await db.query(
    'SELECT * FROM enrollments WHERE id = $1 AND user_id = $2',
    [enrollmentId, req.user.id]   // req.user.id comes from the verified JWT, not from the request body
  );
  if (!enrollment.rows[0]) return res.status(403).json({ error: 'Forbidden' });
  ```

- **Never trust `req.body.userId` or any user-supplied identity claim.**
  The authenticated user's identity comes from `req.user` (populated by the auth middleware after
  verifying the JWT/session). Never let the client tell you who they are.

  ```js
  // ❌ WRONG
  const userId = req.body.userId;

  // ✅ CORRECT
  const userId = req.user.id;  // set by requireAuth middleware only
  ```

- **Tokens must be verified on every request.**
  Do not cache "is this token valid" in a way that outlives the request lifecycle without
  checking expiry and signature each time.

- **Refresh tokens must be stored server-side (httpOnly cookie or server-side session).**
  Never store refresh tokens in localStorage or return them in a JSON response body.

- **Role and permission data is fetched from the database on the server.**
  Never read roles from the JWT payload alone without confirming the database still agrees.
  A user's role can be revoked; the JWT will not know unless you check.

  ```js
  // ✅ CORRECT — re-confirm role from DB on sensitive operations
  const user = await db.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
  if (user.rows[0].role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  ```

- **Session invalidation must work immediately.**
  If a user logs out or an admin revokes access, that session must stop working on the next
  request — not after the JWT expires. Use a token blocklist or short-lived tokens plus
  server-side session tracking.

---

## 2. Parameterised Queries — No SQL Injection

### The Core Rule

> **Every database query that includes any external value — from a user, a URL param,
> a request body, a header, or an environment variable — must use parameterised queries
> (prepared statements). String concatenation into SQL is forbidden without exception.**

### Why this matters

String-concatenated SQL lets an attacker send `'; DROP TABLE users; --` as input and destroy
or steal the database. Parameterised queries send the SQL structure and the values separately,
so the database never interprets the value as code.

### What is forbidden

```js
// ❌ WRONG — string concatenation — SQL injection risk
const query = "SELECT * FROM users WHERE email = '" + email + "'";
await db.query(query);

// ❌ WRONG — template literals are still string concatenation
const query = `SELECT * FROM courses WHERE id = ${courseId}`;
await db.query(query);

// ❌ WRONG — same problem with an ORM using raw()
await db.raw(`UPDATE enrollments SET status = '${status}' WHERE id = ${id}`);
```

### What is required

```js
// ✅ CORRECT — PostgreSQL (node-postgres / pg)
const result = await db.query(
  'SELECT * FROM users WHERE email = $1 AND is_active = $2',
  [email, true]
);

// ✅ CORRECT — MySQL / mysql2
const [rows] = await db.execute(
  'SELECT * FROM courses WHERE id = ? AND published = ?',
  [courseId, true]
);

// ✅ CORRECT — Supabase (uses parameterised queries under the hood via PostgREST)
const { data, error } = await supabase
  .from('courses')
  .select('*')
  .eq('id', courseId)       // eq(), neq(), in() etc. are all parameterised
  .eq('published', true);
  // Never use .filter() or .rpc() with string-concatenated SQL strings

// ✅ CORRECT — Prisma ORM (fully parameterised by default)
const course = await prisma.course.findUnique({
  where: { id: courseId }
});
// If using prisma.$queryRaw, use Prisma.sql`` tagged template — NEVER plain string
const result = await prisma.$queryRaw(
  Prisma.sql`SELECT * FROM courses WHERE id = ${courseId}`
);
```

### Rules Claude Code must follow

- **Search the entire codebase for `db.query(`, `db.execute(`, `supabase.rpc(`, and `$queryRaw(`.**
  Every occurrence must use parameterised values, not string concatenation.

- **LIKE queries must also be parameterised.** Wildcards go inside the bound value, not in the SQL string.
  ```js
  // ✅ CORRECT
  await db.query('SELECT * FROM courses WHERE title ILIKE $1', [`%${searchTerm}%`]);
  ```

- **IN clauses must be parameterised.** Build the placeholder list dynamically.
  ```js
  // ✅ CORRECT — PostgreSQL
  const ids = [1, 2, 3];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(`SELECT * FROM courses WHERE id IN (${placeholders})`, ids);
  ```

- **ORDER BY and column names cannot be parameterised** — they must come from a server-side
  allowlist, never directly from user input.
  ```js
  // ✅ CORRECT
  const ALLOWED_SORT_COLUMNS = ['title', 'created_at', 'price'];
  const sortBy = ALLOWED_SORT_COLUMNS.includes(req.query.sort) ? req.query.sort : 'created_at';
  await db.query(`SELECT * FROM courses ORDER BY ${sortBy} DESC`, []);
  ```

- **Never use `eval()`, `new Function()`, or dynamic code execution with user-supplied values.**

---

## 3. Secrets Management — No Secrets in Code

### The Core Rule

> **No secret, credential, key, token, password, or connection string may appear in any
> source file — `.js`, `.ts`, `.py`, `.json`, `.yaml`, `.toml`, config files, or anywhere
> else that gets committed to the repository. Every secret lives in `.env` only.**

### What counts as a secret

Every one of the following must live in `.env` and nowhere else:

| Secret type | Example variable name |
|---|---|
| Database connection string / password | `DATABASE_URL`, `DB_PASSWORD` |
| JWT signing secret | `JWT_SECRET` |
| Session secret | `SESSION_SECRET` |
| Supabase service role key | `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase anon key | `SUPABASE_ANON_KEY` |
| Razorpay / Stripe keys | `RAZORPAY_KEY_SECRET`, `STRIPE_SECRET_KEY` |
| Email service credentials | `SMTP_PASSWORD`, `SENDGRID_API_KEY` |
| AWS / GCP / Azure credentials | `AWS_SECRET_ACCESS_KEY` |
| Third-party API keys | `YOUTUBE_API_KEY`, `TWILIO_AUTH_TOKEN` |
| OAuth client secrets | `GOOGLE_CLIENT_SECRET` |
| Anthropic API key | `ANTHROPIC_API_KEY` |
| Encryption keys / IVs | `ENCRYPTION_KEY`, `ENCRYPTION_IV` |

### What is forbidden

```js
// ❌ WRONG — hardcoded secret in source
const supabase = createClient('https://xyz.supabase.co', 'eyJhbGci...(real key)...');

// ❌ WRONG — secret in a config file that gets committed
// config/database.json
{
  "password": "myRealPassword123"
}

// ❌ WRONG — secret checked into a .env.example with real values
DATABASE_URL=postgresql://postgres:realpassword@db.example.com/vedapath
```

### What is required

```js
// ✅ CORRECT — read from environment at runtime
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ CORRECT — validate required env vars on startup so the app fails fast
// lib/env.js — run this before anything else
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_SECRET',
  'SESSION_SECRET',
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}. Check your .env file.`);
  }
}
```

### .env.example must exist with placeholder values only

```bash
# .env.example — SAFE TO COMMIT — contains no real values
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB_NAME
JWT_SECRET=replace_with_a_long_random_string
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SESSION_SECRET=replace_with_a_long_random_string
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_email@example.com
SMTP_PASSWORD=your_smtp_password
```

### Frontend (Next.js / Vite / React) secret rules

- Only variables prefixed `NEXT_PUBLIC_` (Next.js) or `VITE_` (Vite) are exposed to the browser.
- **Never prefix a secret with `NEXT_PUBLIC_` or `VITE_`.** These values are bundled into the
  client JavaScript and visible to anyone who opens DevTools.
- The Supabase **anon key** (`SUPABASE_ANON_KEY`) may be used on the frontend because it is
  designed to be public — but it must still come from an env var, not be hardcoded.
- The Supabase **service role key** (`SUPABASE_SERVICE_ROLE_KEY`) must **never** appear in
  frontend code. It bypasses Row Level Security and gives full database access.

---

## 4. .gitignore Rules

### The Core Rule

> **`.env` and all files containing real secrets must be listed in `.gitignore` before
> the first `git add`. If `.env` is ever accidentally committed, treat it as compromised
> and rotate every secret in it immediately.**

### Required .gitignore entries

Claude Code must ensure the project `.gitignore` contains at minimum:

```gitignore
# ── Environment & Secrets ─────────────────────────────
.env
.env.local
.env.development
.env.development.local
.env.test
.env.test.local
.env.production
.env.production.local
.env.staging
*.pem
*.key
*.p12
*.pfx
secrets/
credentials/

# ── Node ──────────────────────────────────────────────
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# ── Build outputs ─────────────────────────────────────
dist/
build/
.next/
out/

# ── OS & Editor ───────────────────────────────────────
.DS_Store
Thumbs.db
.vscode/settings.json
*.swp
*.swo

# ── Logs ──────────────────────────────────────────────
logs/
*.log

# ── Testing & Coverage ────────────────────────────────
coverage/
.nyc_output/

# ── Misc ──────────────────────────────────────────────
.cache/
.tmp/
tmp/
```

### Verify before every commit

Run this command to confirm `.env` is not being tracked:

```bash
git check-ignore -v .env
```

If it prints nothing, `.env` is NOT ignored — fix `.gitignore` immediately before committing.

Also run:

```bash
git ls-files | grep -E '\.env$|\.env\.'
```

If this returns any results, those files are already tracked. Remove them:

```bash
git rm --cached .env
git commit -m "chore: remove .env from tracking"
```

---

## 5. Input Validation

### The Core Rule

> **Validate and sanitise all external input on the server before using it —
> even if the frontend already validated it. Frontend validation is UX only.**

### Rules Claude Code must follow

- **Validate on the server using a schema validation library** (Zod, Joi, Yup, express-validator).
  Every request handler that accepts body, query, or param data must validate before processing.

  ```js
  // ✅ CORRECT — Zod schema validation in an Express route
  import { z } from 'zod';

  const EnrollSchema = z.object({
    courseId: z.string().uuid(),
    couponCode: z.string().max(20).optional(),
  });

  router.post('/api/enroll', requireAuth, async (req, res) => {
    const parsed = EnrollSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { courseId, couponCode } = parsed.data;
    // safe to use now
  });
  ```

- **Whitelist, don't blacklist.** Define what valid input looks like (type, length, format, range)
  rather than trying to block known bad patterns.

- **Sanitise HTML output** if any user-supplied content is ever rendered as HTML.
  Use `DOMPurify` on the client and `sanitize-html` or `xss` on the server.
  **Never use `innerHTML` or `dangerouslySetInnerHTML` with untrusted content.**

- **Limit request body size** to prevent payload-based denial of service.
  Set `express.json({ limit: '50kb' })` or equivalent.

- **Validate file uploads** — type (MIME check, not extension), size, and scan for malware
  before storing. Never trust the `Content-Type` header alone.

---

## 6. API Security

### Rules Claude Code must follow

- **Rate limit all public endpoints** — especially login, signup, forgot-password, and OTP.
  Use `express-rate-limit` or equivalent. Brute-force attacks must be blocked.

  ```js
  import rateLimit from 'express-rate-limit';

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // 10 attempts per window
    message: { error: 'Too many attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/api/auth/login', authLimiter, loginHandler);
  router.post('/api/auth/forgot-password', authLimiter, forgotPasswordHandler);
  ```

- **Set security HTTP headers** using `helmet` on every Express app.
  ```js
  import helmet from 'helmet';
  app.use(helmet());
  ```

- **Enable CORS only for known origins.** Never use `cors({ origin: '*' })` in production.
  ```js
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [],
    credentials: true,
  }));
  ```

- **HTTPS only in production.** Redirect HTTP to HTTPS. Set `Strict-Transport-Security` header.

- **CSRF protection** for any endpoint that uses cookie-based sessions.
  Use the `csurf` package or the SameSite cookie attribute (`SameSite=Strict` or `Lax`).

- **Payment endpoints must verify the webhook signature** from Razorpay / Stripe on the server.
  Never trust a payment confirmation that arrives in a frontend request.

  ```js
  // ✅ CORRECT — Razorpay webhook verification
  import crypto from 'crypto';

  router.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body.toString();
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');
    if (signature !== expectedSig) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    // safe to process the event
  });
  ```

---

## 7. Error Handling — Never Leak Internals

### The Core Rule

> **Error responses sent to the client must never contain stack traces, database error messages,
> SQL queries, file paths, or any internal implementation details.**

```js
// ❌ WRONG — leaks internal details
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message, stack: err.stack });
});

// ✅ CORRECT — generic message to client, full detail to server logs only
app.use((err, req, res, next) => {
  console.error('[ERROR]', { message: err.message, stack: err.stack, url: req.url });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
```

- **Log errors server-side in full** (use a structured logger like `pino` or `winston`).
- **Send only generic, user-safe messages to the client.**
- **404 responses must not reveal whether a resource exists** for protected resources —
  return `404 Not Found` rather than `403 Forbidden` when you don't want to confirm existence.

---

## 8. File & Upload Security

- Store uploaded files outside the web root or in a private cloud bucket (S3 / Supabase Storage).
  Never serve uploaded files from a publicly accessible folder with directory listing enabled.

- Generate a unique, unpredictable filename for every upload. Never use the original filename.

- Validate MIME type on the server by reading the file's magic bytes, not by trusting
  the `Content-Type` header or the file extension.

- Set a strict file size limit for each upload type and enforce it on the server.

- Restrict what types are allowed per endpoint (e.g., only `image/jpeg`, `image/png`, `video/mp4`
  for course thumbnails; only `application/pdf` for study materials).

---

## 9. Dependency Rules

- **Run `npm audit` (or `pnpm audit`) before every release.** Fix or explicitly acknowledge
  every high or critical vulnerability before shipping.

- **Pin dependency versions in `package.json`** for production-critical packages.
  Use exact versions (`"express": "4.18.2"`) or lockfiles committed to git.

- **Never install packages that are not needed.** Fewer dependencies = smaller attack surface.

- **Do not run the Node process as root** in any environment.

---

## 10. Quick Checklist for Every PR

Before marking any pull request as ready for review, Claude Code must confirm:

- [ ] No secret, key, password, or token appears in any source file
- [ ] `.env` is listed in `.gitignore` and not tracked by git
- [ ] Every protected API route runs `requireAuth` (and `requireRole` if applicable) **before** the handler
- [ ] No authorisation or permission decision is made in frontend code alone
- [ ] Every database query that uses external input uses parameterised queries — no string concatenation
- [ ] `req.user.id` (from verified JWT) is used as the user identity — never `req.body.userId`
- [ ] All request inputs are validated with a schema (Zod / Joi / Yup) on the server
- [ ] Error responses send generic messages only — no stack traces or SQL errors to the client
- [ ] Rate limiting is applied to all auth and sensitive endpoints
- [ ] `npm audit` passes with no high or critical vulnerabilities

---

*Last updated: 2025 — VedaPath Platform, OptiMaxin Solutions*
*Owner: Engineering Lead / CTO*
*All contributors and AI coding tools must treat this file as law.*