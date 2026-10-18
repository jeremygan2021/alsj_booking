export function normalizePaidPhone(value) {
  if (typeof value !== "string") return null;
  let phone = value
    .trim()
    .replace(/^=/, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10))
    .replace(/[\s\u200b()（）-]/g, "");
  if (phone.startsWith("+86")) phone = phone.slice(3);
  else if (phone.startsWith("0086")) phone = phone.slice(4);
  else if (/^861[3-9]\d{9}$/.test(phone)) phone = phone.slice(2);
  return /^1[3-9]\d{9}$/.test(phone) ? phone : null;
}

// Accept ordinary CSV/TSV exports and pasted rows. Quoted commas/newlines are
// parsed as data; content is never evaluated as a spreadsheet formula.
function sourceRows(text) {
  const rows = [];
  let fields = [],
    value = "",
    quoted = false,
    line = 1,
    start = 1;
  const finish = () => {
    fields.push(value.trim());
    if (fields.some(Boolean)) rows.push({ fields, line: start });
    fields = [];
    value = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || !value.trim())) {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && /[,，;；\t|]/.test(c)) {
      fields.push(value.trim());
      value = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (quoted) value += " ";
      else finish();
      line++;
      if (!quoted) start = line;
    } else value += c;
  }
  finish();
  return rows;
}

export function parsePaidPhoneText(text, fail) {
  if (typeof text !== "string" || !text.trim() || text.length > 100000)
    fail("请粘贴手机号或导入不超过100KB的CSV/文本");
  const records = [],
    seen = new Set(),
    invalidRows = [];
  let duplicates = 0,
    totalRows = 0;
  const rows = sourceRows(text.replace(/^\uFEFF/, ""));
  if (rows.length > 2000) fail("每次最多导入2000行，请分批处理");
  for (const row of rows) {
    const values = row.fields.map(normalizePaidPhone);
    let candidates = values
      .map((phone, index) => ({ phone, index }))
      .filter((entry) => entry.phone);
    // Also support “姓名 138 0013 8000” pasted without CSV delimiters.
    let remainder = "";
    if (!candidates.length && row.fields.length === 1) {
      const raw = row.fields[0];
      const matches = [
        ...raw.matchAll(
          /(?<![\dA-Za-z])(?:\+86[\s-]*|0086[\s-]*|86[\s-]*)?1[3-9](?:[\s-]*\d){9}(?![\dA-Za-z])/g,
        ),
      ];
      if (matches.length === 1) {
        const phone = normalizePaidPhone(matches[0][0]);
        const rest = raw.replace(matches[0][0], "").trim();
        if (phone && !/[\d@]/.test(rest)) {
          candidates = [{ phone, index: 0 }];
          remainder = rest;
        }
      }
    }
    if (
      !candidates.length &&
      totalRows === 0 &&
      row.fields.some((v) =>
        /^(?:手机号(?:码)?|电话(?:号码)?|姓名|名字|phone(?: number)?|mobile|name|contact)$/i.test(
          v.trim(),
        ),
      )
    )
      continue;
    totalRows++;
    if (!candidates.length) {
      invalidRows.push({
        line: row.line,
        reason: "未找到有效的中国大陆手机号",
      });
      continue;
    }
    for (const { phone, index } of candidates) {
      if (seen.has(phone)) {
        duplicates++;
        continue;
      }
      seen.add(phone);
      const name = (
        remainder ||
        row.fields.find(
          (value, i) =>
            i !== index &&
            !values[i] &&
            !/^\d+$/.test(value) &&
            value.length <= 80,
        ) ||
        ""
      ).slice(0, 80);
      records.push({ phone, name, line: row.line });
    }
  }
  return { records, totalRows, duplicates, invalidRows };
}

export function createPaidPhoneService({ one, all, run, fail }) {
  const matchPlayer = async (id, actor = "system") => {
    const player = await one(
      "SELECT id,contact,payment FROM players WHERE id=?",
      id,
    );
    const phone = normalizePaidPhone(player?.contact);
    if (
      !phone ||
      player.payment !== "pending" ||
      !(await one("SELECT phone FROM paid_phones WHERE phone=?", phone)) ||
      (await one("SELECT npc_id FROM npc_phones WHERE phone=?", phone))
    )
      return false;
    const result = await run(
      "UPDATE players SET payment='paid' WHERE id=? AND payment='pending'",
      id,
    );
    if (!result.changes) return false;
    await run(
      "INSERT INTO audit(actor,action) VALUES(?,?)",
      actor,
      `付费手机号名单自动核验玩家 ${id.slice(0, 8)}`,
    );
    return true;
  };
  const preview = async (text) => {
    const parsed = parsePaidPhoneText(text, fail);
    const players = await all("SELECT id,name,contact,payment FROM players");
    const byPhone = new Map(
      players.map((p) => [normalizePaidPhone(p.contact), p]),
    );
    const imported = new Set(
      (await all("SELECT phone FROM paid_phones")).map((p) => p.phone),
    );
    const npcPhones = new Set(
      (await all("SELECT phone FROM npc_phones")).map((p) =>
        normalizePaidPhone(p.phone),
      ),
    );
    const rows = parsed.records.map((record) => {
      const player = byPhone.get(record.phone),
        excluded = npcPhones.has(record.phone);
      return {
        ...record,
        playerId: player?.id || null,
        playerName: player?.name || "",
        payment: player?.payment || null,
        imported: imported.has(record.phone),
        status: excluded
          ? "excluded_npc"
          : !player
            ? "pending_registration"
            : player.payment === "paid"
              ? "already_paid"
              : player.payment === "refunded"
                ? "refunded"
                : "new",
      };
    });
    const eligible = rows.filter((r) => r.status !== "excluded_npc");
    return {
      summary: {
        totalRows: parsed.totalRows,
        valid: rows.length,
        duplicates: parsed.duplicates,
        invalid: parsed.invalidRows.length,
        excludedNpcs: rows.length - eligible.length,
        alreadyImported: eligible.filter((r) => r.imported).length,
        registered: eligible.filter((r) => r.playerId).length,
        unregistered: eligible.filter((r) => !r.playerId).length,
        alreadyPaid: eligible.filter((r) => r.payment === "paid").length,
        refunded: eligible.filter((r) => r.payment === "refunded").length,
        toMarkPaid: eligible.filter((r) => r.payment === "pending").length,
      },
      rows,
      invalidRows: parsed.invalidRows,
    };
  };
  return { matchPlayer, preview };
}

export function mountPaidPhoneRoutes(
  app,
  { auth, one, all, run, tx, fail, audit, paidPhones },
) {
  const prefix = "/api/staff/paid-phones";
  app.post(`${prefix}/preview`, auth("gm"), async (req, res) =>
    res.json(await paidPhones.preview(req.body?.text)),
  );
  app.post(`${prefix}/import`, auth("gm"), async (req, res) => {
    const body = req.body || {};
    if (
      body.sourceName != null &&
      (typeof body.sourceName !== "string" || body.sourceName.length > 120)
    )
      fail("名单来源最多120字");
    const source = (body.sourceName || "管理员导入").trim();
    const result = await tx(async () => {
      const preview = await paidPhones.preview(body.text);
      if (!preview.rows.some((r) => r.status !== "excluded_npc"))
        fail("未找到可导入的玩家手机号");
      let added = 0,
        markedPaid = 0;
      for (const row of preview.rows) {
        if (row.status === "excluded_npc") continue;
        added += Number(
          (
            await run(
              "INSERT OR IGNORE INTO paid_phones(phone,name,source_name,imported_by,imported_at) VALUES(?,?,?,?,?)",
              row.phone,
              row.name,
              source,
              req.auth.user_id,
              Date.now(),
            )
          ).changes || 0,
        );
        if (
          row.playerId &&
          (await paidPhones.matchPlayer(row.playerId, req.auth.user_id))
        )
          markedPaid++;
      }
      await audit(
        req,
        `导入付费手机号名单：新增${added}，核验${markedPaid}，待注册${preview.summary.unregistered}，排除NPC${preview.summary.excludedNpcs}，无效${preview.summary.invalid}，重复${preview.summary.duplicates}`,
      );
      return { ...preview, summary: { ...preview.summary, added, markedPaid } };
    });
    res.json({ ok: true, ...result });
  });
  app.get(prefix, auth("gm"), async (req, res) => {
    const records = await all(
      "SELECT * FROM paid_phones ORDER BY imported_at DESC,phone",
    );
    const players = await all("SELECT id,name,contact,payment FROM players");
    const byPhone = new Map(
      players.map((p) => [normalizePaidPhone(p.contact), p]),
    );
    const npcs = new Set(
      (await all("SELECT phone FROM npc_phones")).map((n) =>
        normalizePaidPhone(n.phone),
      ),
    );
    const rows = records.map((record) => {
      const player = byPhone.get(record.phone);
      return {
        ...record,
        playerId: player?.id || null,
        playerName: player?.name || "",
        payment: player?.payment || null,
        status: npcs.has(record.phone)
          ? "excluded_npc"
          : !player
            ? "pending_registration"
            : player.payment === "refunded"
              ? "refunded"
              : player.payment === "paid"
                ? "already_paid"
                : "new",
      };
    });
    res.json({
      rows,
      summary: {
        total: rows.length,
        registered: rows.filter((r) => r.playerId).length,
        unregistered: rows.filter((r) => !r.playerId).length,
        paid: rows.filter((r) => r.payment === "paid").length,
        refunded: rows.filter((r) => r.payment === "refunded").length,
      },
    });
  });
  app.post(`${prefix}/:phone/remove`, auth("gm"), async (req, res) => {
    const phone = normalizePaidPhone(req.params.phone);
    if (!phone) fail("手机号无效");
    await tx(async () => {
      if (!(await one("SELECT phone FROM paid_phones WHERE phone=?", phone)))
        fail("名单项不存在", 404);
      await run("DELETE FROM paid_phones WHERE phone=?", phone);
      await audit(
        req,
        `移除付费名单项（尾号${phone.slice(-4)}），不改变玩家付款状态`,
      );
    });
    res.json({ ok: true });
  });
}
