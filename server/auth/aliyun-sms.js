import RPC from "@alicloud/pop-core";
export function createAliyunSmsSender(env = process.env) {
  if (env.SMS_ENABLED !== "true") return null;
  if (
    !env.ALIBABA_CLOUD_ACCESS_KEY_ID ||
    !env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ||
    !env.SMS_SIGN_NAME
  )
    throw new Error("启用短信登录需配置阿里云AccessKey及短信签名");
  const client = new RPC({
    accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    ...(env.ALIBABA_CLOUD_SECURITY_TOKEN
      ? { securityToken: env.ALIBABA_CLOUD_SECURITY_TOKEN }
      : {}),
    endpoint: "https://dysmsapi.aliyuncs.com",
    apiVersion: "2017-05-25",
  });
  return async ({ phone, code, requestId }) => {
    const result = await client.request(
      "SendSms",
      {
        PhoneNumbers: phone,
        SignName: env.SMS_SIGN_NAME,
        TemplateCode: env.SMS_TEMPLATE_CODE || "SMS_493295002",
        TemplateParam: JSON.stringify({ code }),
        OutId: requestId,
      },
      { method: "POST", timeout: 10000 },
    );
    if (result.Code !== "OK")
      throw Object.assign(new Error("短信供应商拒绝发送"), {
        code: result.Code,
      });
    return { requestId: result.RequestId, bizId: result.BizId };
  };
}
