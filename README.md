# expense-splitter

Live: https://expense-splitter-gamma-coral.vercel.app

I built this to track shared expenses for a group and calculate who owes whom. You create a group — pick its currency, list the members — and share its code (or the link) with the people in it. Log every expense: who paid, who shares it, split equally or by exact amounts. The site works out each person's balance and the payments that settle everything. Expenses can be added, edited, and deleted; members can be added later; the totals are recomputed on every request, so they never drift. Money is stored as whole paisa/cents — no floating point, no rounding surprises.

## Stack

Plain HTML/CSS/JS frontend, Node serverless functions in `api/`, Neon Postgres. Deployed on Vercel. `AGENTS.md` is the full contract: schema, algorithms, conventions, commands.

## Run it locally

```
npm install
npx vercel dev
```

`npx vercel dev` needs a `.env.local` with `DATABASE_URL` — see `AGENTS.md` for how the Neon integration injects it.

## Tests

```
npm test
```
