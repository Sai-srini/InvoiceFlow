# InvoiceFlow

Accounts payable for businesses: invoices in, approvals, payment runs out, bank statements reconciled, everything audited.

**Stack:** React 18 + TypeScript + Vite · Node + Express + TypeScript · MongoDB (replica set) · Redis + BullMQ · Docker Compose.

> **Read "Status and limits" below before using this with real money.**

## What it does

| Step | Who | What happens |
|---|---|---|
| Capture | Accounts Team / Requester | Upload a real invoice (PDF, PNG, JPEG). Text is read from the PDF, fields are parsed and validated (GSTIN with check digit, PAN, IFSC, tax arithmetic), duplicates are checked. A person verifies every value; nothing is auto-submitted. |
| Approve | Approver / Finance Head | A configurable rule picks the approvers (by amount, department, cost centre, category). Every approver must have a limit that covers the whole invoice, and is never the person who created or edited it. Hold with a query, reject with a reason, delegate while away, automatic escalation. |
| Pay | Accounts Team prepares, Finance Head releases | Payment runs with maker-checker. Two signatures above a configurable threshold. Held payments are carved out. A bank file is generated (generic CSV). **Nothing becomes Paid until the bank statement confirms it** (or an authorised person records the bank reference). |
| Reconcile | Accounts Team + Finance Head | Import real statements through a column-mapping layout. Debits and credits stay separate, running balance is verified, duplicates are refused. Matching by payment reference/UTR, then amount + vendor, with exceptions queued and weak matches needing a human. Manual matches need a second person. |
| Control | Auditor / Admin | Tamper-evident hash-chained audit log, role and permission management, invitation-only users, segregation-of-duties settings. |

### Roles (editable templates; permissions, not role names, drive access)

| Role | Purpose | Cannot |
|---|---|---|
| Requester | Raises bills, sees only their own | Approve, pay |
| Accounts Team | Captures/codes invoices, prepares payment runs, imports statements | Approve, release payments, approve vendors |
| Approver | Approves/rejects/holds assigned invoices within a limit | Create invoices, pay |
| Finance Head | Final approvals, vendor and bank-change approval, payment release, rules, tax settings | Prepare payment runs |
| Admin | Users, roles, organisation settings | Any financial action |
| Auditor | Read-only, audit log and export | Change anything |

Segregation of duties enforced in the backend (and configurable): nobody approves what they created or edited; whoever prepares a run cannot release it; whoever proposes a vendor or a bank change cannot approve it; whoever imports a statement cannot approve manual matches on it; the same person cannot give both signatures.

## Run it (Docker)

Needs Docker Desktop.

```bash
cp .env.example .env
# fill JWT_SECRET and ENCRYPTION_KEY (commands are written inside .env.example)
docker compose up --build
```

First run on an empty database (new terminal):

```bash
docker exec -it invoice_server npm run bootstrap
# needs ORG_NAME, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, e.g. on Windows PowerShell:
docker exec -it -e ORG_NAME="Acme Pvt Ltd" -e ADMIN_EMAIL=admin@acme.com -e ADMIN_NAME="Asha Admin" -e ADMIN_PASSWORD='Use-A-Strong-One-1!' invoice_server npm run bootstrap
```

Open http://localhost:5173, sign in as that admin, then: invite your Finance Head / Accounts / Approver users (Users & roles), set TDS sections (Settings → Tax; the app ships **no** tax rates), and create approval rules. Invoices cannot be submitted until a rule matches.

For a demo with sample users (development only, refuses to run in production):

```bash
docker exec -it -e SEED_PASSWORD='Demo!Passw0rd-1' invoice_server npm run seed
```

Reset everything: `docker compose down -v` (deletes the database).

Without Docker you need MongoDB as a **replica set** and Redis, then `cd server && npm i && npm run dev` and `cd client && npm i && VITE_API_BACKEND=http://localhost:3001 npm run dev`.

### Configuration (.env)

`JWT_SECRET`, `ENCRYPTION_KEY` (required; losing the key makes stored bank account numbers unreadable, back it up apart from the database), `GOOGLE_CLIENT_ID` (optional, sign-in only for already-invited users), `SMTP_*` (optional; without it notifications stay in-app and are marked "undelivered", invitation links are shown to the admin), `OCR_ENABLED=1` (optional, PNG/JPEG only).

## Security model

Invitation-only users; passwords ≥10 chars with mixed classes, bcrypt, lockout after repeated failures; 15-minute access tokens kept in memory, rotating refresh tokens in an httpOnly cookie with reuse detection; permissions loaded from the database on every request; every query is tenant-scoped (a query without an organisation throws); vendor bank accounts encrypted with AES-256-GCM and masked everywhere (reveal needs a permission and is audited); uploads validated by file signature and served only through authenticated endpoints; helmet, CORS allow-list, rate limiting; append-only audit log with a hash chain and a verify endpoint; money stored as integer paise.

## Tests

```bash
cd server
npm test                      # 31 unit tests: money, GSTIN/PAN/IFSC, policy, approval matrix, matching engine, statement parser, extraction
npm run test:integration      # 43 API tests through the real HTTP app against a database
```
The integration tests assume a database **without** transactions unless you set `TEST_REAL_TXN=1` (needs a replica set, as in `.github/workflows/ci.yml`). **Run them with `TEST_REAL_TXN=1` against your docker MongoDB before relying on this**: see "Status and limits".

`npm run extraction:accuracy` measures invoice-parsing accuracy on your own redacted samples in `samples/invoices` (`<name>.pdf` + `<name>.expected.json`). `samples/` is git-ignored: never commit real documents.

## Status and limits (honest)

**Verified** in the build environment: TypeScript compiles; 31 unit tests; 43 HTTP integration tests; the React app builds; and a browser walk-through of the complete workflow (create invoice → two-person approval → payment run → release by another person → statement import → automatic match → invoice reconciled → audit chain verified). Those integration and browser runs used a MongoDB-compatible stand-in **without transactions**, because no real MongoDB or Docker was available there.

**Not verified there, so test it first:** real multi-document transactions on a replica set (`TEST_REAL_TXN=1 npm run test:integration`), the two partial unique indexes (vendor GSTIN, payment idempotency key), Redis/BullMQ queues (tests run jobs inline), real SMTP, Google sign-in, and OCR.

**Not built (by design, no invented facts):**
- **No real payout.** Releasing a run produces a generic CSV. Bank-specific file formats and payout-provider APIs are not implemented (`PayoutProvider` returns NOT_CONFIGURED) until you supply the bank's specification or the provider's official documentation.
- **No built-in tax rates** and no bank-specific statement layouts: you configure TDS sections and map statement columns yourself. Every layout is "unvalidated against real formats" until you test it on a real statement (use the Preview on the Import tab).
- **Scanned PDFs** are routed to manual entry (OCR works for PNG/JPEG only, and only when enabled).
- No MFA yet (fields exist), no accounting-software integration beyond a generic journal CSV, no PO/goods-receipt matching, English only.
- The GSTIN check-digit routine was validated against one published sample GSTIN; a failing check digit is shown as a warning, not a rejection.

Before production: managed MongoDB replica set and Redis, HTTPS (see `docker-compose.prod.example.yml` and `Caddyfile.example`), backups of both the database and `ENCRYPTION_KEY`, an accountant to confirm tax settings, a security review, and a pilot on real statements and invoices.
