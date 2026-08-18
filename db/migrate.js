const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — run: npm run db:migrate");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

async function main() {
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await sql.query(statement);
  }
  const tables = await sql.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('groups', 'members', 'expenses', 'expense_shares') ORDER BY table_name"
  );
  console.log("tables:", tables.map((t) => t.table_name).join(", "));
  for (const name of ["groups", "members", "expenses", "expense_shares"]) {
    const cols = await sql.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
      [name]
    );
    console.log(name + ":", cols.map((c) => c.column_name + " " + c.data_type).join(" | "));
  }
}

main().catch((err) => {
  console.error("migrate failed:", err.message);
  process.exit(1);
});
