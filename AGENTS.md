# AGENTS.md

## Stack

- Plain HTML/CSS/JS frontend (no framework, no build step) + Node serverless functions in `api/` (Vercel auto-detects them). **CommonJS**, matching url-shortener.
- Database: **Neon Postgres** via `@neondatabase/serverless@1.1.0` (pinned exactly, version checked from the registry 2026-08-18). Env var `DATABASE_URL` (injected by the Vercel Neon integration, mirrored into `.env.local` for dev).
- Tests: Node's built-in test runner (`node:test`) — no test framework dependency.
- Formula: GitHub + Vercel + OpenCode. Repo: https://github.com/KarimShaikh123/expense-splitter (private). Live: https://expense-splitter-gamma-coral.vercel.app (auto-deploys on push to `main`; alias of project `personal-e375/expense-splitter`). Shell deployed 2026-08-18 via `vercel --prod` direct upload of HEAD.

## What this app does

A group expense splitter: create a group, share its code, log shared expenses (who paid, who shares it), and the site computes balances and the payments that settle everything. Full add/edit/delete on expenses.

## The schema (approved by Karim 2026-08-18 — do not change without his approval)

```
groups — one row per group
  id          BIGINT       identity PK
  code        TEXT         unique — the 6-char access code
  name        TEXT
  currency    TEXT         default 'PKR' — one of the allowlist below
  created_at  TIMESTAMPTZ  default now()

members — one row per person in a group
  id          BIGINT       identity PK
  group_id    BIGINT       → groups(id) ON DELETE CASCADE
  name        TEXT
  UNIQUE(group_id, name)

expenses — one row per expense
  id            BIGINT       identity PK
  group_id      BIGINT       → groups(id) ON DELETE CASCADE
  description   TEXT
  amount_cents  INTEGER      total, integer paisa, CHECK > 0
  paid_by       BIGINT       → members(id) ON DELETE CASCADE — payer need not be a participant
  split_type    TEXT         'equal' | 'exact'
  expense_date  DATE         the day the expense happened
  created_at    TIMESTAMPTZ  default now()
  updated_at    TIMESTAMPTZ  default now()

expense_shares — resolved share per participant (the many-to-many join table)
  expense_id   BIGINT       → expenses(id) ON DELETE CASCADE
  member_id    BIGINT       → members(id) ON DELETE CASCADE
  share_cents  INTEGER      CHECK >= 0
  PK(expense_id, member_id)
```

- Indexes: `members_group_idx`, `expenses_group_idx`, `expense_shares_member_idx`.
- Group codes: 6 chars, uppercase alphabet `[A-HJ-NP-Z2-9]` (no 0/O/1/I), collision retry on insert.
- **Deletion rule (Karim's decision A, 2026-08-18)**: the four tables are a containment tree, so every FK cascades — deleting a group wipes its members, expenses, and shares in one statement. The live probe proved it (0 leftover rows). **Gotcha for the future**: v1 has no member-delete endpoint. If one is ever added, cascading would silently delete every expense that member paid for and strip their shares from other expenses (breaking the shares-sum invariant) — member deletion must reassign/recompute shares in a transaction FIRST; revisit these FKs then.
- Source of truth: `db/schema.sql`.

### Stored vs computed (written down before code, per ladder rules)

- **Stored**: groups, members, expenses, and each participant's resolved share. Shares are resolved at write time: equal split → `floor(amount/n)` each with the `amount mod n` leftover paisa dealt one each to the first participants; exact split → as entered, validated to sum to `amount_cents`.
- **Computed per request, never stored**: each member's balance and the settlement list. Edit/delete can never leave stale totals because nothing derived is ever written.
- Invariants asserted in code: shares sum to `amount_cents` for every expense; balances across a group sum to 0.

## The algorithms (Karim-approved; must stay explainable without opening the code)

1. **Money is integer paisa** — never floats. Split A paisa n ways: everyone gets `floor(A/n)`; the `A mod n` remainder paisa go one each to the first participants. Shares always sum to exactly A — asserted.
2. **Balances**: each expense moves two ways — payer's balance goes up by the full amount; every participant's goes down by their share. Sum over all expenses: balance = paid − consumed. Positive = is owed; negative = owes. All balances in a group always sum to 0 — asserted.
3. **Settlement (greedy)**: ignore zeros; repeatedly take the biggest debtor and biggest creditor, pay the smaller of the two amounts (clears at least one of them), cross them out, repeat. Each step clears ≥1 person → at most n−1 payments. Honest caveat: greedy is not always the absolute minimum number of payments (that problem is NP-hard), but it always settles everyone — this is what real apps ship.

## Identity / recovery / trust model (Karim's calls, 2026-08-18)

- The group code IS the access key. Creator's browser stores its group codes in localStorage for the "your groups" list; a fresh browser enters the code again (shared like an invite link). No code = no access — by design, documented in README.
- Anyone with the code can add/edit/delete ANY expense (shared notepad). No per-expense ownership in v1.
- The gate is validation (code format, FKs, amounts), not auth — the accepted gap, documented.
- Secrets: only `DATABASE_URL` — held by Vercel (Neon integration) + `.env.local` (gitignored). Nothing client-side.

## Commands

- Install: `npm install`
- Local dev: `npx vercel dev` (needs populated `.env.local`). The Vercel CLI is NOT on PATH in this environment — pin it from the root AGENTS.md: `~/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel`, or `npx vercel` from the repo dir.
- Syntax check: `node --check <file>` (one file at a time)
- Tests: `npm test` (`node --test`, discovers `test/*.test.js`)
- Apply schema: `npm run db:migrate` (reads `db/schema.sql`, splits on `;`, runs each statement separately — Neon's HTTP endpoint rejects multi-command calls; all `IF NOT EXISTS`, idempotent)
- Deploy: push to `main` (auto), or `npx vercel --prod`. **Auto-deploys can silently fail to trigger** — webhook drops happen (url-shortener, 2026-08-17). Before declaring any deploy live, confirm the aliased deployment was built from HEAD: `vercel inspect <deployment-url>` → id, then `GET https://api.vercel.com/v13/deployments/<id>` with the token from `~/.local/share/com.vercel.cli/auth.json` → `meta.githubCommitSha`. Mismatch → `vercel --prod`.
- Verify a deploy: read the live page content — never a status code alone. **Never poll production in a tight loop** — Vercel's attack challenge mode trips and the agent IP gets blocked. One request to verify; `vercel ls` for deploy status. If challenged, ask Karim to eyeball.

## Neon Postgres (provisioned + verified live 2026-08-18, task 1)

- Provisioned with `vercel install neon/neon --plan free_v3 --name expense-splitter --json` (plan slug `free_v3`, not `free`). No terms-acceptance block this time (url-shortener's first run had one). Store name on Neon's side: `restless-queen-95723862`. Resource connected to the project in the same step; env vars auto-pulled into `.env.local`.
- Env vars injected (all 3 environments): `DATABASE_URL` (what the SDK reads), `DATABASE_URL_UNPOOLED`, `NEON_PROJECT_ID`, `NEON_AUTH_BASE_URL`, `PG*`/`POSTGRES_*` legacy names, `VERCEL_OIDC_TOKEN` (short-lived link token). `.env.local` is gitignored — never commit it.
- `@neondatabase/serverless@1.1.0` facts (same as url-shortener, re-verified 2026-08-18): CommonJS works (`const { neon } = require('@neondatabase/serverless')`); `neon(process.env.DATABASE_URL)` returns a tagged-template function — call as `` sql`...` `` or `sql.query("SELECT ... $1", [param])`. **`COUNT(*)` returns a string** — coerce with `Number()` before numeric comparison.
- `vercel install neon` also drops `.agents/skills/` + `skills-lock.json` into the repo (Neon agent skills) — gitignored, matching url-shortener; not app code.
- **Task 1 probe — 10 checks, all green**: group/member/expense/shares inserts return identity ids; duplicate member name in a group rejected; `paid_by`/share → nonexistent member rejected; `amount_cents = 0`, `currency = 'XYZ'`, `split_type = 'bogus'` all rejected by CHECKs; group delete cascades to 0 leftover members/expenses/shares; tables end empty.
- **Bug the probe caught**: the approved schema had no CASCADE on `expenses.paid_by` and `expense_shares.member_id`, so `DELETE FROM groups` failed — member rows were still referenced by rows about to be deleted. Karim chose option A (CASCADE both FKs) over hand-ordered deletes; applied live via `ALTER TABLE ... DROP/ADD CONSTRAINT` (`expenses_paid_by_fkey`, `expense_shares_member_id_fkey`) and to `schema.sql`, then re-probed green.

## Files

- `vercel.json` — static output, `cleanUrls`, nosniff header
- `db/schema.sql` — the schema, source of truth
- `db/migrate.js` — applies `schema.sql` to Neon (run via `npm run db:migrate`)
- `index.html` + `js/home.js` — create a group / join by code
- `group.html` + `js/group.js` — group dashboard: expenses, add form, balances, who-pays-whom (mock data until tasks 5–6 wire the APIs)
- `styles.css` — house tokens

## Conventions

- Design tokens in `:root` in `styles.css` — reuse these, never raw hex.
- Fonts: Manrope (body) + DM Mono (labels/buttons) via Google Fonts.
- No code comments unless asked.
- One concern per file in `js/`, one concern per function in `api/`.
- Money travels as integer minor units (`amountCents`, `shareCents`, `balanceCents`) in every API payload; display goes through one `formatMoney(cents, currency)` helper — never format money anywhere else.
- Keep the Neon client construction inside the handler; tests must not construct a client when env vars are unset.

## Rules

- A 200 status proves a server answered; only content proves it is the right site.
- When stating a fact (versions, URLs, deploy targets), say what was checked versus assumed.
- One task, one commit, one review — nothing committed before Karim reviews. Tier 2 rule: every feature task lands as a branch + pull request.
- Commit identity: Karim Shaikh <karimhshaikh009@gmail.com>.
- Keep this file and README updated in the same commit as any structural change.

## Project status

Living checklist — update the tick in the same commit that completes the task.

- [x] Task 0 — Scaffold (2026-08-18): repo, AGENTS.md, README, schema.sql, static shell with mock data, currency decided for v1 (allowlist PKR/USD/GBP/EUR/AED/SAR/CAD). Deployed via `vercel --prod` (direct upload of HEAD), both pages verified by content — table-overflow fix (scroll wrapper) included after Karim's review
- [x] Task 1 — Provision Neon + apply schema + live probe (2026-08-18): Neon `free_v3` (`restless-queen-95723862`) provisioned + connected, `DATABASE_URL` injected; `npm run db:migrate` applied the schema. Probe caught a real bug — group delete blocked by the two FKs without CASCADE; Karim chose option A (CASCADE both), applied live via ALTER + schema.sql. Re-probe 10/10 green incl. cascade to 0 rows. `@neondatabase/serverless@1.1.0` pinned from the registry
- [ ] Task 2 — Groups API: create (name, members, currency), join by code, add member + tests (branch + PR)
- [ ] Task 3 — Expenses API: add/edit/delete + validation + paisa-split invariants + tests (branch + PR)
- [ ] Task 4 — Balances + greedy settlement + tests, walked through with Karim (branch + PR)
- [ ] Task 5 — UI home: create/join wired to APIs + currency select + loading/error/empty states (branch + PR)
- [ ] Task 6 — UI group page: list, add/edit/delete, balances, settlement wired to APIs (branch + PR)
- [ ] Task 7 — Hardening: keyless user, bad code, edge cases + docs (branch + PR)
- [ ] Task 8 — Ship: verify live content built from HEAD, explain-back, add to projects-index
