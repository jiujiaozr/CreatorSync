import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";
import type { UserProfile } from "../types";

type ProfileRow = {
  id: string;
  email: string;
  nickname: string | null;
  avatar_url: string | null;
  updated_at: string | null;
};

const profileFromRow = (row: ProfileRow): UserProfile => ({
  id: row.id,
  email: row.email,
  nickname: row.nickname || row.email.split("@")[0] || "创作者",
  avatarUrl: row.avatar_url ?? undefined,
  updatedAt: row.updated_at ?? undefined,
});

export const getCurrentSession = async () => {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    throw error;
  }

  return data.session;
};

export const onAuthSessionChange = (callback: (session: Session | null) => void) => {
  const client = getSupabaseClient();
  if (!client) {
    return () => undefined;
  }

  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
};

export const signInWithEmail = async (email: string, password: string) => {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("请先配置 Supabase 环境变量，才能使用真实登录。");
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }

  return data.session;
};

export const signUpWithEmail = async (email: string, password: string, nickname: string) => {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("请先配置 Supabase 环境变量，才能注册账号。");
  }

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        nickname,
      },
    },
  });

  if (error) {
    throw error;
  }

  if (data.user && data.session) {
    await upsertProfile(data.user.id, data.user.email ?? email, nickname);
  }

  return data.session;
};

export const signOut = async () => {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  const { error } = await client.auth.signOut();
  if (error) {
    throw error;
  }
};

export const getProfile = async (userId: string, email: string): Promise<UserProfile> => {
  const client = getSupabaseClient();
  if (!client) {
    return {
      id: "local-user",
      email,
      nickname: "演示用户",
    };
  }

  const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle<ProfileRow>();
  if (error) {
    throw error;
  }

  if (data) {
    return profileFromRow(data);
  }

  return upsertProfile(userId, email, email.split("@")[0] || "创作者");
};

export const upsertProfile = async (userId: string, email: string, nickname: string) => {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("请先配置 Supabase 环境变量，才能保存个人资料。");
  }

  const { data, error } = await client
    .from("profiles")
    .upsert({
      id: userId,
      email,
      nickname,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single<ProfileRow>();

  if (error) {
    throw error;
  }

  return profileFromRow(data);
};

export const uploadAvatar = async (userId: string, email: string, file: File) => {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("请先配置 Supabase 环境变量，才能上传头像。");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${userId}/avatar.${extension}`;
  const { error: uploadError } = await client.storage.from("avatars").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
  });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = client.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
  const { data: profileRow, error: profileError } = await client
    .from("profiles")
    .upsert({
      id: userId,
      email,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single<ProfileRow>();

  if (profileError) {
    throw profileError;
  }

  return profileFromRow(profileRow);
};

export const isAuthConfigured = () => hasSupabaseConfig;
