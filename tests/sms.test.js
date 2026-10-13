import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
const phone = "13800138000";
async function setup(
  t,
  { sender, clock, smsTestPhone, smsTestCode, smsTestExpiresAt } = {},
) {
  const sent = [];
  let time = 1700000000000;
  const { app, db } = await createApp({
    databaseUrl: process.env.TEST_DATABASE_URL,
    dbPath: ":memory:",
    gmPassword: "sms-test-gm",
    npcPassword: "sms-test-npc",
    smsSender:
      sender === null
        ? null
        : sender || (async (payload) => sent.push(payload)),
    smsNow: clock || (() => time),
    smsTestPhone,
    smsTestCode,
    smsTestExpiresAt,
  });
  if (process.env.TEST_DATABASE_URL) {
    assert.match(
      new URL(process.env.TEST_DATABASE_URL).searchParams.get("options") || "",
      /search_path=alsj_test_/,
    );
    await db.transaction(async () => {
      for (const table of [
        "votes",
        "inventory",
        "bids",
        "ledger",
        "checks",
        "missions",
        "unlocks",
        "sessions",
        "characters",
        "sms_challenges",
        "managed_content",
        "events",
        "audit",
      ])
        await db.prepare(`DELETE FROM ${table}`).run();
      await db
        .prepare("UPDATE lots SET bidder=NULL,bid=0,status='waiting'")
        .run();
      await db.prepare("DELETE FROM players").run();
      await db
        .prepare("UPDATE settings SET capacity=40,phase=1,price=189,voting=0")
        .run();
    });
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const client = () => {
    let cookie = "";
    return async (path, body, status = 200) => {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      assert.equal(response.status, status, await response.clone().text());
      return response.json();
    };
  };
  return {
    db,
    sent,
    client,
    advance: (value) => {
      time += value;
    },
    base,
  };
}
test("短信首次验证自动注册，已有手机号登录，不可重放且保留票务权限", async (t) => {
  const { db, sent, client, advance } = await setup(t);
  const p = client(),
    admin = client();
  assert.equal((await p("/public")).auth.sms, true);
  await p(
    "/register",
    { name: "不可绕过", contact: phone, password: "test-pass-123" },
    400,
  );
  const result = await p("/auth/sms/send", { phone });
  assert.deepEqual(result, { ok: true, expiresIn: 900, retryAfter: 60 });
  assert.match(sent[0].code, /^\d{6}$/);
  assert.ok(!JSON.stringify(result).includes(sent[0].code));
  const row = await db
    .prepare("SELECT * FROM sms_challenges WHERE phone=?")
    .get(phone);
  assert.notEqual(row.code_hash, sent[0].code);
  assert.equal(row.expires_at - row.created_at, 900000);
  await p("/auth/sms/send", { phone }, 429);
  const signed = await p("/auth/sms/login", {
    phone,
    code: sent[0].code,
    name: "首次报名",
  });
  assert.equal(signed.registered, true);
  const me = await p("/me");
  assert.equal(me.player.name, "首次报名");
  assert.equal(me.player.payment, "pending");
  assert.equal(me.player.checked_in, 0);
  await p("/clues/E-01/unlock", {}, 403);
  await p("/auth/sms/login", { phone, code: sent[0].code }, 400);
  advance(60001);
  await p("/auth/sms/send", { phone });
  const oldCode = sent[1].code;
  advance(60001);
  await p("/auth/sms/send", { phone });
  if (oldCode !== sent[2].code)
    await p("/auth/sms/login", { phone, code: oldCode }, 400);
  await admin("/login", { account: "admin", password: "sms-test-gm" });
  await admin("/staff/settings", { capacity: 1, price: 189 });
  const again = await p("/auth/sms/login", {
    phone,
    code: sent[2].code,
    name: "不应覆盖姓名",
  });
  assert.equal(again.registered, false);
  assert.equal(again.id, signed.id);
  assert.equal((await p("/me")).player.name, "首次报名");
  advance(60001);
  const other = "13900139000";
  await p("/auth/sms/send", { phone: other });
  await p("/auth/sms/login", { phone: other, code: sent.at(-1).code }, 400);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM players").get()).n, 1);
});
test("错误尝试持久化，五次锁定，过期失效，发送限频不依赖前端", async (t) => {
  const { db, sent, client, advance } = await setup(t);
  const p = client();
  await p("/auth/sms/send", { phone: "not-phone" }, 400);
  await p("/auth/sms/send", { phone });
  const wrong = sent[0].code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    await p("/auth/sms/login", { phone, code: wrong }, 400);
  assert.equal(
    (
      await db
        .prepare("SELECT attempts FROM sms_challenges WHERE phone=?")
        .get(phone)
    ).attempts,
    5,
  );
  await p("/auth/sms/login", { phone, code: sent[0].code }, 400);
  advance(60001);
  await p("/auth/sms/send", { phone });
  advance(900001);
  await p("/auth/sms/login", { phone, code: sent.at(-1).code }, 400);
  for (let i = 0; i < 3; i++) {
    advance(60001);
    await p("/auth/sms/send", { phone });
  }
  advance(60001);
  await p("/auth/sms/send", { phone }, 429);
});
test("并发验证码请求只发送一次，并发验证只注册一个玩家", async (t) => {
  const { sent, db, base } = await setup(t);
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const sends = await Promise.all(
    Array.from({ length: 5 }, () => post("/auth/sms/send", { phone })),
  );
  assert.equal(sends.filter((response) => response.status === 200).length, 1);
  assert.equal(sent.length, 1);
  const logins = await Promise.all(
    Array.from({ length: 5 }, () =>
      post("/auth/sms/login", { phone, code: sent[0].code }),
    ),
  );
  assert.equal(logins.filter((response) => response.status === 200).length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM players").get()).n, 1);
});
test("短信发送失败和未配置不会误注册或返回明文验证码", async (t) => {
  const { client, db } = await setup(t, {
    sender: async () => {
      throw Object.assign(new Error("provider"), {
        code: "InvalidAccessKeyId.Inactive",
      });
    },
  });
  const p = client();
  await p("/auth/sms/send", { phone }, 502);
  await p("/auth/sms/login", { phone, code: "123456" }, 400);
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM sms_challenges WHERE phone=?")
        .get(phone)
    ).status,
    "failed",
  );
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM players").get()).n, 0);
});
test("仅管理员密码登录，未启用短信时也不可绕过手机号注册", async (t) => {
  const { client } = await setup(t, { sender: null });
  const p = client();
  assert.equal((await p("/public")).auth.sms, false);
  await p("/auth/sms/send", { phone }, 503);
  await p(
    "/register",
    {
      name: "原流程",
      contact: "old@example.com",
      password: "old-test-123",
    },
    400,
  );
  await p(
    "/login",
    { account: "old@example.com", password: "old-test-123" },
    401,
  );
  await p("/login", { account: "npc:host", password: "whatever" }, 401);
  await p("/login", { account: "admin", password: "sms-test-gm" });
});
test("188888仅对指定测试手机号有效，并受测试期限限制", async (t) => {
  const { client, sent, advance } = await setup(t, {
    smsTestPhone: phone,
    smsTestCode: "188888",
    smsTestExpiresAt: 1700000060000,
  });
  const p = client();
  await p("/auth/sms/login", { phone: "13900139000", code: "188888" }, 400);
  const result = await p("/auth/sms/login", { phone, code: "188888" });
  assert.equal(result.registered, true);
  assert.equal(sent.length, 0);
  advance(60001);
  await p("/auth/sms/login", { phone, code: "188888" }, 400);
});
