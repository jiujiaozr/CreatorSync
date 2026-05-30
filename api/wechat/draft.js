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

const getMissingConfig = () => requiredEnvKeys.filter((key) => !process.env[key]);

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
  if (!draft || typeof draft !== "object" || draft.platformId !== "wechat") {
    throw new Error("请先选择微信公众号草稿，再同步到公众号草稿箱。");
  }

  if (!String(draft.title ?? "").trim()) {
    throw new Error("公众号标题不能为空。");
  }

  if (!String(draft.body ?? "").trim()) {
    throw new Error("公众号正文不能为空。");
  }

  return draft;
};

const getWechatAccessToken = async () => {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);

  const response = await fetch(url);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    const detail = data?.errmsg || `HTTP ${response.status}`;
    throw new Error(`微信 access_token 获取失败：${detail}`);
  }

  return data.access_token;
};

const addWechatDraft = async (accessToken, draft) => {
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
          author: process.env.WECHAT_DEFAULT_AUTHOR || "CreatorSync",
          digest,
          content,
          content_source_url: "",
          thumb_media_id: process.env.WECHAT_DEFAULT_THUMB_MEDIA_ID,
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
    return sendJson(res, 200, {
      configured: missing.length === 0,
      message:
        missing.length === 0
          ? "微信公众号草稿箱后端配置已就绪。"
          : "微信公众号草稿箱后端还缺少必要配置。",
      missing,
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
    const draft = assertWechatDraft(parseBody(req.body));
    const accessToken = await getWechatAccessToken();
    const data = await addWechatDraft(accessToken, draft);
    return sendJson(res, 200, {
      ok: true,
      platformId: "wechat",
      state: "success",
      message: "已同步到微信公众号草稿箱，请到微信公众平台后台继续预览和发布。",
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
