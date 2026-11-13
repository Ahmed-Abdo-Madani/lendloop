# LendLoop — Neighborhood Tool-Lending Board

> *"Borrow what you need. Lend what you don't."*

LendLoop is a security-first neighborhood tool-lending application built with **Next.js (App Router)**, **Clerk** authentication, **Convex** for data and backend RBAC logic, and **n8n** for bidirectional HMAC-secured workflow automation.

---

## 1. Architecture & Data Flow

```text
[Next.js App Router UI]
   |-- Public View --------> convex/tools.ts:listPublicAvailableTools (returns ONLY name & category)
   |-- Authenticated View -> Clerk JWT -> Convex Auth Context (users, tools, borrowRequests)
                                 |
                                 +-- Borrow Request Created / Status Updated
                                 |     --> Schedules internal.loans.dispatchN8nBorrowEvent
                                 |     --> Signs minimized JSON payload with HMAC-SHA256 (t=<ts>,v1=<mac>)
                                 |     --> POSTs to n8n Webhook (/webhook/lendloop-borrow-event)
                                 |
[n8n Self-Hosted via Docker] <---+
   |-- Workflow 1: Request Notification (n8n/workflows/request-notification.json)
   |     --> Verifies HMAC-SHA256 + 300s timestamp replay window
   |     --> Sends notification using only minimized fields
   |     --> Calls back Convex POST /api/automation-callback with idempotencyKey
   |
   |-- Workflow 2: Daily Overdue Reminders (n8n/workflows/overdue-reminders.json)
   |     --> Runs daily at 09:00 UTC
   |     --> Calls Convex POST /api/overdue-loans (HMAC-signed)
   |     --> Sends overdue reminder per loan & writes status back idempotently
   |
   +-- Workflow 3: Error Workflow (n8n/workflows/error-handler.json)
         --> Captures any failed execution after retries so failures never fail silently
```

---

## 2. Local Setup (Next.js + Convex + Docker n8n)

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- A Clerk application and Convex project

### Step-by-Step Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env.local` and populate your keys:
   ```bash
   cp .env.example .env.local
   ```
   Set `LENDLOOP_WEBHOOK_SECRET` in both `.env.local` (for Docker n8n) and in your Convex deployment environment (`npx convex env set LENDLOOP_WEBHOOK_SECRET <secret>`).

3. **Start self-hosted n8n via Docker Compose:**
   ```bash
   docker compose up -d
   ```
   Open `http://localhost:5678` and import the three exported workflows from `n8n/workflows/`:
   - `n8n/workflows/error-handler.json`
   - `n8n/workflows/request-notification.json`
   - `n8n/workflows/overdue-reminders.json`

4. **Start Convex and Next.js:**
   ```bash
   npx convex dev
   npm run dev
   ```

5. **Run automated security & RBAC tests:**
   ```bash
   npm test
   ```

---

## 3. Security & Data-Minimization Decisions

1. **Public Surface Data Minimization (`convex/tools.ts:listPublicAvailableTools`)**:
   - Unauthenticated visitors never receive raw `tools` documents. The Convex query filters strictly by `isAvailable === true` and projects **only** `_id`, `name`, and `category`. Owner IDs, owner names/emails, tool conditions, and descriptions are stripped inside the Convex query before data leaves the server.

2. **Server-Side RBAC Enforced in Convex (`convex/tools.ts` & `convex/loans.ts`)**:
   - Every authenticated query and mutation resolves the caller's verified Clerk identity via `ctx.auth.getUserIdentity()` and looks up their `users` record (`role: "user" | "admin"`).
   - **`user` role**: Can create, edit, and delete **only** listings where `tool.ownerId === user._id`; can approve, decline, or mark returned **only** borrow requests where `req.lenderId === user._id`; cannot borrow their own tools; cannot view other neighbors' unrelated loans.
   - **`admin` role**: Can remove any listing (`removeTool`), view all neighborhood loans (`listScopedLoans` with `scope: "admin_all"`), and toggle the `"Trusted Lender"` badge (`setTrustedLender`).

3. **Bidirectional Webhook Security & Replay Protection (`src/lib/security.ts`, `convex/http.ts`)**:
   - Outbound webhooks from Convex to n8n and inbound callbacks/queries from n8n to Convex (`/api/overdue-loans` and `/api/automation-callback`) are signed with **HMAC-SHA256** over `${timestampSeconds}.${rawBody}` in the `X-LendLoop-Signature: t=<ts>,v1=<hex>` header.
   - Receivers enforce a **300-second replay window** and verify digests with `crypto.timingSafeEqual`.
   - Zero secrets are stored in code or in the exported `n8n/workflows/*.json` files; all secrets are read from environment variables (`LENDLOOP_WEBHOOK_SECRET`, `N8N_ENCRYPTION_KEY`).

4. **Idempotent Write-Backs & Visible Failure Handling (`convex/loans.ts:recordAutomationWriteback`)**:
   - Every automation callback carries a deterministic `idempotencyKey` (`evt_<requestId>_<status>_<ts>` for event notifications, and `overdue_<requestId>_<YYYY-MM-DD>` for daily overdue reminders).
   - `recordAutomationWriteback` checks the `by_idempotency_key` index on `automationEvents` before inserting or patching `borrowRequests`, ensuring n8n retries (`maxTries: 3`) never create duplicate records or send duplicate daily reminders.
   - Both n8n workflows are wired to `n8n/workflows/error-handler.json` (`errorWorkflow: "lendloop-error-handler"`) so exhausted retries produce structured incident alerts rather than failing silently.

---

## 4. What We Would Change for Production

1. **Clerk Webhook Sync + Custom JWT Claims**: Wire a SVIX-verified Clerk `user.created` / `user.updated` webhook to sync users and roles automatically into Convex, and embed the role in Clerk session claims with MFA required for `admin` accounts.
2. **Dead-Letter Queue & PagerDuty/Sentry Integration**: Route the n8n Error Workflow and failed Convex `automationEvents` directly to Sentry / PagerDuty with a one-click replay mutation in the Admin panel.
3. **Rate Limiting & Audit Logging**: Add per-user token-bucket rate limiting on `requestToBorrow` and `createTool` inside Convex, and record immutable audit log entries for all `admin` actions (`removeTool`, `setTrustedLender`).
4. **mTLS / Private Networking for n8n**: Run self-hosted n8n inside a private VPC subnet with Postgres queue mode (Redis + worker replicas) and restrict `/webhook/*` ingress to Convex egress IPs alongside HMAC verification.
