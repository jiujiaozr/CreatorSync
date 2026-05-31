import type { WechatAccountBinding, WechatAccountBindingInput } from "../types";
import { getSupabaseClient } from "./supabaseClient";

const platformApiBaseUrl = import.meta.env.VITE_AI_API_BASE_URL as string | undefined;

const joinApiUrl = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, "")}${path}`;

const getAccessToken = async () => {
  const client = getSupabaseClient();
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("请先登录账号，再绑定微信公众号。");
  }

  return token;
};

const getBackendBaseUrl = () => {
  const baseUrl = platformApiBaseUrl?.trim();
  if (!baseUrl) {
    throw new Error("请先配置 VITE_AI_API_BASE_URL，才能保存微信公众号绑定。");
  }

  return baseUrl;
};

export const getWechatAccountBinding = async (): Promise<WechatAccountBinding | undefined> => {
  const token = await getAccessToken();
  const response = await fetch(joinApiUrl(getBackendBaseUrl(), "/api/wechat/account"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await response.json().catch(() => null)) as { account?: WechatAccountBinding; error?: string } | null;

  if (!response.ok) {
    throw new Error(data?.error || "读取微信公众号绑定失败。");
  }

  return data?.account;
};

export const saveWechatAccountBinding = async (input: WechatAccountBindingInput): Promise<WechatAccountBinding> => {
  const token = await getAccessToken();
  const response = await fetch(joinApiUrl(getBackendBaseUrl(), "/api/wechat/account"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => null)) as { account?: WechatAccountBinding; error?: string } | null;

  if (!response.ok || !data?.account) {
    throw new Error(data?.error || "保存微信公众号绑定失败。");
  }

  return data.account;
};

export const deleteWechatAccountBinding = async () => {
  const token = await getAccessToken();
  const response = await fetch(joinApiUrl(getBackendBaseUrl(), "/api/wechat/account"), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(data?.error || "取消微信公众号绑定失败。");
  }
};
