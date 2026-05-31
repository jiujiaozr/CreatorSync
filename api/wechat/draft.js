import crypto from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const requiredEnvKeys = ["WECHAT_APP_ID", "WECHAT_APP_SECRET", "WECHAT_DEFAULT_THUMB_MEDIA_ID"];

const sendJson = (res, status, body) => {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
};

const parseBody = (body) => {
  if (!body) {
    return {};
  }

  return typeof body === "string" ? JSON.parse(body) : body;
};

const normalizeAccountConfig = (item) => {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const appId = String(item.appId || item.app_id || item.accountId || item.account_id || "").trim();
  const appSecret = String(item.appSecret || item.app_secret || "").trim();
  const thumbMediaId = String(item.thumbMediaId || item.thumb_media_id || "").trim();
  if (!appId || !appSecret || !thumbMediaId) {
    return undefined;
  }

  return {
    accountId: String(item.accountId || item.account_id || appId).trim(),
    appId,
    appSecret,
    thumbMediaId,
    author: String(item.author || process.env.WECHAT_DEFAULT_AUTHOR || "CreatorSync").trim(),
  };
};

const getWechatAccountConfigs = () => {
  const rawConfigs = process.env.WECHAT_ACCOUNT_CONFIGS;
  if (rawConfigs) {
    try {
      const parsed = JSON.parse(rawConfigs);
      const sourceList = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([accountId, value]) => ({ accountId, ...value }));
      return sourceList.map(normalizeAccountConfig).filter(Boolean);
    } catch {
      return [];
    }
  }

  const singleAccount = normalizeAccountConfig({
    accountId: process.env.WECHAT_APP_ID,
    appId: process.env.WECHAT_APP_ID,
    appSecret: process.env.WECHAT_APP_SECRET,
    thumbMediaId: process.env.WECHAT_DEFAULT_THUMB_MEDIA_ID,
    author: process.env.WECHAT_DEFAULT_AUTHOR,
  });

  return singleAccount ? [singleAccount] : [];
};

const getMissingConfig = () => {
  const missingBackend = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WECHAT_SECRET_ENCRYPTION_KEY"].filter(
    (key) => !process.env[key],
  );
  if (missingBackend.length > 0) {
    return missingBackend;
  }

  if (process.env.WECHAT_ACCOUNT_CONFIGS) {
    return getWechatAccountConfigs().length > 0 ? [] : ["WECHAT_ACCOUNT_CONFIGS"];
  }

  return requiredEnvKeys.every((key) => process.env[key]) ? [] : [];
};

const getSupabaseEnv = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("后端缺少 Supabase 服务端配置，暂时不能读取微信公众号绑定。");
  }

  return { url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
};

const getBearerToken = (req) => {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new Error("请先登录账号，再同步微信公众号草稿。");
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
    throw new Error("登录状态已失效，请重新登录后再同步微信公众号草稿。");
  }

  return String(data.id);
};

const decryptSecret = (value) => {
  const secret = process.env.WECHAT_SECRET_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error("后端缺少 WECHAT_SECRET_ENCRYPTION_KEY，暂时不能读取 AppSecret。");
  }

  const [ivText, encryptedText] = String(value || "").split(".");
  if (!ivText || !encryptedText) {
    throw new Error("微信公众号 AppSecret 保存格式不正确，请重新绑定。");
  }

  const source = Buffer.from(encryptedText, "base64");
  const encrypted = source.subarray(0, source.length - 16);
  const tag = source.subarray(source.length - 16);
  const key = crypto.createHash("sha256").update(secret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
};

const getUserWechatAccountConfig = async (req) => {
  const userId = await getCurrentUserId(req);
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
  const row = rows[0];
  if (!row) {
    return undefined;
  }

  return {
    accountId: row.account_id,
    appId: row.app_id,
    appSecret: decryptSecret(row.app_secret_ciphertext),
    thumbMediaId: row.thumb_media_id,
    author: row.author || "CreatorSync",
  };
};

const htmlEscape = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const bodyToWechatHtml = (body) =>
  String(body ?? "")
    .split(/\n{2,}|\r\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${htmlEscape(paragraph).replace(/\n/g, "<br/>")}</p>`)
    .join("");

const assertWechatDraft = (payload) => {
  const draft = payload.draft;
  const accountId = String(payload.accountId ?? "").trim();
  if (!draft || typeof draft !== "object" || draft.platformId !== "wechat") {
    throw new Error("请先选择微信公众号草稿，再同步到公众号草稿箱。");
  }

  if (!accountId) {
    throw new Error("请先在个人中心绑定公众号 ID，再发布公众号草稿。");
  }

  if (!String(draft.title ?? "").trim()) {
    throw new Error("公众号标题不能为空。");
  }

  if (!String(draft.body ?? "").trim()) {
    throw new Error("公众号正文不能为空。");
  }

  return { draft, accountId };
};

const getWechatAccessToken = async (accountConfig) => {
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", accountConfig.appId);
  url.searchParams.set("secret", accountConfig.appSecret);

  const response = await fetch(url);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    const detail = data?.errmsg || `HTTP ${response.status}`;
    throw new Error(`微信 access_token 获取失败：${detail}`);
  }

  return data.access_token;
};

const addWechatDraft = async (accessToken, draft, accountConfig) => {
  const digest = String(draft.meta?.summary || draft.subtitle || "")
    .trim()
    .slice(0, 120);
  const content = bodyToWechatHtml(draft.body);
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      articles: [
        {
          title: String(draft.title).trim().slice(0, 64),
          author: accountConfig.author || "CreatorSync",
          digest,
          content,
          content_source_url: "",
          thumb_media_id: accountConfig.thumbMediaId,
          need_open_comment: 0,
          only_fans_can_comment: 0,
        },
      ],
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.errcode) {
    const detail = data?.errmsg || `HTTP ${response.status}`;
    throw new Error(`微信草稿箱同步失败：${detail}`);
  }

  return data;
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(204).end();
  }

  if (req.method === "GET") {
    const missing = getMissingConfig();
    const accountConfigs = getWechatAccountConfigs();
    return sendJson(res, 200, {
      configured: missing.length === 0,
      message:
        missing.length === 0
          ? "微信公众号草稿箱后端配置已就绪。"
          : "微信公众号草稿箱后端还缺少必要配置。",
      missing,
      configuredAccountIds: accountConfigs.map((item) => item.accountId),
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "只支持 GET、POST 和 OPTIONS 请求。" });
  }

  const missing = getMissingConfig();
  if (missing.length > 0) {
    return sendJson(res, 500, {
      error: "微信公众号草稿箱后端还没有配置完整，暂时不能真实同步。",
      missing,
    });
  }

  try {
    const { draft, accountId } = assertWechatDraft(parseBody(req.body));
    const userAccountConfig = req.headers.authorization ? await getUserWechatAccountConfig(req) : undefined;
    const accountConfig =
      userAccountConfig ?? getWechatAccountConfigs().find((item) => item.accountId === accountId || item.appId === accountId);
    if (!accountConfig) {
      throw new Error("当前账号还没有保存微信公众号 AppID、AppSecret 和封面素材，请先到个人中心绑定。");
    }
    if (accountConfig.accountId !== accountId && accountConfig.appId !== accountId) {
      throw new Error("当前绑定目标和后端保存的微信公众号不一致，请刷新个人中心后重试。");
    }
    const accessToken = await getWechatAccessToken(accountConfig);
    const data = await addWechatDraft(accessToken, draft, accountConfig);
    return sendJson(res, 200, {
      ok: true,
      platformId: "wechat",
      state: "success",
      message: `已同步到绑定公众号 ${accountId} 的草稿箱，请到微信公众平台后台继续预览和发布。`,
      accountId,
      draftMediaId: data?.media_id,
      publishedAt: new Date().toISOString(),
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "公众号草稿箱同步失败。";
    return sendJson(res, 400, {
      ok: false,
      platformId: "wechat",
      state: "failed",
      message,
      failureReason: message,
      publishedAt: new Date().toISOString(),
    });
  }
}
