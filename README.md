# expense-splitter

I built this to track shared expenses for a group and calculate who owes whom. You create a group, share its code with the people in it, log every expense — who paid and who shares it — and the site works out each person's balance and the payments that settle everything. Expenses can be added, edited, and deleted; the totals are recomputed every time, so they never drift.

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
