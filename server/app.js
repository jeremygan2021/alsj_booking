import express from "express";
import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { openDb } from "./db.js";
import { phases, npcOrder } from "./content.js";
const token = () => randomBytes(24).toString("hex");
export function hashPassword(p) {
  const salt = token();
  return `${salt}:${scryptSync(p, salt, 64).toString("hex")}`;
}
export const npcCredential = (master, id) =>
  createHmac("sha256", master).update(id).digest("base64url").slice(0, 20);
const verify = (p, h) => {
  try {
    const [s, k] = h.split(":");
    return timingSafeEqual(Buffer.from(k, "hex"), scryptSync(p, s, 64));
  } catch {
    return false;
  }
};
export async function createApp({
  dbPath,
  databaseUrl,
  gmPassword,
  npcPassword,
  secure = false,
  trustProxy = "loopback",
}) {
  const app = express(),
    db = await openDb(databaseUrl || dbPath);
  app.disable("x-powered-by");
  // Production traffic enters through the local Nginx proxy only.
  app.set("trust proxy", trustProxy);
  app.use(
    express.json({
      limit: "32kb",
    }),
  );
  const one = (sql, ...p) => db.prepare(sql).get(...p),
    all = (sql, ...p) => db.prepare(sql).all(...p),
    run = (sql, ...p) => db.prepare(sql).run(...p);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), {
      status,
    });
  };
  const required = (v, label, max = 500) => {
    if (typeof v !== "string" || !v.trim() || v.length > max)
      fail(`请填写有效的${label}`);
    return v.trim();
  };
  const tx = (fn) => db.transaction(fn);
  const audit = async (r, action) =>
    await run(
      "INSERT INTO audit(actor,action) VALUES(?,?)",
      r.auth.user_id,
      action,
    );
  const setting = async () => await one("SELECT * FROM settings");
  const player = async (r) => {
    const p = await one("SELECT * FROM players WHERE id=?", r.auth.user_id);
    if (!p) fail("玩家不存在", 404);
    return p;
  };
  const playable = async (r) => {
    const p = await player(r);
    if (p.payment !== "paid" || !p.checked_in)
      fail("请先核验票务并完成现场签到", 403);
    const c = await one("SELECT * FROM characters WHERE player_id=?", p.id);
    if (c?.status !== "approved") fail("人物档案等待GM审核", 403);
    return {
      p,
      c,
    };
  };
  const coin = async (id, amount, reason) => {
    await run("UPDATE players SET coins=coins+? WHERE id=?", amount, id);
    await run(
      "INSERT INTO ledger(player_id,amount,reason) VALUES(?,?,?)",
      id,
      amount,
      reason,
    );
  };
  const session = async (res, role, id) => {
    const t = token();
    await run(
      "INSERT INTO sessions VALUES(?,?,?,?)",
      t,
      role,
      id,
      Date.now() + 7 * 864e5,
    );
    res.cookie("alaska_session", t, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 7 * 864e5,
    });
  };
  app.use("/api", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          fail("请求来源无效", 403);
      } catch (e) {
        return next(e);
      }
    }
    const t = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("alaska_session="))
      ?.split("=")[1];
    req.auth = t
      ? await one(
          "SELECT * FROM sessions WHERE token=? AND expires>?",
          t,
          Date.now(),
        )
      : null;
    next();
  });
  const auth =
    (...roles) =>
    (req, res, next) =>
      req.auth && roles.includes(req.auth.role)
        ? next()
        : res.status(401).json({
            error: "请使用对应账号登录",
          });
  const attempts = new Map();
  app.use(["/api/login", "/api/register"], (req, res, next) => {
    const key = req.ip,
      now = Date.now(),
      a = (attempts.get(key) || []).filter((t) => now - t < 60000);
    if (a.length >= 20)
      return res.status(429).json({
        error: "操作太频繁，请一分钟后重试",
      });
    a.push(now);
    attempts.set(key, a);
    if (attempts.size > 1000)
      for (const [k, v] of attempts)
        if (now - v.at(-1) > 60000) attempts.delete(k);
    next();
  });
  app.get("/api/public", async (r, s) =>
    s.json({
      settings: await setting(),
      phases,
      npcs: await all(
        `SELECT id,name,english,role,bio FROM npcs ORDER BY ${npcOrder}`,
      ),
      registered: (await one("SELECT COUNT(*) n FROM players")).n,
      events: await all("SELECT * FROM events ORDER BY id DESC LIMIT 8"),
    }),
  );
  app.get("/api/session", (r, s) =>
    s.json(
      r.auth
        ? {
            role: r.auth.role,
            id: r.auth.user_id,
          }
        : null,
    ),
  );
  app.post("/api/register", async (r, s) => {
    const name = required(r.body.name, "称呼", 40),
      contact = required(r.body.contact, "手机号或邮箱", 100),
      password = required(r.body.password, "密码", 128);
    if (password.length < 8) fail("密码至少8位");
    if (!/^(1\d{10}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(contact))
      fail("请输入有效手机号或邮箱");
    const id = token();
    await tx(async () => {
      if (
        (await one("SELECT COUNT(*) n FROM players")).n >=
        (await setting()).capacity
      )
        fail("本场报名已满");
      if (await one("SELECT id FROM players WHERE contact=?", contact))
        fail("该联系方式已报名，请登录");
      await run(
        "INSERT INTO players(id,name,contact,password,group_id) VALUES(?,?,?,?,?)",
        id,
        name,
        contact,
        hashPassword(password),
        ((await one("SELECT COUNT(*) n FROM players")).n % 6) + 1,
      );
    });
    await session(s, "player", id);
    s.json({
      id,
    });
  });
  app.post("/api/login", async (r, s) => {
    const account = required(r.body.account, "账号", 100),
      password = required(r.body.password, "密码", 128);
    if (account === "gm" && password === gmPassword) {
      await session(s, "gm", "gm");
      return s.json({
        role: "gm",
      });
    }
    if (
      account.startsWith("npc:") &&
      password === npcCredential(npcPassword, account.slice(4)) &&
      (await one("SELECT id FROM npcs WHERE id=?", account.slice(4)))
    ) {
      await session(s, "npc", account.slice(4));
      return s.json({
        role: "npc",
      });
    }
    const p = await one("SELECT * FROM players WHERE contact=?", account);
    if (!p || !verify(password, p.password)) fail("账号或密码不正确", 401);
    await session(s, "player", p.id);
    s.json({
      role: "player",
    });
  });
  app.post("/api/logout", async (r, s) => {
    if (r.auth) await run("DELETE FROM sessions WHERE token=?", r.auth.token);
    s.clearCookie("alaska_session", {
      path: "/",
    }).json({
      ok: true,
    });
  });
  app.get("/api/me", auth("player"), async (r, s) => {
    const { password, ...p } = await player(r);
    let c = await one("SELECT * FROM characters WHERE player_id=?", p.id);
    if (c?.status !== "approved" && c)
      c = {
        ...c,
        secret: null,
        faction: null,
      };
    s.json({
      player: p,
      character: c,
      missions:
        c?.status === "approved"
          ? await all("SELECT * FROM missions WHERE player_id=?", p.id)
          : [],
      inventory: await all(
        "SELECT i.*,l.title,l.description,l.effect FROM inventory i JOIN lots l ON i.lot_id=l.id WHERE player_id=?",
        p.id,
      ),
      ledger: await all(
        "SELECT * FROM ledger WHERE player_id=? ORDER BY id DESC",
        p.id,
      ),
      vote: await one("SELECT * FROM votes WHERE player_id=?", p.id),
    });
  });
  app.post("/api/character", auth("player"), async (r, s) => {
    const p = await player(r),
      name = required(r.body.name, "角色姓名", 60),
      english = required(r.body.english, "英文名", 60),
      profession = required(r.body.profession, "职业", 60),
      story = required(r.body.story, "虚构人物背景", 2000),
      motive = required(r.body.motive, "赴宴动机", 100),
      skill = r.body.skill;
    if (!["洞察", "技术", "社交"].includes(skill)) fail("技能无效");
    const existing = await one(
      "SELECT * FROM characters WHERE player_id=?",
      p.id,
    );
    if (existing?.status === "approved") fail("已批准角色需由GM重新开放编辑");
    const npc =
      skill === "技术"
        ? "scientist"
        : skill === "洞察"
          ? "detective"
          : "singer";
    await tx(async () => {
      await run(
        `INSERT INTO characters(player_id,name,english,profession,skill,story,secret,npc_id,motive) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET name=excluded.name,english=excluded.english,profession=excluded.profession,skill=excluded.skill,story=excluded.story,secret=excluded.secret,npc_id=excluded.npc_id,status='pending',motive=excluded.motive`,
        p.id,
        name,
        english,
        profession,
        skill,
        story,
        "你曾接触ECHO集团的一份内部材料。今晚必须决定把它交给谁。",
        npc,
        motive,
      );
      await run("DELETE FROM missions WHERE player_id=?", p.id);
      await run(
        "INSERT INTO missions(id,player_id,title,npc_id,reward) VALUES(?,?,?,?,?)",
        token(),
        p.id,
        "向你的NPC联系人介绍自己，完成一次破冰互动",
        npc,
        2,
      );
      await run(
        "INSERT INTO missions(id,player_id,title,npc_id,reward) VALUES(?,?,?,?,?)",
        token(),
        p.id,
        "与另一位宾客交换一条公开情报",
        npc,
        2,
      );
    });
    s.json({
      ok: true,
      generator: "curated-template",
    });
  });
  app.get("/api/clues", auth("player"), async (r, s) => {
    const p = await player(r),
      checks = await all("SELECT * FROM checks WHERE group_id=?", p.group_id);
    s.json({
      clues: await all(
        "SELECT c.id,c.title,c.area,c.skill,c.dc,c.phase,c.category,u.created_at unlocked FROM clues c LEFT JOIN unlocks u ON u.clue_id=c.id AND u.player_id=?",
        p.id,
      ),
      checks,
    });
  });
  const clueResult = async (p, c) => {
    const check = await one(
      "SELECT * FROM checks WHERE group_id=? AND area=?",
      p.group_id,
      c.area,
    );
    return {
      id: c.id,
      title: c.title,
      body: c.body,
      detail:
        check && (check.roll === 20 || check.roll + check.bonus >= c.dc)
          ? c.detail
          : null,
      check,
    };
  };
  app.get("/api/clues/:id", auth("player"), async (r, s) => {
    const { p } = await playable(r),
      c = await one("SELECT * FROM clues WHERE id=?", r.params.id);
    if (!c) fail("证物不存在", 404);
    if (
      !(await one(
        "SELECT 1 FROM unlocks WHERE player_id=? AND clue_id=?",
        p.id,
        c.id,
      ))
    )
      fail("请先翻开证物", 403);
    s.json(await clueResult(p, c));
  });
  app.post("/api/clues/:id/unlock", auth("player"), async (r, s) => {
    const { p } = await playable(r),
      c = await one("SELECT * FROM clues WHERE id=?", r.params.id);
    if (!c) fail("证物不存在", 404);
    if ((await setting()).phase < c.phase)
      fail(`该证物将在第${c.phase}幕开放`, 403);
    await run(
      "INSERT OR IGNORE INTO unlocks(player_id,clue_id) VALUES(?,?)",
      p.id,
      c.id,
    );
    s.json(await clueResult(p, c));
  });
  app.post("/api/check", auth("player"), async (r, s) => {
    const { p, c } = await playable(r),
      e = await one("SELECT * FROM clues WHERE id=?", r.body.clueId);
    if (!e || (await setting()).phase !== 3) fail("请在第三幕选择有效调查区");
    if (
      !(await one(
        "SELECT 1 FROM unlocks WHERE player_id=? AND clue_id=?",
        p.id,
        e.id,
      ))
    )
      fail("请先取得基础证据");
    const check = await tx(async () => {
      const old = await one(
        "SELECT * FROM checks WHERE group_id=? AND area=?",
        p.group_id,
        e.area,
      );
      if (old) return old;
      await run(
        "INSERT INTO checks(group_id,area,roll,bonus) VALUES(?,?,?,?)",
        p.group_id,
        e.area,
        randomInt(1, 21),
        c.skill === e.skill ? 2 : 0,
      );
      return await one(
        "SELECT * FROM checks WHERE group_id=? AND area=?",
        p.group_id,
        e.area,
      );
    });
    s.json(check);
  });
  app.get("/api/lots", auth("player"), async (r, s) =>
    s.json(
      await all(
        "SELECT id,title,start_price,description,effect,status,bid,bidder FROM lots",
      ),
    ),
  );
  app.post("/api/lots/:id/bid", auth("player"), async (r, s) => {
    const { p } = await playable(r),
      amount = r.body.amount;
    if (!Number.isSafeInteger(amount) || amount < 1) fail("出价必须是正整数");
    await tx(async () => {
      const l = await one("SELECT * FROM lots WHERE id=?", r.params.id);
      if (!l || l.status !== "open" || (await setting()).phase !== 2)
        fail("该拍品未开放");
      if (amount < Math.max(l.start_price, l.bid + 1))
        fail("出价需高于当前价格");
      const reserved = (
        await one(
          "SELECT COALESCE(SUM(bid),0) n FROM lots WHERE bidder=? AND status='open' AND id!=?",
          p.id,
          l.id,
        )
      ).n;
      if (
        amount + reserved >
        (await one("SELECT coins FROM players WHERE id=?", p.id)).coins
      )
        fail("可用金币不足，其他领先竞拍已预留金币");
      await run(
        "UPDATE lots SET bid=?,bidder=? WHERE id=?",
        amount,
        p.id,
        l.id,
      );
      await run(
        "INSERT INTO bids(lot_id,player_id,amount) VALUES(?,?,?)",
        l.id,
        p.id,
        amount,
      );
    });
    s.json({
      ok: true,
    });
  });
  app.post("/api/inventory/:id/use", auth("player"), async (r, s) => {
    const { p } = await playable(r);
    if ((await setting()).phase !== 4) fail("道具将在庭审阶段使用");
    await tx(async () => {
      const item = await one(
        "SELECT i.*,l.title FROM inventory i JOIN lots l ON l.id=i.lot_id WHERE i.id=? AND player_id=?",
        r.params.id,
        p.id,
      );
      if (!item || item.used) fail("道具不存在或已使用");
      await run("UPDATE inventory SET used=1 WHERE id=?", item.id);
      await run(
        "INSERT INTO audit(actor,action) VALUES(?,?)",
        p.id,
        `庭审申请使用${item.title}，由GM现场执行效果`,
      );
    });
    s.json({
      ok: true,
    });
  });
  app.post("/api/vote", auth("player"), async (r, s) => {
    const { p } = await playable(r);
    if ((await setting()).phase !== 4 || !(await setting()).voting)
      fail("GM尚未开放最终投票");
    const v = r.body;
    if (!(await one("SELECT id FROM npcs WHERE id=?", v.suspect)))
      fail("请选择嫌疑人");
    for (const k of ["motive", "means", "opportunity"]) {
      if (
        !(await one(
          "SELECT 1 FROM unlocks WHERE player_id=? AND clue_id=?",
          p.id,
          v[k],
        ))
      )
        fail("三项证明必须选择你已获得的证据");
    }
    if (!["publish", "protect", "destroy"].includes(v.decision))
      fail("请选择结局");
    await run(
      "INSERT INTO votes(player_id,suspect,motive,means,opportunity,decision) VALUES(?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET suspect=excluded.suspect,motive=excluded.motive,means=excluded.means,opportunity=excluded.opportunity,decision=excluded.decision",
      p.id,
      v.suspect,
      v.motive,
      v.means,
      v.opportunity,
      v.decision,
    );
    s.json({
      ok: true,
    });
  });
  app.get("/api/staff", auth("gm", "npc"), async (r, s) => {
    const gm = r.auth.role === "gm";
    s.json({
      settings: await setting(),
      players: await all(
        `SELECT p.id,p.name,p.payment,p.checked_in,p.coins,p.group_id,c.name AS "character",c.status${gm ? ",c.faction" : ""} FROM players p LEFT JOIN characters c ON c.player_id=p.id ORDER BY p.created_at DESC`,
      ),
      missions: await all(
        gm ? "SELECT * FROM missions" : "SELECT * FROM missions WHERE npc_id=?",
        ...(gm ? [] : [r.auth.user_id]),
      ),
      npcs: await all(
        gm
          ? `SELECT * FROM npcs ORDER BY ${npcOrder}`
          : `SELECT id,name,english,role,bio FROM npcs ORDER BY ${npcOrder}`,
      ),
      clues: gm ? await all("SELECT * FROM clues") : [],
      lots: gm ? await all("SELECT * FROM lots") : [],
      stats: {
        unlocks: (await one("SELECT COUNT(*) n FROM unlocks")).n,
        votes: gm ? (await one("SELECT COUNT(*) n FROM votes")).n : 0,
      },
      events: await all("SELECT * FROM events ORDER BY id DESC LIMIT 10"),
      votes: gm
        ? await all("SELECT suspect,COUNT(*) n FROM votes GROUP BY suspect")
        : [],
      audit: gm
        ? await all("SELECT * FROM audit ORDER BY id DESC LIMIT 20")
        : [],
    });
  });
  app.get("/api/staff/players/:id", auth("gm"), async (r, s) => {
    const p = await one(
      "SELECT id,name,contact,payment,group_id,checked_in,coins FROM players WHERE id=?",
      r.params.id,
    );
    if (!p) fail("玩家不存在", 404);
    s.json({
      player: p,
      character: await one("SELECT * FROM characters WHERE player_id=?", p.id),
    });
  });
  app.post("/api/staff/players/:id", auth("gm"), async (r, s) => {
    const id = r.params.id;
    if (!(await one("SELECT id FROM players WHERE id=?", id)))
      fail("玩家不存在", 404);
    await tx(async () => {
      if (r.body.payment) {
        if (!["pending", "paid", "refunded"].includes(r.body.payment))
          fail("票务状态无效");
        await run(
          "UPDATE players SET payment=? WHERE id=?",
          r.body.payment,
          id,
        );
      }
      if (r.body.checkin) {
        const p = await one("SELECT * FROM players WHERE id=?", id);
        if (p.payment !== "paid") fail("请先确认票务");
        if (!p.checked_in) {
          await run("UPDATE players SET checked_in=1 WHERE id=?", id);
          await coin(id, 3, "现场签到初始金币");
        }
      }
      if (r.body.status) {
        if (!["pending", "approved"].includes(r.body.status))
          fail("审核状态无效");
        const c = await one("SELECT * FROM characters WHERE player_id=?", id);
        if (!c) fail("该玩家尚未填写角色");
        const faction = r.body.faction || c.faction;
        if (!["fbi", "croft", "conspirator"].includes(faction))
          fail("阵营无效");
        if (
          faction === "conspirator" &&
          (
            await one(
              "SELECT COUNT(*) n FROM characters WHERE faction='conspirator' AND player_id!=?",
              id,
            )
          ).n >= 3
        )
          fail("隐藏同伙最多3人");
        await run(
          "UPDATE characters SET status=?,faction=? WHERE player_id=?",
          r.body.status,
          faction,
          id,
        );
      }
      if (r.body.group) {
        if (
          !Number.isInteger(r.body.group) ||
          r.body.group < 1 ||
          r.body.group > 6
        )
          fail("调查组必须为1到6");
        await run("UPDATE players SET group_id=? WHERE id=?", r.body.group, id);
      }
      await audit(r, `更新玩家 ${id.slice(0, 8)}：${JSON.stringify(r.body)}`);
    });
    s.json({
      ok: true,
    });
  });
  app.post(
    "/api/staff/missions/:id/complete",
    auth("gm", "npc"),
    async (r, s) => {
      await tx(async () => {
        const m = await one("SELECT * FROM missions WHERE id=?", r.params.id);
        if (!m || (r.auth.role === "npc" && m.npc_id !== r.auth.user_id))
          fail("无法操作此任务", 403);
        if ((await setting()).phase !== 1) fail("破冰任务只在第一幕结算");
        const p = await one("SELECT * FROM players WHERE id=?", m.player_id);
        if (!p.checked_in || p.payment !== "paid") fail("玩家尚未签到");
        if (m.status === "done") return;
        const earned = (
          await one(
            "SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE player_id=? AND amount>0",
            p.id,
          )
        ).n;
        const award = Math.min(m.reward, Math.max(0, 10 - earned));
        await coin(p.id, award, `任务：${m.title}`);
        await run("UPDATE missions SET status='done' WHERE id=?", m.id);
        await audit(r, `完成任务 ${m.id.slice(0, 8)} +${award}`);
      });
      s.json({
        ok: true,
      });
    },
  );
  app.post("/api/staff/phase", auth("gm"), async (r, s) => {
    const phase = r.body.phase;
    if (!Number.isInteger(phase) || phase < 1 || phase > 4)
      fail("剧情阶段无效");
    await run(
      "UPDATE settings SET phase=?,voting=CASE WHEN ?=4 THEN voting ELSE 0 END",
      phase,
      phase,
    );
    await run(
      "INSERT INTO events(title,body) VALUES(?,?)",
      `第${phase}幕 · ${phases[phase - 1]}`,
      "新的剧情阶段已开启，请听从现场GM指引。",
    );
    await audit(r, `切换第${phase}幕`);
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/voting", auth("gm"), async (r, s) => {
    if ((await setting()).phase !== 4) fail("请先进入庭审");
    await run("UPDATE settings SET voting=?", r.body.open ? 1 : 0);
    await audit(r, r.body.open ? "开启最终投票" : "关闭最终投票");
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/events", auth("gm"), async (r, s) => {
    await run(
      "INSERT INTO events(title,body) VALUES(?,?)",
      required(r.body.title, "标题", 80),
      required(r.body.body, "消息", 1000),
    );
    await audit(r, "发布全场消息");
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/lots/:id", auth("gm"), async (r, s) => {
    await tx(async () => {
      const l = await one("SELECT * FROM lots WHERE id=?", r.params.id);
      if (!l) fail("拍品不存在");
      if (l.status === "sold") fail("该拍品已成交");
      if (r.body.action === "open") {
        if ((await setting()).phase !== 2) fail("拍卖只能在第二幕开放");
        await run("UPDATE lots SET status='open' WHERE id=?", l.id);
      } else if (r.body.action === "settle") {
        if (l.status !== "open" || !l.bidder) fail("暂无有效出价");
        await coin(l.bidder, -l.bid, `拍卖成交：${l.title}`);
        await run(
          "INSERT INTO inventory(player_id,lot_id) VALUES(?,?)",
          l.bidder,
          l.id,
        );
        await run("UPDATE lots SET status='sold' WHERE id=?", l.id);
      } else fail("拍卖操作无效");
      await audit(r, `拍品 ${l.title} ${r.body.action}`);
    });
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/coins", auth("gm"), async (r, s) => {
    const id = r.body.playerId,
      amount = r.body.amount;
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1000 || !amount)
      fail("请输入有效整数金额");
    required(r.body.reason, "调整原因", 120);
    await tx(async () => {
      const p = await one("SELECT * FROM players WHERE id=?", id);
      if (!p) fail("玩家不存在");
      const reserved = (
        await one(
          "SELECT COALESCE(SUM(bid),0) n FROM lots WHERE bidder=? AND status='open'",
          id,
        )
      ).n;
      if (p.coins + amount < reserved) fail("余额不能低于已预留竞拍金币");
      await coin(id, amount, r.body.reason);
      await audit(r, `金币调整 ${id.slice(0, 8)} ${amount}：${r.body.reason}`);
    });
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/unlock", auth("gm"), async (r, s) => {
    if (
      !(await one("SELECT id FROM players WHERE id=?", r.body.playerId)) ||
      !(await one("SELECT id FROM clues WHERE id=?", r.body.clueId))
    )
      fail("玩家或证据不存在");
    await run(
      "INSERT OR IGNORE INTO unlocks(player_id,clue_id) VALUES(?,?)",
      r.body.playerId,
      r.body.clueId,
    );
    await audit(
      r,
      `应急放行 ${r.body.clueId} 给 ${r.body.playerId.slice(0, 8)}`,
    );
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/settings", auth("gm"), async (r, s) => {
    const { capacity, price } = r.body;
    if (
      !Number.isInteger(capacity) ||
      capacity < Math.max(1, (await one("SELECT COUNT(*) n FROM players")).n) ||
      capacity > 100 ||
      !Number.isInteger(price) ||
      price < 0 ||
      price > 10000
    )
      fail("请输入有效名额和价格，名额不能少于已报名人数");
    await run("UPDATE settings SET capacity=?,price=?", capacity, price);
    await audit(r, "更新活动名额与价格");
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/clues/:id", auth("gm"), async (r, s) => {
    const { dc, phase } = r.body;
    if (
      !Number.isInteger(dc) ||
      dc < 1 ||
      dc > 30 ||
      !Number.isInteger(phase) ||
      phase < 1 ||
      phase > 4
    )
      fail("难度或阶段无效");
    if (!(await one("SELECT id FROM clues WHERE id=?", r.params.id)))
      fail("证据不存在", 404);
    await run(
      "UPDATE clues SET title=?,body=?,detail=?,dc=?,phase=? WHERE id=?",
      required(r.body.title, "标题", 100),
      required(r.body.body, "基础证据", 2000),
      required(r.body.detail, "进阶信息", 2000),
      dc,
      phase,
      r.params.id,
    );
    await audit(r, `编辑证据 ${r.params.id}`);
    s.json({
      ok: true,
    });
  });
  app.post("/api/staff/npcs/:id", auth("gm"), async (r, s) => {
    if (!(await one("SELECT id FROM npcs WHERE id=?", r.params.id)))
      fail("NPC不存在", 404);
    await run(
      "UPDATE npcs SET bio=?,secret=? WHERE id=?",
      required(r.body.bio, "公开背景", 2000),
      required(r.body.secret, "保密设定", 2000),
      r.params.id,
    );
    await audit(r, `编辑NPC ${r.params.id}`);
    s.json({
      ok: true,
    });
  });
  app.use("/api", (r, s) =>
    s.status(404).json({
      error: "接口不存在",
    }),
  );
  app.use((e, r, s, next) => {
    if (["23505", "23514", "SQLITE_CONSTRAINT_CHECK"].includes(e.code)) {
      e.status = 400;
      e.message = "数据已存在或操作超出限制，请刷新后重试";
    }
    if (!e.status) console.error(e);
    s.status(e.status || 500).json({
      error: e.status ? e.message : "服务暂时异常，请重试",
    });
  });
  return {
    app,
    db,
  };
}
