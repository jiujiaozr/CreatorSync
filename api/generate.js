const platformDefinitions = {
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

const assertRequest = (payload) => {
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

const buildPrompt = (source, platformIds) => {
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
    "JSON 结构必须是：{\"drafts\":[{\"platformId\":\"wechat\",\"title\":\"\",\"subtitle\":\"\",\"body\":\"\",\"tags\":[\"\"],\"meta\":{}}]}。",
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

const parseAiJson = (content) => {
  if (!content) {
    throw new Error("DeepSeek 没有返回内容。");
  }

  const trimmed = content.trim();
  const jsonText = trimmed.startsWith("```") ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim() : trimmed;
  return JSON.parse(jsonText);
};

const normalizeDrafts = (drafts, platformIds) => {
  if (!Array.isArray(drafts)) {
    throw new Error("DeepSeek 返回格式不正确：缺少 drafts 数组。");
  }

  const now = Date.now();
  return platformIds.map((platformId, index) => {
    const sourceDraft = drafts.find((draft) => draft?.platformId === platformId) ?? drafts[index];
    const definition = platformDefinitions[platformId];

    if (!sourceDraft || typeof sourceDraft !== "object") {
      throw new Error(`DeepSeek 未返回 ${definition.name} 的草稿。`);
    }

    const meta = definition.metaFields.reduce((acc, field) => {
      acc[field] = String(sourceDraft.meta?.[field] ?? "");
      return acc;
    }, {});

    return {
      id: `${platformId}-deepseek-${now}`,
      platformId,
      platformName: definition.name,
      title: String(sourceDraft.title ?? "").trim(),
      subtitle: String(sourceDraft.subtitle ?? "").trim(),
      body: String(sourceDraft.body ?? "").trim(),
      tags: Array.isArray(sourceDraft.tags) ? sourceDraft.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      meta,
    };
  });
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "只支持 POST 请求。" });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, { error: "真实 AI 后端未配置 DEEPSEEK_API_KEY。" });
  }

  try {
    const { source, platformIds } = assertRequest(parseBody(req.body));
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
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
      return sendJson(res, response.status, { error: `DeepSeek 调用失败：${detail}` });
    }

    const content = data?.choices?.[0]?.message?.content;
    const parsed = parseAiJson(content);
    const drafts = normalizeDrafts(parsed.drafts, platformIds);
    return sendJson(res, 200, { drafts, provider: "DeepSeek" });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "真实 AI 生成失败。";
    return sendJson(res, 400, { error: message });
  }
}
