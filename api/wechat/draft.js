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
  if (process.env.WECHAT_ACCOUNT_CONFIGS) {
    return getWechatAccountConfigs().length > 0 ? [] : ["WECHAT_ACCOUNT_CONFIGS"];
  }

  return requiredEnvKeys.filter((key) => !process.env[key]);
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

  const accountConfig = getWechatAccountConfigs().find((item) => item.accountId === accountId || item.appId === accountId);
  if (!accountConfig) {
    throw new Error("当前绑定的公众号 ID 没有对应的后端密钥配置，请检查 WECHAT_ACCOUNT_CONFIGS 或 WECHAT_APP_ID。");
  }

  if (!String(draft.title ?? "").trim()) {
    throw new Error("公众号标题不能为空。");
  }

  if (!String(draft.body ?? "").trim()) {
    throw new Error("公众号正文不能为空。");
  }

  return { draft, accountId, accountConfig };
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
    const { draft, accountId, accountConfig } = assertWechatDraft(parseBody(req.body));
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
