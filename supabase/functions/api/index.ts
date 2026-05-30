type PlatformId = "wechat" | "zhihu" | "bilibili" | "xiaohongshu";

type SourceContent = {
  title: string;
  body: string;
  contentType?: string;
  audience?: string;
  preference?: string;
};

type PlatformDraft = {
  platformId: PlatformId;
  platformName?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  meta?: Record<string, string>;
};

const platformDefinitions: Record<PlatformId, { name: string; metaFields: string[] }> = {
  wechat: {
    name: "微信公众号",
    metaFields: ["summary", "ending"],
  },
  zhihu: {
    name: "知乎",
    metaFields: ["question", "conclusion"],
  },
  bilibili: {
    name: "B站",
    metaFields: ["category", "scriptOutline"],
  },
  xiaohongshu: {
    name: "小红书",
    metaFields: ["coverTitle", "hook"],
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const sendJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const wechatEnvKeys = ["WECHAT_APP_ID", "WECHAT_APP_SECRET", "WECHAT_DEFAULT_THUMB_MEDIA_ID"] as const;

const getMissingWechatConfig = () => wechatEnvKeys.filter((key) => !Deno.env.get(key));

const htmlEscape = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const bodyToWechatHtml = (body: unknown) =>
  String(body ?? "")
    .split(/\n{2,}|\r\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${htmlEscape(paragraph).replace(/\n/g, "<br/>")}</p>`)
    .join("");

const assertWechatDraft = (payload: { draft?: PlatformDraft }) => {
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
  const appId = Deno.env.get("WECHAT_APP_ID") || "";
  const appSecret = Deno.env.get("WECHAT_APP_SECRET") || "";
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

  return data.access_token as string;
};

const addWechatDraft = async (accessToken: string, draft: PlatformDraft) => {
  const digest = String(draft.meta?.summary || draft.subtitle || "")
    .trim()
    .slice(0, 120);
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      articles: [
        {
          title: String(draft.title).trim().slice(0, 64),
          author: Deno.env.get("WECHAT_DEFAULT_AUTHOR") || "CreatorSync",
          digest,
          content: bodyToWechatHtml(draft.body),
          content_source_url: "",
          thumb_media_id: Deno.env.get("WECHAT_DEFAULT_THUMB_MEDIA_ID"),
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

  return data as { media_id?: string };
};

const handleWechatDraft = async (request: Request) => {
  if (request.method === "GET") {
    const missing = getMissingWechatConfig();
    return sendJson({
      configured: missing.length === 0,
      message: missing.length === 0 ? "微信公众号草稿箱后端配置已就绪。" : "微信公众号草稿箱后端还缺少必要配置。",
      missing,
    });
  }

  if (request.method !== "POST") {
    return sendJson({ error: "只支持 GET、POST 和 OPTIONS 请求。" }, 405);
  }

  const missing = getMissingWechatConfig();
  if (missing.length > 0) {
    return sendJson(
      {
        error: "微信公众号草稿箱后端还没有配置完整，暂时不能真实同步。",
        missing,
      },
      500,
    );
  }

  try {
    const draft = assertWechatDraft(await request.json());
    const accessToken = await getWechatAccessToken();
    const data = await addWechatDraft(accessToken, draft);
    return sendJson({
      ok: true,
      platformId: "wechat",
      state: "success",
      message: "已同步到微信公众号草稿箱，请到微信公众平台后台继续预览和发布。",
      draftMediaId: data.media_id,
      publishedAt: new Date().toISOString(),
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "公众号草稿箱同步失败。";
    return sendJson(
      {
        ok: false,
        platformId: "wechat",
        state: "failed",
        message,
        failureReason: message,
        publishedAt: new Date().toISOString(),
      },
      400,
    );
  }
};

const assertRequest = (payload: { source?: SourceContent; platformIds?: PlatformId[] }) => {
  const source = payload.source;
  const platformIds = payload.platformIds;

  if (!source || typeof source !== "object") {
    throw new Error("请求缺少原始内容。");
  }

  if (!source.title?.trim() || !source.body?.trim()) {
    throw new Error("标题和正文不能为空。");
  }

  if (!Array.isArray(platformIds) || platformIds.length === 0) {
    throw new Error("请至少选择一个平台。");
  }

  const unknownPlatform = platformIds.find((platformId) => !platformDefinitions[platformId]);
  if (unknownPlatform) {
    throw new Error(`暂不支持的平台：${unknownPlatform}`);
  }

  return { source, platformIds };
};

const buildPrompt = (source: SourceContent, platformIds: PlatformId[]) => {
  const platforms = platformIds.map((platformId) => ({
    id: platformId,
    name: platformDefinitions[platformId].name,
    metaFields: platformDefinitions[platformId].metaFields,
  }));

  return [
    "请把用户的一份原始内容改写成多平台发布草稿。",
    "必须严格围绕原始标题和原始正文，不允许改成无关主题，不允许编造与原文无关的案例。",
    "如果原文讨论的是内容开发助手、多平台发布、平台适配，就必须保留这些核心概念。",
    "只返回 JSON，不要返回 Markdown，不要解释。",
    'JSON 结构必须是：{"drafts":[{"platformId":"wechat","title":"","subtitle":"","body":"","tags":[""],"meta":{}}]}。',
    "每个草稿的 title、subtitle、body 必须是中文字符串；tags 是中文字符串数组；meta 必须包含该平台要求的字段。",
    "每个平台草稿都要根据平台特点改写表达方式，但不能改变原文主题。",
    `目标平台：${JSON.stringify(platforms)}`,
    `原始内容 JSON：${JSON.stringify({
      title: source.title,
      body: source.body,
      contentType: source.contentType ?? "知识分享",
      audience: source.audience ?? "内容创作者",
      preference: source.preference ?? "平衡清晰",
    })}`,
  ].join("\n");
};

const parseAiJson = (content?: string) => {
  if (!content) {
    throw new Error("DeepSeek 没有返回内容。");
  }

  const trimmed = content.trim();
  const jsonText = trimmed.startsWith("```") ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim() : trimmed;
  return JSON.parse(jsonText);
};

const normalizeDrafts = (drafts: unknown, platformIds: PlatformId[]) => {
  if (!Array.isArray(drafts)) {
    throw new Error("DeepSeek 返回格式不正确：缺少 drafts 数组。");
  }

  const now = Date.now();
  return platformIds.map((platformId, index) => {
    const sourceDraft =
      drafts.find((draft) => typeof draft === "object" && draft !== null && (draft as { platformId?: unknown }).platformId === platformId) ??
      drafts[index];
    const definition = platformDefinitions[platformId];

    if (!sourceDraft || typeof sourceDraft !== "object") {
      throw new Error(`DeepSeek 未返回 ${definition.name} 的草稿。`);
    }

    const draftRecord = sourceDraft as {
      title?: unknown;
      subtitle?: unknown;
      body?: unknown;
      tags?: unknown;
      meta?: Record<string, unknown>;
    };
    const meta = definition.metaFields.reduce<Record<string, string>>((acc, field) => {
      acc[field] = String(draftRecord.meta?.[field] ?? "");
      return acc;
    }, {});

    return {
      id: `${platformId}-deepseek-${now}`,
      platformId,
      platformName: definition.name,
      title: String(draftRecord.title ?? "").trim(),
      subtitle: String(draftRecord.subtitle ?? "").trim(),
      body: String(draftRecord.body ?? "").trim(),
      tags: Array.isArray(draftRecord.tags) ? draftRecord.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean) : [],
      meta,
    };
  });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith("/api/wechat/draft")) {
    return handleWechatDraft(request);
  }

  if (request.method !== "POST") {
    return sendJson({ error: "只支持 POST 请求。" }, 405);
  }

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) {
    return sendJson({ error: "真实 AI 后端未配置 DEEPSEEK_API_KEY。" }, 500);
  }

  try {
    const { source, platformIds } = assertRequest(await request.json());
    const model = Deno.env.get("DEEPSEEK_MODEL") || "deepseek-chat";
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "你是内容开发助手，擅长把一份原始内容改写成适合不同平台发布的中文草稿。",
          },
          {
            role: "user",
            content: buildPrompt(source, platformIds),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.35,
        max_tokens: 3500,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
      return sendJson({ error: `DeepSeek 调用失败：${detail}` }, response.status);
    }

    const content = data?.choices?.[0]?.message?.content;
    const parsed = parseAiJson(content);
    const drafts = normalizeDrafts(parsed.drafts, platformIds);
    return sendJson({ drafts, provider: "DeepSeek" });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "真实 AI 生成失败。";
    return sendJson({ error: message }, 400);
  }
});
