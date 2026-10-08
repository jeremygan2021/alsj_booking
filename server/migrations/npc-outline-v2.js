import { npcs } from "../content.js";
const oldNpcs = [
  [
    "host",
    "阿利斯泰尔·克罗夫特",
    "Alistair Croft",
    "庄园男主人",
    "AI财富帝国的缔造者。今晚，他为每位宾客准备了一份特别的邀请。",
    "准备公开集团内部报告，在第三幕死亡。",
  ],
  [
    "detective",
    "伊芙琳·卡特",
    "Evelyn Carter",
    "特别调查员",
    "一位冷静敏锐的访客。她相信，任何完美的谎言都会留下痕迹。",
    "掌握交易记录，引导FBI调查。",
  ],
  [
    "security",
    "达米安·克罗斯",
    "Damien Cross",
    "安保主管",
    "庄园的每扇门都在他的掌控中。他是克罗夫特最信任的旧日亲信。",
    "预设真凶。为掩盖非法数据交易，阻止男主人公开材料。",
  ],
  [
    "singer",
    "薇薇安·哈特",
    "Vivienne Hart",
    "爵士歌手",
    "舞会最耀眼的声音。她与这座庄园之间，有一段从未讲述的往事。",
    "听到书房争执，保留旧日情书。",
  ],
  [
    "scientist",
    "内森尼尔·维尔",
    "Nathaniel Vale",
    "AI架构师",
    "普罗米修斯的创造者。他比任何人都清楚预测与操控之间的界限。",
    "曾改写实验报告，但系统日志提供不在场证明。",
  ],
  [
    "attorney",
    "埃莉诺·惠特莫尔",
    "Eleanor Whitmore",
    "家族律师",
    "遗嘱、交易与承诺的见证人。在她看来，每个字都有代价。",
    "保存未公开遗嘱，主持拍卖和庭审程序。",
  ],
];
const updates = [
  {
    table: "clues",
    id: "E-01",
    field: "body",
    previous: "信件提到，男主人计划在午夜公开集团内部报告。",
    next: "信件提到，盖茨比计划在午夜公开ECHO集团内部报告。",
  },
  {
    table: "clues",
    id: "E-02",
    field: "body",
    previous: "安保部门曾收到一笔来源不明的资金。",
    next: "ECHO集团的一笔秘密资金被转入关联私人账户。",
  },
  {
    table: "clues",
    id: "E-02",
    field: "detail",
    previous: "收款记录指向达米安的私人账户，与旧案日期重合。",
    next: "收款记录指向维拉控制的私人账户，与旧案日期重合。",
  },
  {
    table: "clues",
    id: "E-03",
    field: "body",
    previous: "20:38，男主人离开拍卖厅，独自前往书房。",
    next: "20:38，盖茨比离开拍卖厅，独自前往书房。",
  },
  {
    table: "clues",
    id: "E-04",
    field: "body",
    previous: "20:41，有安保权限的门卡开启书房侧门。",
    next: "20:41，一张获临时安保授权的门卡开启书房侧门。",
  },
  {
    table: "clues",
    id: "E-04",
    field: "detail",
    previous: "门卡持有人登记为达米安·克罗斯。",
    next: "门卡领用记录登记为维拉，与侧门备份影像的时间相符。",
  },
  {
    table: "clues",
    id: "E-05",
    field: "detail",
    previous: "操作来自安保终端，声音事件与死亡时间并不一致。",
    next: "操作使用了维拉领用的临时授权，声音事件与死亡时间并不一致。",
  },
  {
    table: "clues",
    id: "E-06",
    field: "body",
    previous: "书房发现深色衣料纤维与一枚安保制服扣。",
    next: "书房发现深色衣料纤维与一枚服饰扣。",
  },
  {
    table: "clues",
    id: "E-06",
    field: "detail",
    previous: "纤维与安保主管制服一致，需要与其他记录交叉验证。",
    next: "纤维与维拉当晚的服饰一致，需要与其他记录交叉验证。",
  },
  {
    table: "clues",
    id: "E-07",
    field: "title",
    previous: "歌手的证词",
    next: "黛西的证词",
  },
  {
    table: "clues",
    id: "E-07",
    field: "body",
    previous: "薇薇安听到书房附近有人争执。",
    next: "黛西听到书房附近有人争执。",
  },
  {
    table: "clues",
    id: "E-07",
    field: "detail",
    previous: "她听见男主人说：“达米安，今晚我必须说出真相。”",
    next: "她听见盖茨比说：“维拉，今晚我必须说出真相。”",
  },
  {
    table: "clues",
    id: "E-08",
    field: "body",
    previous: "科学家在案发时维护普罗米修斯终端。",
    next: "AI研究员在案发时维护ECHO技术终端。",
  },
  {
    table: "clues",
    id: "E-10",
    field: "detail",
    previous: "律师说明遗嘱尚未生效，继承动机不足以单独证明犯罪。",
    next: "FBI探员核对文件后说明遗嘱尚未生效，继承动机不足以单独证明犯罪。",
  },
  {
    table: "clues",
    id: "E-11",
    field: "detail",
    previous: "身影的步态、制服与达米安吻合，与E-04形成交叉验证。",
    next: "身影的步态、服饰与维拉吻合，与E-04形成交叉验证。",
  },
  {
    table: "clues",
    id: "E-12",
    field: "body",
    previous: "旧审计报告涉及集团对风险数据的操纵。",
    next: "旧审计报告涉及ECHO集团对风险数据的操纵。",
  },
  {
    table: "clues",
    id: "E-12",
    field: "detail",
    previous: "报告将达米安与2024年数据掩盖及秘密资金联系起来。",
    next: "报告将维拉与2024年数据掩盖及秘密资金联系起来。",
  },
  {
    table: "lots",
    id: 5,
    field: "description",
    previous: "庭审时申请律师提供遗产相关说明。",
    next: "庭审时申请FBI探员核对遗产相关文件。",
  },
];
// Stable NPC IDs preserve logins, missions, character links, and vote references.
// Upgrade names/identities once; only replace prose still matching old seeds.
export async function applyNpcOutline(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS content_migrations(id TEXT PRIMARY KEY)",
    )
    .run();
  if (
    await db
      .prepare("SELECT id FROM content_migrations WHERE id=?")
      .get("npc-outline-v2")
  )
    return;
  for (const [id, name, english, role, bio, secret] of npcs) {
    const old = oldNpcs.find((n) => n[0] === id);
    await db
      .prepare("UPDATE npcs SET name=?,english=?,role=? WHERE id=?")
      .run(name, english, role, id);
    await db
      .prepare("UPDATE npcs SET bio=? WHERE id=? AND bio=?")
      .run(bio, id, old[4]);
    await db
      .prepare("UPDATE npcs SET secret=? WHERE id=? AND secret=?")
      .run(secret, id, old[5]);
  }
  for (const u of updates) {
    await db
      .prepare(`UPDATE ${u.table} SET ${u.field}=? WHERE id=? AND ${u.field}=?`)
      .run(u.next, u.id, u.previous);
  }
  await db
    .prepare("INSERT INTO content_migrations(id) VALUES(?)")
    .run("npc-outline-v2");
}
