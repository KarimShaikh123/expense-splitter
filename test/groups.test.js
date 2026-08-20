const { test } = require("node:test");
const assert = require("node:assert");
const groups = require("../lib/groups.js");
const createHandler = require("../api/groups/index.js");
const getHandler = require("../api/groups/[code].js");
const membersHandler = require("../api/groups/[code]/members.js");

function fakeRes() {
  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.payload = payload;
      return res;
    }
  };
  return res;
}

test("generateCode returns 6 characters from the alphabet only", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(groups.generateCode(), /^[A-HJ-NP-Z2-9]{6}$/);
  }
});

test("generateCode is not constant across calls", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(groups.generateCode());
  assert.ok(seen.size > 1, "expected varied codes");
});

test("normalizeCode trims and uppercases", () => {
  assert.strictEqual(groups.normalizeCode("  k4b2qx "), "K4B2QX");
  assert.strictEqual(groups.normalizeCode(undefined), "");
  assert.strictEqual(groups.normalizeCode(42), "");
});

test("validateNewGroup accepts a valid body and defaults currency to PKR", () => {
  const result = groups.validateNewGroup({ name: " Flat 4B ", members: [" Karim ", "Ali"] });
  assert.deepStrictEqual(result.group, { name: "Flat 4B", members: ["Karim", "Ali"], currency: "PKR" });
});

test("validateNewGroup accepts an allowlisted currency, case-insensitively", () => {
  const result = groups.validateNewGroup({ name: "G", members: ["A", "B"], currency: " usd " });
  assert.strictEqual(result.group.currency, "USD");
});

test("validateNewGroup rejects bad group names", () => {
  assert.match(groups.validateNewGroup({ name: "", members: ["A", "B"] }).error, /group name/i);
  assert.match(groups.validateNewGroup({ name: "x".repeat(51), members: ["A", "B"] }).error, /group name/i);
  assert.match(groups.validateNewGroup({ name: 42, members: ["A", "B"] }).error, /group name/i);
});

test("validateNewGroup rejects bad member lists", () => {
  assert.match(groups.validateNewGroup({ name: "G", members: "A,B" }).error, /list/i);
  assert.match(groups.validateNewGroup({ name: "G", members: ["A"] }).error, /at least 2/i);
  const names = Array.from({ length: 21 }, (_, i) => "M" + i);
  assert.match(groups.validateNewGroup({ name: "G", members: names }).error, /at most 20/i);
  assert.match(groups.validateNewGroup({ name: "G", members: ["A", ""] }).error, /member names/i);
  assert.match(groups.validateNewGroup({ name: "G", members: ["A", "x".repeat(31)] }).error, /member names/i);
});

test("validateNewGroup rejects duplicate member names case-insensitively", () => {
  const result = groups.validateNewGroup({ name: "G", members: ["Ali", "ali "] });
  assert.match(result.error, /duplicate member name/i);
});

test("validateNewGroup rejects unknown currencies", () => {
  assert.match(groups.validateNewGroup({ name: "G", members: ["A", "B"], currency: "XYZ" }).error, /currency/i);
  assert.match(groups.validateNewGroup({ name: "G", members: ["A", "B"], currency: 42 }).error, /currency/i);
});

test("validateMemberName trims valid names and rejects bad ones", () => {
  assert.deepStrictEqual(groups.validateMemberName({ name: " Sana " }), { name: "Sana" });
  assert.match(groups.validateMemberName({ name: "" }).error, /member names/i);
  assert.match(groups.validateMemberName({ name: "x".repeat(31) }).error, /member names/i);
  assert.match(groups.validateMemberName(null).error, /invalid json/i);
});

test("createGroup inserts the group then its members and returns the contract shape", async () => {
  const calls = [];
  const sql = {
    query: async (query, params) => {
      calls.push({ query, params });
      if (calls.length === 1) {
        return [{ id: "7", code: params[0], name: params[1], currency: params[2], created_at: new Date("2026-08-18T09:00:00Z") }];
      }
      return [{ id: "11", name: "Karim" }, { id: "12", name: "Ali" }];
    }
  };
  const group = await groups.createGroup(sql, { name: "Flat 4B", members: ["Karim", "Ali"], currency: "PKR" });
  assert.match(group.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.strictEqual(group.name, "Flat 4B");
  assert.deepStrictEqual(group.members, [{ id: 11, name: "Karim" }, { id: 12, name: "Ali" }]);
  assert.match(calls[1].query, /INSERT INTO members \(group_id, name\) VALUES/);
  assert.deepStrictEqual(calls[1].params, ["7", "Karim", "7", "Ali"]);
});

test("createGroup retries on a unique violation of the code", async () => {
  let attempts = 0;
  const sql = {
    query: async (query, params) => {
      if (query.startsWith("INSERT INTO groups")) {
        attempts++;
        if (attempts < 3) throw { code: "23505", message: "duplicate key value violates unique constraint" };
        return [{ id: "1", code: params[0], name: params[1], currency: params[2], created_at: new Date() }];
      }
      return [{ id: "1", name: "A" }, { id: "2", name: "B" }];
    }
  };
  await groups.createGroup(sql, { name: "G", members: ["A", "B"], currency: "PKR" });
  assert.strictEqual(attempts, 3);
});

test("createGroup gives up after MAX_ATTEMPTS collisions", async () => {
  const sql = {
    query: async (query) => {
      if (query.startsWith("INSERT INTO groups")) {
        throw { code: "23505", message: "duplicate key value violates unique constraint" };
      }
      return [];
    }
  };
  await assert.rejects(() => groups.createGroup(sql, { name: "G", members: ["A", "B"], currency: "PKR" }), /free group code/);
});

test("createGroup rethrows non-collision errors", async () => {
  const sql = {
    query: async () => {
      throw new Error("connection refused");
    }
  };
  await assert.rejects(() => groups.createGroup(sql, { name: "G", members: ["A", "B"], currency: "PKR" }), /connection refused/);
});

test("create handler rejects non-POST", async () => {
  const res = fakeRes();
  await createHandler({ method: "GET" }, res);
  assert.strictEqual(res.statusCode, 405);
});

test("create handler rejects invalid input before touching the database", async () => {
  const res = fakeRes();
  await createHandler({ method: "POST", body: { name: "", members: ["A", "B"] } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.payload.error, /group name/i);
});

test("create handler rejects oversized streamed bodies", async () => {
  const { EventEmitter } = require("node:events");
  const { MAX_BODY_LENGTH } = require("../lib/http.js");
  const req = new EventEmitter();
  req.method = "POST";
  const res = fakeRes();
  const done = createHandler(req, res);
  req.emit("data", "x".repeat(MAX_BODY_LENGTH + 100));
  req.emit("end");
  await done;
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.payload.error, /too large/i);
});

test("group route rejects methods other than GET and DELETE", async () => {
  const res = fakeRes();
  await getHandler({ method: "POST", query: { code: "K4B2QX" } }, res);
  assert.strictEqual(res.statusCode, 405);
});

test("delete 404s malformed codes before touching the database", async () => {
  const res = fakeRes();
  await getHandler({ method: "DELETE", query: { code: "bad" } }, res);
  assert.strictEqual(res.statusCode, 404);
  assert.match(res.payload.error, /not found/i);
});

test("get handler 404s malformed codes before touching the database", async () => {
  for (const code of ["TOOLONG1", "K4B2Q!", "", undefined, "k4b"]) {
    const res = fakeRes();
    await getHandler({ method: "GET", query: { code } }, res);
    assert.strictEqual(res.statusCode, 404);
    assert.match(res.payload.error, /not found/i);
  }
});

test("get handler normalizes lowercase codes before lookup", async () => {
  assert.strictEqual(groups.normalizeCode("k4b2qx"), "K4B2QX");
});

test("members handler rejects non-POST", async () => {
  const res = fakeRes();
  await membersHandler({ method: "GET", query: { code: "K4B2QX" } }, res);
  assert.strictEqual(res.statusCode, 405);
});

test("members handler 404s malformed codes and 400s bad names before touching the database", async () => {
  const notFound = fakeRes();
  await membersHandler({ method: "POST", query: { code: "bad" }, body: { name: "Sana" } }, notFound);
  assert.strictEqual(notFound.statusCode, 404);

  const badName = fakeRes();
  await membersHandler({ method: "POST", query: { code: "K4B2QX" }, body: { name: "" } }, badName);
  assert.strictEqual(badName.statusCode, 400);
  assert.match(badName.payload.error, /member names/i);
});

test("validateNewGroup rejects non-string junk inside the members list", () => {
  assert.match(groups.validateNewGroup({ name: "G", members: [1, "B"] }).error, /member names/i);
  assert.match(groups.validateNewGroup({ name: "G", members: ["A", null] }).error, /member names/i);
  assert.match(groups.validateNewGroup({ name: "G", members: ["A", { name: "B" }] }).error, /member names/i);
});

test("members handler reaches the DATABASE_URL gate only after code + body checks", { skip: !!process.env.DATABASE_URL }, async () => {
  const res = fakeRes();
  await membersHandler({ method: "POST", query: { code: "K4B2QX" }, body: { name: "Sana" } }, res);
  assert.strictEqual(res.statusCode, 500);
  assert.match(res.payload.error, /database not configured/i);
});

test("limits are the Karim-approved values", () => {
  assert.strictEqual(groups.MAX_GROUP_NAME_LENGTH, 50);
  assert.strictEqual(groups.MAX_MEMBER_NAME_LENGTH, 30);
  assert.strictEqual(groups.MIN_MEMBERS, 2);
  assert.strictEqual(groups.MAX_MEMBERS, 20);
  assert.deepStrictEqual(groups.CURRENCIES, ["PKR", "USD", "GBP", "EUR", "AED", "SAR", "CAD"]);
});
