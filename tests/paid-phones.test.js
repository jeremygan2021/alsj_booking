import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import {
  normalizePaidPhone,
  parsePaidPhoneText,
} from "../server/payments/paid-phones.js";

const fail = (message) => {
  throw new Error(message);
};

test("付费手机号导入解析国家码、CSV引号、空格并拒绝非手机号", () => {
  assert.equal(normalizePaidPhone('"+86 138-0013-8000"'), "13800138000");
  assert.equal(normalizePaidPhone("0086（139）0013 9000"), "13900139000");
  assert.equal(normalizePaidPhone("１３８００１３８０００"), "13800138000");
  for (const bad of [
    "12800138000",
    "138001380001",
    "13800138000e2",
    "a13800138000",
    "13800138000@x.com",
  ])
    assert.equal(normalizePaidPhone(bad), null);
  const parsed = parsePaidPhoneText(
    '\uFEFF姓名,手机号\r\n"张,三","+86 138 0013 8000"\r\n李四\t13900139000\r\n重复,13800138000\r\n王五 137 0000 0001\r\n错误,12800138000\r\n订单,12345678901234\r\n邮箱,13800138000@example.com',
    fail,
  );
  assert.deepEqual(
    parsed.records.map((r) => [r.phone, r.name]),
    [
      ["13800138000", "张,三"],
      ["13900139000", "李四"],
      ["13700000001", "王五"],
    ],
  );
  assert.equal(parsed.totalRows, 7);
  assert.equal(parsed.duplicates, 1);
  assert.equal(parsed.invalidRows.length, 3);
  assert.equal(
    parsePaidPhoneText(
      "13800138000@example.com\n13800138000.0\n+44 13800138000",
      fail,
    ).records.length,
    0,
  );
  assert.throws(() => parsePaidPhoneText("\n".repeat(5), fail), /请粘贴/);
  assert.throws(
    () => parsePaidPhoneText("13800138000\n".repeat(2001), fail),
    /2000/,
  );
});

test("GM名单预览不写入、增量核验、未来注册与登录匹配、退款保留、移除不退款及权限", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "alsj-paid-phones-"));
  const options = {
    databaseUrl: process.env.TEST_DATABASE_URL,
    dbPath: join(dir, "test.sqlite"),
    gmPassword: "paid-gm",
    npcPassword: "paid-npc",
    allowLegacyRegistration: true,
    smsDevLogin: true,
  };
  let { app, db } = await createApp(options);
  let server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const client = () => {
    let cookie = "";
    return async (path, body, status = 200) => {
      const res = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.headers.get("set-cookie"))
        cookie = res.headers.get("set-cookie").split(";")[0];
      assert.equal(res.status, status, await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"), "no-store");
      return res.json();
    };
  };
  const gm = client(),
    player = client(),
    refunded = client(),
    paid = client(),
    npc = client(),
    anon = client();
  await gm("/login", { account: "admin", password: "paid-gm" });
  const register = (c, phone) =>
    c("/auth/sms/login", { phone, code: "188888" });
  const pendingReg = await register(player, "13800000001");
  const refundedReg = await register(refunded, "13800000002");
  const paidReg = await register(paid, "13800000003");
  await gm(`/staff/players/${refundedReg.id}`, { payment: "refunded" });
  await gm(`/staff/players/${paidReg.id}`, { payment: "paid" });
  await db
    .prepare("INSERT INTO npc_phones(npc_id,phone) VALUES(?,?)")
    .run("host", "13800000009");
  await register(npc, "13800000009");
  for (const c of [anon, player, npc]) {
    await c("/staff/paid-phones", undefined, 401);
    await c("/staff/paid-phones/preview", { text: "13800000001" }, 401);
    await c("/staff/paid-phones/import", { text: "13800000001" }, 401);
    await c("/staff/paid-phones/13800000001/remove", {}, 401);
  }
  const text =
    '姓名,手机号\n新玩家,"+86 138 0000 0001"\n退款玩家,13800000002\n已付款,13800000003\n稍后报名,13800000004\nNPC,13800000009\n重复,13800000001\n错误,12345';
  const preview = await gm("/staff/paid-phones/preview", { text });
  assert.deepEqual(preview.summary, {
    totalRows: 7,
    valid: 5,
    duplicates: 1,
    invalid: 1,
    excludedNpcs: 1,
    alreadyImported: 0,
    registered: 3,
    unregistered: 1,
    alreadyPaid: 1,
    refunded: 1,
    toMarkPaid: 1,
  });
  assert.equal((await gm("/staff/paid-phones")).rows.length, 0);
  assert.equal((await player("/me")).player.payment, "pending");
  const imported = await gm("/staff/paid-phones/import", {
    text,
    sourceName: "测试订单.csv",
  });
  assert.equal(imported.summary.added, 4);
  assert.equal(imported.summary.markedPaid, 1);
  assert.equal((await player("/me")).player.payment, "paid");
  assert.equal((await refunded("/me")).player.payment, "refunded");
  assert.equal((await paid("/me")).player.payment, "paid");
  const again = await gm("/staff/paid-phones/import", { text });
  assert.equal(again.summary.added, 0);
  assert.equal(again.summary.markedPaid, 0);
  assert.equal((await gm("/staff/paid-phones")).rows.length, 4);
  const list = await gm("/staff/paid-phones");
  assert.deepEqual(list.summary, {
    total: 4,
    registered: 3,
    unregistered: 1,
    paid: 2,
    refunded: 1,
  });
  assert.equal(
    list.rows.find((r) => r.phone === "13800000004").status,
    "pending_registration",
  );
  assert.equal(list.rows[0].source_name, "测试订单.csv");
  assert.equal(
    (await gm(`/staff/players/${pendingReg.id}`)).player.paid_phone_import,
    1,
  );
  assert.equal(
    (await gm("/staff/manage")).players.find((p) => p.id === pendingReg.id)
      .paid_phone_import,
    1,
  );
  const staffPlayer = (await gm("/staff")).players.find(
    (p) => p.id === pendingReg.id,
  );
  assert.equal(staffPlayer.paid_phone_import, 1);
  assert.equal(staffPlayer.contact, "13800000001");
  assert.ok(
    (await npc("/staff")).players.every(
      (p) => p.contact === undefined && p.paid_phone_import === undefined,
    ),
  );

  // The roster persists through restart and marks a future SMS registration.
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  ({ app, db } = await createApp(options));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const future = client();
  await register(future, "13800000004");
  assert.equal((await future("/me")).player.payment, "paid");
  assert.equal((await gm("/staff/paid-phones")).summary.unregistered, 0);
  // Existing pending players also match on their next verified login.
  await gm(`/staff/players/${pendingReg.id}`, { payment: "pending" });
  await register(player, "13800000001");
  assert.equal((await player("/me")).player.payment, "paid");
  await register(refunded, "13800000002");
  assert.equal((await refunded("/me")).player.payment, "refunded");

  await gm("/staff/paid-phones/13800000001/remove", {});
  assert.equal((await player("/me")).player.payment, "paid");
  assert.equal(
    (await gm(`/staff/players/${pendingReg.id}`)).player.paid_phone_import,
    0,
  );
  await gm(`/staff/players/${pendingReg.id}`, { payment: "pending" });
  await register(player, "13800000001");
  assert.equal((await player("/me")).player.payment, "pending");
  const legacy = client();
  await gm("/staff/paid-phones/import", { text: "13800000005\n13800000006" });
  const legacyReg = await legacy("/register", {
    name: "旧注册",
    contact: "13800000005",
    password: "test-password",
  });
  assert.equal((await legacy("/me")).player.payment, "paid");
  await gm(`/staff/manage/players/${legacyReg.id}`, {
    name: "新联系方式",
    contact: "13800000006",
  });
  assert.equal(
    (await gm(`/staff/players/${legacyReg.id}`)).player.paid_phone_import,
    1,
  );
  assert.ok(
    (await gm("/staff")).audit.some((r) =>
      r.action.includes("付费手机号名单自动核验"),
    ),
  );
  await gm("/staff/paid-phones/import", { text: "错误号码" }, 400);
  await gm(
    "/staff/paid-phones/import",
    { text: "13800000001", sourceName: "x".repeat(121) },
    400,
  );
});
