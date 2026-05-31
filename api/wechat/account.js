import crypto from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const sendJson = (res, status, body) => {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
};

const getSupabaseEnv = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("后端缺少 Supabase 服务端配置，暂时不能保存微信公众号绑定。");
  }

  return {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
};

const getBearerToken = (req) => {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new Error("请先登录账号，再操作微信公众号绑定。");
  }

  return match[1];
};

const getCurrentUserId = async (req) => {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${getBearerToken(req)}`,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) {
    throw new Error("登录状态已失效，请重新登录后再操作微信公众号绑定。");
  }

  return String(data.id);
};

const getCryptoKey = () => {
  const secret = process.env.WECHAT_SECRET_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error("后端缺少 WECHAT_SECRET_ENCRYPTION_KEY，暂时不能安全保存 AppSecret。");
  }

  return crypto.createHash("sha256").update(secret).digest();
};

const encryptSecret = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${Buffer.concat([encrypted, tag]).toString("base64")}`;
};

const getWechatAccountRow = async (userId) => {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const response = await fetch(`${url}/rest/v1/wechat_accounts?user_id=eq.${userId}&select=*`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error("读取微信公众号绑定失败，请检查 wechat_accounts 数据表。");
  }

  return rows[0];
};

const rowToAccount = (row) =>
  row
    ? {
        configured: true,
        accountId: row.account_id,
        appId: row.app_id,
        thumbMediaId: row.thumb_media_id,
        author: row.author || undefined,
        updatedAt: row.updated_at,
      }
    : undefined;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(204).end();
  }

  try {
    const userId = await getCurrentUserId(req);

    if (req.method === "GET") {
      return sendJson(res, 200, { account: rowToAccount(await getWechatAccountRow(userId)) });
    }

    if (req.method === "DELETE") {
      const { url, serviceRoleKey } = getSupabaseEnv();
      const response = await fetch(`${url}/rest/v1/wechat_accounts?user_id=eq.${userId}`, {
        method: "DELETE",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
      if (!response.ok) {
        throw new Error("取消微信公众号绑定失败。");
      }

      return sendJson(res, 200, { ok: true });
    }

    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "只支持 GET、POST、DELETE 和 OPTIONS 请求。" });
    }

    const accountId = String(req.body?.accountId || "").trim();
    const appId = String(req.body?.appId || "").trim();
    const appSecret = String(req.body?.appSecret || "").trim();
    const thumbMediaId = String(req.body?.thumbMediaId || "").trim();
    const author = String(req.body?.author || "CreatorSync").trim() || "CreatorSync";
    if (!accountId || !appId || !thumbMediaId) {
      throw new Error("请填写公众号 ID、AppID 和默认封面 media_id。");
    }

    const existing = await getWechatAccountRow(userId);
    if (!existing && !appSecret) {
      throw new Error("首次绑定微信公众号时需要填写 AppSecret。");
    }

    const { url, serviceRoleKey } = getSupabaseEnv();
    const response = await fetch(`${url}/rest/v1/wechat_accounts?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        user_id: userId,
        account_id: accountId,
        app_id: appId,
        app_secret_ciphertext: appSecret ? encryptSecret(appSecret) : existing.app_secret_ciphertext,
        thumb_media_id: thumbMediaId,
        author,
        updated_at: new Date().toISOString(),
      }),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) {
      throw new Error("保存微信公众号绑定失败，请检查 wechat_accounts 数据表。");
    }

    return sendJson(res, 200, { account: rowToAccount(rows[0]) });
  } catch (caught) {
    return sendJson(res, 400, { error: caught instanceof Error ? caught.message : "微信公众号绑定操作失败。" });
  }
}
