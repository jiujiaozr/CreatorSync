import type { PlatformDraft, WechatDraftConfigStatus, WechatDraftSyncResult } from "../types";
import { getSupabaseClient } from "./supabaseClient";

const platformApiBaseUrl = import.meta.env.VITE_AI_API_BASE_URL as string | undefined;

const joinApiUrl = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, "")}${path}`;

const missingBackendStatus: WechatDraftConfigStatus = {
  configured: false,
  message: "还没有配置真实平台后端地址，暂时不能同步公众号草稿箱。",
  missing: ["VITE_AI_API_BASE_URL"],
};

export const isWechatDraftBackendConfigured = () => Boolean(platformApiBaseUrl?.trim());

export const getWechatDraftConfigStatus = async (): Promise<WechatDraftConfigStatus> => {
  const baseUrl = platformApiBaseUrl?.trim();
  if (!baseUrl) {
    return missingBackendStatus;
  }

  const response = await fetch(joinApiUrl(baseUrl, "/api/wechat/draft"), {
    method: "GET",
  });
  const data = (await response.json().catch(() => null)) as WechatDraftConfigStatus | null;

  if (!response.ok) {
    return {
      configured: false,
      message: data?.message || "读取公众号草稿箱配置状态失败，请检查后端代理。",
    };
  }

  return {
    configured: Boolean(data?.configured),
    message: data?.message || "已读取公众号草稿箱配置状态。",
    missing: data?.missing,
    configuredAccountIds: data?.configuredAccountIds,
  };
};

export const syncWechatDraft = async (draft: PlatformDraft, accountId: string): Promise<WechatDraftSyncResult> => {
  const baseUrl = platformApiBaseUrl?.trim();
  if (!baseUrl) {
    throw new Error(missingBackendStatus.message);
  }

  const client = getSupabaseClient();
  const sessionResult = (await client?.auth.getSession()) ?? { data: { session: null } };
  const token = sessionResult.data.session?.access_token;

  const response = await fetch(joinApiUrl(baseUrl, "/api/wechat/draft"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ draft, accountId }),
  });
  const result = (await response.json().catch(() => null)) as Partial<WechatDraftSyncResult> & { error?: string } | null;

  if (!response.ok) {
    throw new Error(result?.error || result?.message || "同步公众号草稿箱失败，请稍后重试。");
  }

  return {
    ok: Boolean(result?.ok),
    platformId: "wechat",
    state: result?.state ?? "success",
    message: result?.message || "公众号草稿箱同步完成。",
    accountId: result?.accountId,
    draftMediaId: result?.draftMediaId,
    failureReason: result?.failureReason,
    publishedAt: result?.publishedAt,
  };
};
