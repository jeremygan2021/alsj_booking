import { createSceneCatalog } from "../ar/catalog.js";
import { defaultSite } from "./content-store.js";

export function mountManagementRoutes(
  app,
  {
    auth,
    one,
    all,
    run,
    tx,
    fail,
    required,
    audit,
    token,
    store,
    assetBaseUrl,
    paidPhones,
  },
) {
  const text = (v, label, max) => required(v, label, max);
  const number = (value, label, min, max) => {
    if (!Number.isInteger(value) || value < min || value > max)
      fail(`${label}必须为${min}到${max}的整数`);
    return value;
  };
  const exists = async (table, id) => {
    if (!(await one(`SELECT id FROM ${table} WHERE id=?`, id)))
      fail("对应档案不存在", 404);
  };
  const save = (path, action, name) =>
    app.post(`/api/staff/manage/${path}`, auth("gm"), async (req, res) => {
      const result = await tx(async () => {
        const data = await action(req);
        await audit(req, `${name} ${req.params.id || data?.id || ""}`);
        return data;
      });
      res.json({ ok: true, ...result });
    });
  app.get("/api/staff/manage", auth("gm"), async (req, res) => {
    const [
      players,
      characters,
      npcs,
      clues,
      missions,
      lots,
      events,
      scenes,
      site,
      votes,
    ] = await Promise.all([
      all(
        "SELECT p.id,p.name,p.contact,p.payment,p.checked_in,p.coins,p.group_id,p.created_at,CASE WHEN EXISTS (SELECT 1 FROM paid_phones pf WHERE pf.phone=p.contact) AND NOT EXISTS (SELECT 1 FROM npc_phones nf WHERE nf.phone=p.contact) THEN 1 ELSE 0 END AS paid_phone_import FROM players p ORDER BY p.created_at DESC",
      ),
      all("SELECT * FROM characters"),
      all(
        "SELECT n.*,p.phone FROM npcs n LEFT JOIN npc_phones p ON p.npc_id=n.id",
      ),
      all("SELECT * FROM clues ORDER BY id"),
      all("SELECT * FROM missions"),
      all("SELECT * FROM lots ORDER BY id"),
      all("SELECT * FROM events ORDER BY id DESC"),
      store.listScenes(),
      store.getSite(),
      all("SELECT * FROM votes"),
    ]);
    res.json({
      players,
      characters,
      npcs,
      clues,
      missions,
      lots,
      events,
      scenes,
      site,
      votes,
    });
  });
  save(
    "players/:id",
    async (req) => {
      await exists("players", req.params.id);
      const name = text(req.body.name, "报名姓名", 40),
        contact = text(req.body.contact, "手机号或邮箱", 100);
      if (!/^(1\d{10}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(contact))
        fail("请输入有效手机号或邮箱");
      if (await one("SELECT npc_id FROM npc_phones WHERE phone=?", contact))
        fail("该手机号已绑定NPC，不能作为玩家登录手机号");
      if (
        await one(
          "SELECT id FROM players WHERE contact=? AND id!=?",
          contact,
          req.params.id,
        )
      )
        fail("该联系方式已被其他玩家使用");
      await run(
        "UPDATE players SET name=?,contact=? WHERE id=?",
        name,
        contact,
        req.params.id,
      );
      await paidPhones.matchPlayer(req.params.id, req.auth.user_id);
    },
    "编辑报名资料",
  );
  save(
    "characters/:id",
    async (req) => {
      await exists("players", req.params.id);
      const d = req.body;
      if (
        !["洞察", "技术", "社交"].includes(d.skill) ||
        !["pending", "approved"].includes(d.status) ||
        !["fbi", "croft", "conspirator"].includes(d.faction)
      )
        fail("角色技能、状态或阵营无效");
      await exists("npcs", d.npc_id);
      if (
        d.faction === "conspirator" &&
        (
          await one(
            "SELECT COUNT(*) n FROM characters WHERE faction='conspirator' AND player_id!=?",
            req.params.id,
          )
        ).n >= 3
      )
        fail("隐藏同伙最多3人");
      await run(
        `INSERT INTO characters(player_id,name,english,profession,skill,faction,story,secret,npc_id,status,motive) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET name=excluded.name,english=excluded.english,profession=excluded.profession,skill=excluded.skill,faction=excluded.faction,story=excluded.story,secret=excluded.secret,npc_id=excluded.npc_id,status=excluded.status,motive=excluded.motive`,
        req.params.id,
        text(d.name, "角色姓名", 60),
        text(d.english, "英文名", 60),
        text(d.profession, "职业", 60),
        d.skill,
        d.faction,
        text(d.story, "角色背景", 2000),
        text(d.secret, "角色秘密", 2000),
        d.npc_id,
        d.status,
        text(d.motive, "赴宴动机", 100),
      );
    },
    "编辑完整角色卡",
  );
  const clue = async (req, create) => {
    const d = req.body,
      id = create ? d.id : req.params.id;
    if (!/^E-\d{2}$/.test(id || "")) fail("线索编号须为 E-01 格式");
    if (create && (await one("SELECT id FROM clues WHERE id=?", id)))
      fail("线索编号已存在");
    if (!create) await exists("clues", id);
    if (!["洞察", "技术", "社交"].includes(d.skill)) fail("鉴定技能无效");
    const values = [
      text(d.title, "线索标题", 100),
      text(d.area, "调查区域", 60),
      d.skill,
      number(d.dc, "DC难度", 1, 30),
      text(d.body, "基础证据", 2000),
      text(d.detail, "进阶证据", 2000),
      text(d.category, "证据分类", 40),
      number(d.phase, "开放幕次", 1, 4),
    ];
    await run(
      create
        ? "INSERT INTO clues(title,area,skill,dc,body,detail,category,phase,id) VALUES(?,?,?,?,?,?,?,?,?)"
        : "UPDATE clues SET title=?,area=?,skill=?,dc=?,body=?,detail=?,category=?,phase=? WHERE id=?",
      ...values,
      id,
    );
    return { id };
  };
  save("clues", (req) => clue(req, true), "新增线索");
  save("clues/:id", (req) => clue(req, false), "编辑线索");
  const npc = async (req, create) => {
    const d = req.body,
      id = create ? d.id : req.params.id;
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id || ""))
      fail("NPC编号使用小写英文、数字和短横线");
    if (create && (await one("SELECT id FROM npcs WHERE id=?", id)))
      fail("NPC编号已存在");
    if (!create) await exists("npcs", id);
    const values = [
      text(d.name, "NPC姓名", 60),
      text(d.english, "NPC英文名", 60),
      text(d.role, "NPC身份", 100),
      text(d.bio, "公开背景", 2000),
      text(d.secret, "保密设定", 2000),
    ];
    await run(
      create
        ? "INSERT INTO npcs(name,english,role,bio,secret,id) VALUES(?,?,?,?,?,?)"
        : "UPDATE npcs SET name=?,english=?,role=?,bio=?,secret=? WHERE id=?",
      ...values,
      id,
    );
    if (d.phone !== undefined) {
      if (!d.phone) await run("DELETE FROM npc_phones WHERE npc_id=?", id);
      else {
        if (!/^1\d{10}$/.test(d.phone)) fail("NPC手机号须为11位数字");
        if (await one("SELECT id FROM players WHERE contact=?", d.phone))
          fail("该手机号已用于玩家账号，不能绑定NPC");
        if (
          await one(
            "SELECT npc_id FROM npc_phones WHERE phone=? AND npc_id!=?",
            d.phone,
            id,
          )
        )
          fail("该手机号已绑定其他NPC");
        await run(
          "INSERT INTO npc_phones(npc_id,phone) VALUES(?,?) ON CONFLICT(npc_id) DO UPDATE SET phone=excluded.phone",
          id,
          d.phone,
        );
      }
    }
    return { id };
  };
  save("npcs", (req) => npc(req, true), "新增NPC");
  save("npcs/:id", (req) => npc(req, false), "编辑NPC档案");
  const mission = async (req, create) => {
    const d = req.body,
      id = create ? token() : req.params.id;
    await exists("players", d.player_id);
    await exists("npcs", d.npc_id);
    if (!create) {
      const old = await one("SELECT * FROM missions WHERE id=?", id);
      if (!old) fail("委托不存在", 404);
      if (old.status === "done") fail("已结算委托不可修改，避免改变金币账目");
    }
    const values = [
      d.player_id,
      text(d.title, "委托标题", 200),
      d.npc_id,
      number(d.reward, "金币奖励", 1, 10),
    ];
    await run(
      create
        ? "INSERT INTO missions(player_id,title,npc_id,reward,id) VALUES(?,?,?,?,?)"
        : "UPDATE missions SET player_id=?,title=?,npc_id=?,reward=? WHERE id=?",
      ...values,
      id,
    );
    return { id };
  };
  save("missions", (req) => mission(req, true), "新增委托");
  save("missions/:id", (req) => mission(req, false), "编辑委托");
  const lot = async (req, create) => {
    const d = req.body,
      id = create
        ? (await one("SELECT COALESCE(MAX(id),0)+1 id FROM lots")).id
        : Number(req.params.id);
    if (!create) {
      const old = await one("SELECT * FROM lots WHERE id=?", id);
      if (!old) fail("拍品不存在", 404);
      if (old.status !== "waiting") fail("已开放或成交的拍品不可修改");
    }
    const values = [
      text(d.title, "拍品标题", 100),
      number(d.start_price, "起拍价", 1, 1000),
      text(d.description, "拍品说明", 2000),
      text(d.effect, "道具效果", 100),
    ];
    await run(
      create
        ? "INSERT INTO lots(title,start_price,description,effect,id) VALUES(?,?,?,?,?)"
        : "UPDATE lots SET title=?,start_price=?,description=?,effect=? WHERE id=?",
      ...values,
      id,
    );
    return { id };
  };
  save("lots", (req) => lot(req, true), "新增拍品");
  save("lots/:id", (req) => lot(req, false), "编辑拍品");
  save(
    "events/:id",
    async (req) => {
      await exists("events", req.params.id);
      await run(
        "UPDATE events SET title=?,body=? WHERE id=?",
        text(req.body.title, "广播标题", 80),
        text(req.body.body, "广播正文", 1000),
        req.params.id,
      );
    },
    "编辑广播",
  );
  save(
    "site",
    async (req) => {
      const site = Object.fromEntries(
        Object.keys(defaultSite).map((key) => [
          key,
          text(req.body[key], key, key === "description" ? 2000 : 120),
        ]),
      );
      await store.save("site", "landing", site);
    },
    "编辑报名首页内容",
  );
  save(
    "scenes/:id",
    async (req) => {
      const scene = req.body;
      if (scene.id !== req.params.id) fail("场景编号不能与地址不一致");
      try {
        createSceneCatalog([scene], assetBaseUrl);
      } catch (error) {
        fail(error.message);
      }
      for (const hotspot of scene.hotspots)
        await exists("clues", hotspot.clueId);
      await store.save("ar", scene.id, scene);
    },
    "发布AR场景配置",
  );
}
