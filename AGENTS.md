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

- Indexes: `members_group_idx`, `members_group_lower_name_idx` (UNIQUE on `(group_id, lower(name))` — DB backstop for the case-insensitive duplicate rule), `expenses_group_idx`, `expense_shares_member_idx`.
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

## API contract (Karim-approved 2026-08-18)

- `POST /api/groups` — create. Body `{name, members:[names], currency?}` → `201 {code, name, currency, createdAt, members:[{id,name}]}`. Validation: name 1–50 chars; 2–20 members, each 1–30 chars, case-insensitive duplicates rejected; currency optional, defaults PKR, allowlist enforced. Code: 6 chars from `[A-HJ-NP-Z2-9]`, collision retry ×5 then 500.
- `GET /api/groups/[code]` — open by code (input trimmed + uppercased). `200 {group:{code,name,currency,createdAt}, members, expenses, balances, settlements}` — expenses/balances/settlements stay empty until tasks 3–4 fill them. Malformed or unknown code → 404 (no hint which).
- `DELETE /api/groups/[code]` — delete the whole group (Karim's review-round ask, 2026-08-18). The containment-tree cascades wipe members, expenses, and shares (proved live: 0 leftovers). 200 `{code}`; unknown code → 404; deleting twice → 404.
- `POST /api/groups/[code]/members` — add a member. `201 {id,name}`; 429 at the 20-member cap; 409 on case-insensitive duplicate.
- `POST /api/groups/[code]/expenses` — add expense. Body `{description, amountCents, paidBy, splitType, participants, date}` → `201` with the resolved shares. Equal split: shares resolved server-side (floor + leftover paisa to the first participants). Exact split: `participants` is `[{memberId, shareCents}]` and must sum to `amountCents` — the invariant, enforced before insert. Validation: description 1–100; amount 1..1,000,000,000 paisa (Rs 10,000,000 — Karim's call); payer must be a member (need not be a participant); date real, YYYY-MM-DD, no later than this week's Sunday Karachi (Karim's call — the whole current week is allowed); 429 at the 500-expense cap (Karim's call).
- `PUT /api/groups/[code]/expenses/[id]` — full replacement (same body as add); shares re-resolved; `updated_at` bumps. 404 if the expense isn't in that group.
- `DELETE /api/groups/[code]/expenses/[id]` — cascade removes the shares. 404 if not in that group.
- All expense routes live under the group code on purpose: expense ids are sequential, so unscoped `/api/expenses/[id]` would let a stranger edit any group's expense by guessing ids. The code stays the only key.
- `GET /api/groups/[code]` returns expenses newest-date-first (id DESC tiebreak), each with its shares, and asserts the shares-sum invariant per expense — a partially-written expense surfaces as 500 "Data inconsistency", never as silently wrong balances. Balances and settlements are computed per request from the stored expenses (never stored themselves): `computeBalances` (payer +amount, each participant −share), then greedy `settle` with the sum-to-zero assert before settling — if it fails, 500, never a wrong plan. Ties break by member id so the same group always yields the same plan.
- House rules (from the shortener): wrong method → 405, malformed JSON → 400, body > 8KB → 400. Every timestamp leaves the API as Karachi ISO with an explicit `+05:00`.
- Known edge case: group creation is two statements (group, then members). If the second fails, an orphaned empty group remains — unreachable (nobody knows its code), harmless. Happened live twice during task 1→2 probing (ORDER BY bug below); both cleaned up.
- **Gotcha pinned 2026-08-18**: Postgres `INSERT ... RETURNING` does NOT accept `ORDER BY` (syntax error) — sort by identity id in JS instead. Mock tests can't catch SQL syntax; live probes can.
- **Gotcha pinned 2026-08-18 (task 3)**: same-table DELETE + INSERT inside one CTE statement does NOT work — all sub-statements see the same snapshot, so the INSERT collides with rows the DELETE is about to remove (proved live: `expense_shares_pkey` violation). Expense edit is therefore three ordered statements (UPDATE expense → DELETE shares → INSERT shares); the GET invariant assertion is the safety net for the tiny non-atomic window. Adding an expense IS atomic — one statement across two different tables (expenses + expense_shares via CTE + VALUES), with `::bigint`/`::integer` casts on the VALUES params (Neon infers them as text otherwise).
- **Gotcha pinned 2026-08-18 (task 3)**: Neon returns DATE columns as JS Dates parsed at Karachi midnight (e.g. `2026-08-18` arrives as `2026-08-17T19:00:00.000Z`) — format back to `YYYY-MM-DD` with `toKarachiDate` (+5h shift, slice), never return the raw value.

## Identity / recovery / trust model (Karim's calls, 2026-08-18)

- The group code IS the access key. Creator's browser stores its group codes in localStorage (`my-groups` key: `[{code, name}]`, newest first, deduped by code) which drives the home page's "Your groups" list; a fresh browser enters the code again (shared like an invite link). No code = no access — by design, documented in README. Corrupt/missing storage degrades gracefully to an empty list.
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
- `api/lib/http.js` — shared: 8KB-capped JSON body reader, unique-violation detector, Karachi ISO + date formatters
- `api/lib/groups.js` — shared: code generation + normalization, group/member/currency validation, `createGroup`
- `api/lib/expenses.js` — shared: week bounds (Karachi), date validation, equal-share resolution, expense validation with the shares-sum invariant
- `api/lib/settle.js` — shared: `computeBalances` (payer +amount, participants −shares) + greedy `settle` with the sum-to-zero assert
- `api/groups/index.js` — POST /api/groups (create)
- `api/groups/[code].js` — GET /api/groups/[code] (open by code, full contract shape incl. expenses + invariant assertion)
- `api/groups/[code]/members.js` — POST /api/groups/[code]/members (add member)
- `api/groups/[code]/expenses/index.js` — POST add expense (atomic single-statement insert)
- `api/groups/[code]/expenses/[id].js` — PUT edit (full replacement) + DELETE
- `test/groups.test.js` — 23 tests: validation, code generation, createGroup with mock sql, handler guards (no DB needed)
- `test/expenses.test.js` — 14 tests: share resolution, Karachi week bounds, date/amount/split validation, handler guards
- `test/settle.test.js` — 11 tests: the Flat 4B + four-person walkthroughs verbatim, payer-outside-split, zero cases, n−1 bound + exact-settlement property, deterministic ties, sum-to-zero assert
- `index.html` + `js/home.js` — create a group (name, members, currency) / join by code, both wired to the APIs with busy buttons + verbatim API errors; "Your groups" list from localStorage with two-step inline group delete (deletes server-side, then locally; a 404 just removes it locally)
- `group.html` + `js/group.js` — group dashboard, fully wired: fetches `/api/groups/[code]` (lowercase codes normalized), loading + page-error states (bad code / 404 / network), member chips with "+ Add member" inline flow, expenses table with two-step inline delete ("Sure?" arms 3s — never browser dialogs) and edit (form refills incl. paisa→rupee conversion, PUT on save, cancel back to add mode), add form with equal/exact split UI (rupee input → integer paisa at the edge), balances + who-pays-whom rendered from the server-computed values; copy code / copy link / two-step delete group; every mutation re-fetches so balances never go stale. Mock data deleted
- `styles.css` — house tokens

## Conventions

- Design tokens in `:root` in `styles.css` — reuse these, never raw hex.
- Fonts: Manrope (body) + DM Mono (labels/buttons) via Google Fonts.
- No code comments unless asked.
- One concern per file in `js/`, one concern per function in `api/`.
- Money travels as integer minor units (`amountCents`, `shareCents`, `balanceCents`) in every API payload; display goes through one `formatMoney(cents, currency)` helper — never format anywhere else. Display rules (Karim's review rounds, 2026-08-18): letter symbols (contain Latin or Arabic letters: Rs, C$, د.إ) get a space before the number; pure glyph symbols ($, £, €, ﷼) don't. Positive amounts green (`--green`), negative red (brightened `--error`); balances/settlements read as sentences ("Karim is owed", "Ali pays Sana") — natural word spacing, no flex gaps between the words.
- Currency symbols (Karim's review round 2, 2026-08-18): PKR Rs, USD $, GBP £, EUR €, CAD C$, **AED د.إ, SAR ﷼** — the real symbols, per Karim. Arabic glyphs render via **Noto Sans Arabic** (Google Fonts, loaded on both pages, fallback in the body + DM Mono + stat-card font stacks — DM Mono/Manrope don't carry Arabic). Member delete is DEFERRED (Karim: "do this later") — the paid_by/share cascade gotcha above must be designed first.
- Keep the Neon client construction inside the handler; tests must not construct a client when env vars are unset.

## Rules

- A 200 status proves a server answered; only content proves it is the right site.
- When stating a fact (versions, URLs, deploy targets), say what was checked versus assumed.
- One task, one commit, one review — nothing committed before Karim reviews. Features are built on a branch and merged to `main` after Karim reviews the diff — no pull requests (Karim's call, 2026-08-18: PR #1 closed on sight).
- Commit identity: Karim Shaikh <karimhshaikh009@gmail.com>.
- Keep this file and README updated in the same commit as any structural change.

## Project status

Living checklist — update the tick in the same commit that completes the task.

- [x] Task 0 — Scaffold (2026-08-18): repo, AGENTS.md, README, schema.sql, static shell with mock data, currency decided for v1 (allowlist PKR/USD/GBP/EUR/AED/SAR/CAD). Deployed via `vercel --prod` (direct upload of HEAD), both pages verified by content — table-overflow fix (scroll wrapper) included after Karim's review
- [x] Task 1 — Provision Neon + apply schema + live probe (2026-08-18): Neon `free_v3` (`restless-queen-95723862`) provisioned + connected, `DATABASE_URL` injected; `npm run db:migrate` applied the schema. Probe caught a real bug — group delete blocked by the two FKs without CASCADE; Karim chose option A (CASCADE both), applied live via ALTER + schema.sql. Re-probe 10/10 green incl. cascade to 0 rows. `@neondatabase/serverless@1.1.0` pinned from the registry
- [x] Task 2 — Groups API (2026-08-18): create (name, members, currency), open by code, add member. Karim's calls: limits 50/30/2–20, case-insensitive duplicate names (DB backstop `members_group_lower_name_idx`), 429 at member cap, 409 on duplicate. 23/23 tests + live probe green (201/200/409 paths, lowercase code normalization, cascade cleanup to 0 rows). Bug found live: `RETURNING ... ORDER BY` is invalid Postgres — sort by identity id in JS instead. Workflow: PR #1 was created, Karim closed it — branch diffs reviewed directly, no PRs from here on
- [x] Task 3 — Expenses API (2026-08-18): add (atomic 2-table CTE insert), edit (full replacement), delete, GET returns expenses newest-first with shares. Karim's calls: 500-expense cap, Rs 10M amount cap, dates allowed through this week's Sunday (Karachi), description 1–100. Shares-sum invariant enforced at write AND asserted at read (500 "Data inconsistency" beats silently wrong balances). Two bugs found live: same-table DELETE+INSERT in one CTE collides on its own snapshot (edit = 3 ordered statements instead); Neon DATE columns arrive as Karachi-midnight JS Dates (toKarachiDate fix). 37/37 tests + full-flow probe green
- [x] Task 4 — Balances + settlement (2026-08-18): `api/lib/settle.js` — computeBalances + greedy settle, computed per request, never stored. Walked through with Karim before coding (Flat 4B + four-person examples); the tests encode both walkthroughs verbatim. Ties break by member id (deterministic plans); sum-to-zero asserted before settling (500 beats wrong plan). 48/48 tests + live probe matched the walkthrough exactly (Ali pays Sana Rs 600)
- [x] Task 5 — UI home (2026-08-18): create (with currency select) + join wired to the APIs — busy buttons ("Creating…"/"Opening…"), API error messages surfaced verbatim, network-failure message, client-side format check on codes. "Your groups" list from localStorage `my-groups` (identity story: fresh browser = empty list + join form). DOM probe green: create 201→navigate+save, create 400→verbatim error no navigation, join bad-format/404/200 paths, list renders after reload
- [x] Task 6 — UI group page (2026-08-18): fully wired — loading/error page states, expense list with edit (form refill + PUT) and two-step delete, add form (equal checkboxes / exact amounts, rupees→paisa at the edge), balances + settlement rendered from server values, re-fetch after every mutation. DOM probe green: load (lowercase code normalized), add 420050 paisa conversion, no-participant error, edit refill + PUT, arm-then-delete, 404 page error. Bug caught in rewrite: renderBalances/renderSettlements missing on first pass — probe caught it before review
- [x] Review round 1 (2026-08-18, Karim's live test): group delete (API `DELETE /api/groups/[code]` + two-step UI button, removes code from localStorage, cascade proved live), Copy-link button (full group URL), **add-member UI** ("+ Add member" chip → inline input → the task-2 endpoint; trims, surfaces 409/429 verbatim, re-fetches), AED→Dh / SAR→SR symbols (native glyphs break in Latin fonts), symbol-before-number with no space, brighter red + green for positive amounts, balances/settlements as sentences (flex gaps were splitting the words). 49/49 tests + delete/add-member probes green
- [x] Review round 2 (2026-08-18): real AED/SAR symbols (د.إ, ﷼) per Karim + Noto Sans Arabic web font so they render; spacing rule flipped to letter-symbols-get-a-space (Rs 1,000 / د.إ 1,000 / C$ 1,000 vs $1,000 / ﷼1,000); group delete from the home page list (two-step, 404 = remove locally). Member delete deferred — Karim: "do this later". Probe green across all 6 currencies + both home-delete paths
- [x] Task 7 — Hardening (2026-08-18): XSS audit clean (zero innerHTML/eval; every user string goes through textContent — 74 sites); fresh-browser flows probed (no code → friendly message + zero fetches, malformed code same; empty + corrupt localStorage degrade to the empty note; junk codes in storage filtered out); date picker capped at this week's Sunday Karachi (matches the server rule); validation-before-DB ordering locked with 4 new tests (DATABASE_URL gate only after code/body/id checks); 53/53 tests. Known accepted gaps: no member delete yet (Karim deferred — cascade gotcha needs a design call); group-delete-from-home deletes for everyone (trust model, documented)
- [x] Task 8 — Ship (2026-08-18): final audit green — 53/53 tests, zero comments/TBDs, `.env.local` untracked, 27-check live journey on production (one "failure" was the audit script's own arithmetic, app verified correct); deploy verified at HEAD; added to projects-index (six projects, verified by content + aliased commit). Explain-back: Karim passed cascades, recovery story, and edit-updates-facts; gaps corrected live — permissions scope + expense-id scoping under the code, and stored-vs-computed (answered "balances in the database" — re-taught with the edit scenario, confirmed landed)
