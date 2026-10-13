import {
  createHmac,
  randomInt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
const ttl = 15 * 60 * 1000,
  cooldown = 60 * 1000,
  day = 86400000;
export function createSmsAuth({
  one,
  run,
  tx,
  fail,
  sender,
  secret,
  now = Date.now,
  testPhone = "",
  testCode = "",
  testExpiresAt = 0,
  devShortcut = false,
}) {
  const phoneNumber = (phone) => {
    if (typeof phone !== "string" || !/^1\d{10}$/.test(phone))
      fail("请输入11位中国大陆手机号");
    return phone;
  };
  const hash = (value) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const equal = (a, b) =>
    a?.length === b?.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return {
    async send(phone, ip) {
      phoneNumber(phone);
      if (!sender) fail("短信登录暂未启用，请联系管理员", 503);
      const time = now(),
        id = randomBytes(24).toString("hex"),
        code = String(randomInt(0, 1000000)).padStart(6, "0"),
        ipHash = hash("ip:" + ip);
      await tx(async () => {
        await run(
          "DELETE FROM sms_challenges WHERE created_at<?",
          time - 2 * day,
        );
        const latest = await one(
          "SELECT created_at FROM sms_challenges WHERE phone=? ORDER BY created_at DESC LIMIT 1",
          phone,
        );
        if (latest && time - latest.created_at < cooldown)
          fail("请等待60秒后再发送验证码", 429);
        const phoneHour = await one(
          "SELECT COUNT(*) n FROM sms_challenges WHERE phone=? AND created_at>?",
          phone,
          time - 3600000,
        );
        const phoneDay = await one(
          "SELECT COUNT(*) n FROM sms_challenges WHERE phone=? AND created_at>?",
          phone,
          time - day,
        );
        const ipHour = await one(
          "SELECT COUNT(*) n FROM sms_challenges WHERE ip_hash=? AND created_at>?",
          ipHash,
          time - 3600000,
        );
        const globalDay = await one(
          "SELECT COUNT(*) n FROM sms_challenges WHERE created_at>?",
          time - day,
        );
        if (
          phoneHour.n >= 5 ||
          phoneDay.n >= 10 ||
          ipHour.n >= 10 ||
          globalDay.n >= 200
        )
          fail("验证码发送次数过多，请稍后再试", 429);
        await run(
          "INSERT INTO sms_challenges(id,phone,ip_hash,code_hash,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?)",
          id,
          phone,
          ipHash,
          hash(`${id}:${phone}:${code}`),
          time,
          time + ttl,
          "sending",
        );
      });
      try {
        await sender({ phone, code, requestId: id });
        await tx(async () => {
          await run("UPDATE sms_challenges SET status='sent' WHERE id=?", id);
          await run(
            "UPDATE sms_challenges SET status='superseded' WHERE phone=? AND id!=? AND created_at<=? AND status='sent'",
            phone,
            id,
            time,
          );
        });
      } catch (error) {
        await run("UPDATE sms_challenges SET status='failed' WHERE id=?", id);
        // Never log provider request objects, phone numbers or verification codes.
        console.warn(
          "[sms] delivery request failed",
          /^[a-zA-Z0-9_.-]{1,100}$/.test(error.code || "")
            ? error.code
            : "provider-error",
        );
        fail("短信暂时无法发送，请稍后重试", 502);
      }
      return { ok: true, expiresIn: ttl / 1000, retryAfter: cooldown / 1000 };
    },
    async verify(phone, code, onVerified) {
      phoneNumber(phone);
      if (!sender && !devShortcut) fail("短信登录暂未启用，请联系管理员", 503);
      if (typeof code !== "string" || !/^\d{6}$/.test(code))
        fail("请输入6位数字验证码");
      const result = await tx(async () => {
        if (devShortcut && equal(code, "188888")) return onVerified(phone);
        if (
          testPhone &&
          phone === testPhone &&
          testCode &&
          equal(code, testCode) &&
          now() < testExpiresAt
        )
          return onVerified(phone);
        const challenge = await one(
          "SELECT * FROM sms_challenges WHERE phone=? AND status IN ('sent','used','exhausted') ORDER BY created_at DESC,id DESC LIMIT 1",
          phone,
        );
        if (
          !challenge ||
          challenge.status !== "sent" ||
          challenge.expires_at <= now() ||
          challenge.attempts >= 5
        )
          return { error: "验证码无效或已过期，请重新获取" };
        if (
          !equal(challenge.code_hash, hash(`${challenge.id}:${phone}:${code}`))
        ) {
          await run(
            "UPDATE sms_challenges SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'exhausted' ELSE status END WHERE id=?",
            challenge.id,
          );
          return { error: "验证码不正确，请重试" };
        }
        const verified = await onVerified(phone);
        await run(
          "UPDATE sms_challenges SET status='used' WHERE id=?",
          challenge.id,
        );
        return verified;
      });
      if (result.error) fail(result.error);
      return result;
    },
  };
}
