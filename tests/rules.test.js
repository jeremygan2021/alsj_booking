import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";

test("数据库重启后保留活动数据，种子不会覆盖GM编辑", () => {
  const dir = mkdtempSync(join(tmpdir(), "alaska-persistence-"));
  try {
    const path = join(dir, "game.sqlite");
    let db = openDb(path);
    db.prepare("UPDATE clues SET body=? WHERE id=?").run("GM定稿证据", "E-01");
    db.prepare("UPDATE settings SET phase=4,capacity=36").run();
    db.close();
    db = openDb(path);
    assert.equal(
      db.prepare("SELECT body FROM clues WHERE id=?").get("E-01").body,
      "GM定稿证据",
    );
    assert.equal(
      db.prepare("SELECT capacity FROM settings").get().capacity,
      36,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM clues").get().n, 12);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("报名容量、非法来源、退款撤销玩法资格与事务回滚", async (t) => {
  const { app, db } = createApp({
    dbPath: ":memory:",
    gmPassword: "gm-rule-password",
    npcPassword: "npc-rule-password",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = "";
    return async (url, body, expected = 200, headers = {}) => {
      const r = await fetch(base + "/api" + url, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie, ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      assert.equal(r.status, expected, await r.clone().text());
      return r.json();
    };
  }
  const gm = client(),
    p = client(),
    other = client();
  await gm("/login", { account: "gm", password: "gm-rule-password" });
  await gm("/staff/settings", { capacity: 1, price: 189 });
  const { id } = await p("/register", {
    name: "测试",
    contact: "capacity@example.com",
    password: "player-rule-pass",
  });
  await other(
    "/register",
    {
      name: "满员测试",
      contact: "overflow@example.com",
      password: "player-rule-pass",
    },
    400,
  );
  await gm("/staff/phase", { phase: 3 }, 403, {
    origin: "https://evil.example",
  });
  assert.equal(db.prepare("SELECT phase FROM settings").get().phase, 1);
  await p("/character", {
    name: "米娅·科尔曼",
    english: "Mia Coleman",
    profession: "研究员",
    skill: "技术",
    story: "曾参与集团项目。",
    motive: "寻找档案",
  });
  await gm("/staff/players/" + id, {
    payment: "paid",
    checkin: true,
    status: "approved",
    faction: "croft",
  });
  await gm(
    "/staff/coins",
    { playerId: id, amount: -4, reason: "非法透支" },
    400,
  );
  assert.equal((await p("/me")).player.coins, 3);
  await gm(
    "/staff/players/" + id,
    { payment: "refunded", status: "invalid" },
    400,
  );
  assert.equal((await p("/me")).player.payment, "paid");
  await gm("/staff/phase", { phase: 3 });
  await p("/clues/E-01/unlock", {});
  await gm("/staff/phase", { phase: 1 });
  assert.ok((await p("/clues/E-01")).body);
  await gm("/staff/players/" + id, { payment: "refunded" });
  await p("/clues/E-01", undefined, 403);
});
