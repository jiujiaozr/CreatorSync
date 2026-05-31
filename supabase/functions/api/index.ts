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
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

type WechatAccountConfig = {
  accountId: string;
  appId: string;
  appSecret: string;
  thumbMediaId: string;
  author: string;
};

type WechatAccountRow = {
  user_id: string;
  account_id: string;
  app_id: string;
  app_secret_ciphertext: string;
  thumb_media_id: string;
  author: string | null;
  updated_at: string;
};

const normalizeWechatAccountConfig = (item: Record<string, unknown>): WechatAccountConfig | undefined => {
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
    author: String(item.author || Deno.env.get("WECHAT_DEFAULT_AUTHOR") || "CreatorSync").trim(),
  };
};

const getWechatAccountConfigs = (): WechatAccountConfig[] => {
  const rawConfigs = Deno.env.get("WECHAT_ACCOUNT_CONFIGS");
  if (rawConfigs) {
    try {
      const parsed = JSON.parse(rawConfigs) as unknown;
      const sourceList = Array.isArray(parsed)
        ? parsed
        : Object.entries(parsed as Record<string, Record<string, unknown>>).map(([accountId, value]) => ({
            accountId,
            ...value,
          }));
      return sourceList
        .map((item) => normalizeWechatAccountConfig(item as Record<string, unknown>))
        .filter((item): item is WechatAccountConfig => Boolean(item));
    } catch {
      return [];
    }
  }

  const singleAccount = normalizeWechatAccountConfig({
    accountId: Deno.env.get("WECHAT_APP_ID"),
    appId: Deno.env.get("WECHAT_APP_ID"),
    appSecret: Deno.env.get("WECHAT_APP_SECRET"),
    thumbMediaId: Deno.env.get("WECHAT_DEFAULT_THUMB_MEDIA_ID"),
    author: Deno.env.get("WECHAT_DEFAULT_AUTHOR"),
  });

  return singleAccount ? [singleAccount] : [];
};

const getMissingWechatConfig = () => {
  const missingBackend = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WECHAT_SECRET_ENCRYPTION_KEY"].filter(
    (key) => !Deno.env.get(key),
  );
  if (missingBackend.length > 0) {
    return missingBackend;
  }

  if (Deno.env.get("WECHAT_ACCOUNT_CONFIGS")) {
    return getWechatAccountConfigs().length > 0 ? [] : ["WECHAT_ACCOUNT_CONFIGS"];
  }

  const hasSingleProjectAccount = wechatEnvKeys.every((key) => Deno.env.get(key));
  return hasSingleProjectAccount ? [] : [];
};

const getSupabaseEnv = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("后端缺少 Supabase 服务端配置，暂时不能保存微信公众号绑定。");
  }

  return { url, serviceRoleKey };
};

const getBearerToken = (request: Request) => {
  const value = request.headers.get("Authorization") ?? "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new Error("请先登录账号，再操作微信公众号绑定。");
  }

  return match[1];
};

const getCurrentUserId = async (request: Request) => {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${getBearerToken(request)}`,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) {
    throw new Error("登录状态已失效，请重新登录后再操作微信公众号绑定。");
  }

  return String(data.id);
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const getWechatSecretCryptoKey = async () => {
  const secret = Deno.env.get("WECHAT_SECRET_ENCRYPTION_KEY");
  if (!secret || secret.length < 16) {
    throw new Error("后端缺少 WECHAT_SECRET_ENCRYPTION_KEY，暂时不能安全保存 AppSecret。");
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const encryptWechatSecret = async (value: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getWechatSecretCryptoKey();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
};

const decryptWechatSecret = async (value: string) => {
  const [ivText, encryptedText] = value.split(".");
  if (!ivText || !encryptedText) {
    throw new Error("微信公众号 AppSecret 保存格式不正确，请重新绑定。");
  }

  const key = await getWechatSecretCryptoKey();
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivText) }, key, fromBase64(encryptedText));
  return new TextDecoder().decode(decrypted);
};

const requestWechatAccountRow = async (userId: string): Promise<WechatAccountRow | undefined> => {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const response = await fetch(`${url}/rest/v1/wechat_accounts?user_id=eq.${userId}&select=*`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const rows = (await response.json().catch(() => [])) as WechatAccountRow[];
  if (!response.ok) {
    throw new Error("读取微信公众号绑定失败，请检查 wechat_accounts 数据表。");
  }

  return rows[0];
};

const rowToWechatAccount = (row?: WechatAccountRow) =>
  row
    ? {
        configured: true,
        accountId: row.account_id,
        appId: row.app_id,
        thumbMediaId: row.thumb_media_id,
        author: row.author ?? undefined,
        updatedAt: row.updated_at,
      }
    : undefined;

const getUserWechatAccountConfig = async (request: Request): Promise<WechatAccountConfig | undefined> => {
  const userId = await getCurrentUserId(request);
  const row = await requestWechatAccountRow(userId);
  if (!row) {
    return undefined;
  }

  return {
    accountId: row.account_id,
    appId: row.app_id,
    appSecret: await decryptWechatSecret(row.app_secret_ciphertext),
    thumbMediaId: row.thumb_media_id,
    author: row.author || "CreatorSync",
  };
};

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

const assertWechatDraft = (payload: { draft?: PlatformDraft; accountId?: string }) => {
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

const getWechatAccessToken = async (accountConfig: WechatAccountConfig) => {
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

  return data.access_token as string;
};

const addWechatDraft = async (accessToken: string, draft: PlatformDraft, accountConfig: WechatAccountConfig) => {
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
          author: accountConfig.author || "CreatorSync",
          digest,
          content: bodyToWechatHtml(draft.body),
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

  return data as { media_id?: string };
};

const handleWechatDraft = async (request: Request) => {
  if (request.method === "GET") {
    const missing = getMissingWechatConfig();
    const accountConfigs = getWechatAccountConfigs();
    let userAccount = undefined;
    try {
      if (request.headers.get("Authorization")) {
        const userId = await getCurrentUserId(request);
        userAccount = rowToWechatAccount(await requestWechatAccountRow(userId));
      }
    } catch {
      userAccount = undefined;
    }
    return sendJson({
      configured: missing.length === 0,
      message: missing.length === 0 ? "微信公众号草稿箱后端配置已就绪。" : "微信公众号草稿箱后端还缺少必要配置。",
      missing,
      configuredAccountIds: accountConfigs.map((item) => item.accountId),
      userAccount,
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
    const { draft, accountId } = assertWechatDraft(await request.json());
    const userAccountConfig = request.headers.get("Authorization") ? await getUserWechatAccountConfig(request) : undefined;
    const accountConfig =
      userAccountConfig ??
      getWechatAccountConfigs().find((item) => item.accountId === accountId || item.appId === accountId);
    if (!accountConfig) {
      throw new Error("当前账号还没有保存微信公众号 AppID、AppSecret 和封面素材，请先到个人中心绑定。");
    }
    if (accountConfig.accountId !== accountId && accountConfig.appId !== accountId) {
      throw new Error("当前绑定目标和后端保存的微信公众号不一致，请刷新个人中心后重试。");
    }
    const accessToken = await getWechatAccessToken(accountConfig);
    const data = await addWechatDraft(accessToken, draft, accountConfig);
    return sendJson({
      ok: true,
      platformId: "wechat",
      state: "success",
      message: `已同步到绑定公众号 ${accountId} 的草稿箱，请到微信公众平台后台继续预览和发布。`,
      accountId,
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

const handleWechatAccount = async (request: Request) => {
  try {
    const userId = await getCurrentUserId(request);

    if (request.method === "GET") {
      return sendJson({ account: rowToWechatAccount(await requestWechatAccountRow(userId)) });
    }

    if (request.method === "DELETE") {
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

      return sendJson({ ok: true });
    }

    if (request.method !== "POST") {
      return sendJson({ error: "只支持 GET、POST、DELETE 和 OPTIONS 请求。" }, 405);
    }

    const payload = (await request.json()) as {
      accountId?: string;
      appId?: string;
      appSecret?: string;
      thumbMediaId?: string;
      author?: string;
    };
    const accountId = String(payload.accountId ?? "").trim();
    const appId = String(payload.appId ?? "").trim();
    const appSecret = String(payload.appSecret ?? "").trim();
    const thumbMediaId = String(payload.thumbMediaId ?? "").trim();
    const author = String(payload.author ?? "CreatorSync").trim() || "CreatorSync";
    if (!accountId || !appId || !thumbMediaId) {
      throw new Error("请填写公众号 ID、AppID 和默认封面 media_id。");
    }

    const existing = await requestWechatAccountRow(userId);
    if (!existing && !appSecret) {
      throw new Error("首次绑定微信公众号时需要填写 AppSecret。");
    }

    const appSecretCiphertext = appSecret ? await encryptWechatSecret(appSecret) : existing?.app_secret_ciphertext;
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
        app_secret_ciphertext: appSecretCiphertext,
        thumb_media_id: thumbMediaId,
        author,
        updated_at: new Date().toISOString(),
      }),
    });
    const rows = (await response.json().catch(() => [])) as WechatAccountRow[];
    if (!response.ok || !rows[0]) {
      throw new Error("保存微信公众号绑定失败，请检查 wechat_accounts 数据表。");
    }

    return sendJson({ account: rowToWechatAccount(rows[0]) });
  } catch (caught) {
    return sendJson({ error: caught instanceof Error ? caught.message : "微信公众号绑定操作失败。" }, 400);
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
  if (pathname.endsWith("/api/wechat/account")) {
    return handleWechatAccount(request);
  }

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
