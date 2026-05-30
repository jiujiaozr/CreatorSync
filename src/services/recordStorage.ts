import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";
import type {
  ContentRecordInput,
  PersistResult,
  PersistenceMode,
  PlatformDraft,
  PublishAttempt,
  SavedContentRecord,
  SourceContent,
} from "../types";

const localStorageKey = "creatorsync.contentRecords.v1";

const nowText = () => new Date().toISOString();

const toRecordSummary = (record: SavedContentRecord) => ({
  id: record.id,
  source: record.source,
  selectedPlatforms: record.selectedPlatforms,
  drafts: record.drafts,
  publishAttempts: record.publishAttempts,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const readLocalRecords = (): SavedContentRecord[] => {
  try {
    const raw = window.localStorage.getItem(localStorageKey);
    return raw ? (JSON.parse(raw) as SavedContentRecord[]) : [];
  } catch {
    return [];
  }
};

const writeLocalRecords = (records: SavedContentRecord[]) => {
  window.localStorage.setItem(localStorageKey, JSON.stringify(records.map(toRecordSummary)));
};

const saveLocalRecord = (input: ContentRecordInput): PersistResult => {
  const records = readLocalRecords();
  const existing = input.id ? records.find((record) => record.id === input.id) : undefined;
  const timestamp = nowText();
  const record: SavedContentRecord = {
    id: existing?.id ?? input.id ?? `local-${Date.now()}`,
    source: input.source,
    selectedPlatforms: input.selectedPlatforms,
    drafts: input.drafts,
    publishAttempts: input.publishAttempts,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  const nextRecords = [record, ...records.filter((item) => item.id !== record.id)];
  writeLocalRecords(nextRecords);

  return { record, mode: "local" };
};

const fromSupabaseRows = (
  contentRow: SupabaseContentRow,
  draftRows: SupabaseDraftRow[],
  publishRows: SupabasePublishRow[],
): SavedContentRecord => ({
  id: contentRow.id,
  userId: contentRow.user_id,
  source: {
    title: contentRow.title,
    body: contentRow.body,
    contentType: contentRow.content_type as SourceContent["contentType"],
    audience: contentRow.audience,
    preference: contentRow.preference as SourceContent["preference"],
  },
  selectedPlatforms: contentRow.selected_platforms,
  drafts: draftRows.map((row) => ({
    id: row.id,
    platformId: row.platform_id,
    platformName: row.platform_name,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    tags: row.tags,
    meta: row.meta,
  })),
  publishAttempts: publishRows.map((row) => ({
    id: row.id,
    platformId: row.platform_id,
    platformName: row.platform_name,
    state: row.state,
    message: row.message,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    failureReason: row.failure_reason ?? undefined,
  })),
  createdAt: contentRow.created_at,
  updatedAt: contentRow.updated_at,
});

type SupabaseContentRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  content_type: string;
  audience: string;
  preference: string;
  selected_platforms: SavedContentRecord["selectedPlatforms"];
  created_at: string;
  updated_at: string;
};

type SupabaseDraftRow = {
  id: string;
  content_record_id: string;
  platform_id: PlatformDraft["platformId"];
  platform_name: string;
  title: string;
  subtitle: string;
  body: string;
  tags: string[];
  meta: Record<string, string>;
  updated_at: string;
};

type SupabasePublishRow = {
  id: string;
  content_record_id: string;
  platform_id: PublishAttempt["platformId"];
  platform_name: string;
  state: PublishAttempt["state"];
  message: string;
  retry_count: number;
  failure_reason: string | null;
  created_at: string;
};

const saveSupabaseRecord = async (client: SupabaseClient, input: ContentRecordInput): Promise<PersistResult> => {
  if (!input.userId) {
    throw new Error("请先登录账号，再保存内容方案。");
  }

  const timestamp = nowText();
  const contentPayload = {
    ...(input.id ? { id: input.id } : {}),
    user_id: input.userId,
    title: input.source.title,
    body: input.source.body,
    content_type: input.source.contentType,
    audience: input.source.audience,
    preference: input.source.preference,
    selected_platforms: input.selectedPlatforms,
    updated_at: timestamp,
  };

  const { data: contentRow, error: contentError } = await client
    .from("content_records")
    .upsert(contentPayload)
    .select("*")
    .single<SupabaseContentRow>();

  if (contentError) {
    throw contentError;
  }

  const recordId = contentRow.id;

  await client.from("platform_drafts").delete().eq("content_record_id", recordId);
  await client.from("publish_records").delete().eq("content_record_id", recordId);

  if (input.drafts.length > 0) {
    const { error: draftError } = await client.from("platform_drafts").insert(
      input.drafts.map((draft) => ({
        content_record_id: recordId,
        platform_id: draft.platformId,
        platform_name: draft.platformName,
        title: draft.title,
        subtitle: draft.subtitle,
        body: draft.body,
        tags: draft.tags,
        meta: draft.meta,
      })),
    );

    if (draftError) {
      throw draftError;
    }
  }

  if (input.publishAttempts.length > 0) {
    const { error: publishError } = await client.from("publish_records").insert(
      input.publishAttempts.map((attempt) => ({
        content_record_id: recordId,
        platform_id: attempt.platformId,
        platform_name: attempt.platformName,
        state: attempt.state,
        message: attempt.message,
        retry_count: attempt.retryCount,
        failure_reason: attempt.failureReason ?? null,
        created_at: attempt.createdAt,
      })),
    );

    if (publishError) {
      throw publishError;
    }
  }

  const record = await getSupabaseRecord(client, recordId);
  return { record, mode: "supabase" };
};

const getSupabaseRecord = async (client: SupabaseClient, recordId: string): Promise<SavedContentRecord> => {
  const { data: contentRow, error: contentError } = await client
    .from("content_records")
    .select("*")
    .eq("id", recordId)
    .single<SupabaseContentRow>();

  if (contentError) {
    throw contentError;
  }

  const [{ data: draftRows, error: draftError }, { data: publishRows, error: publishError }] = await Promise.all([
    client.from("platform_drafts").select("*").eq("content_record_id", recordId).returns<SupabaseDraftRow[]>(),
    client
      .from("publish_records")
      .select("*")
      .eq("content_record_id", recordId)
      .order("created_at", { ascending: false })
      .returns<SupabasePublishRow[]>(),
  ]);

  if (draftError) {
    throw draftError;
  }

  if (publishError) {
    throw publishError;
  }

  return fromSupabaseRows(contentRow, draftRows ?? [], publishRows ?? []);
};

export const getPersistenceMode = (): PersistenceMode => (hasSupabaseConfig ? "supabase" : "local");

export const listContentRecords = async (userId?: string): Promise<SavedContentRecord[]> => {
  const client = getSupabaseClient();

  if (!client) {
    return readLocalRecords();
  }

  if (!userId) {
    return [];
  }

  const { data: contentRows, error } = await client
    .from("content_records")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .returns<SupabaseContentRow[]>();

  if (error) {
    throw error;
  }

  const records = await Promise.all((contentRows ?? []).map((row) => getSupabaseRecord(client, row.id)));
  return records;
};

export const getContentRecord = async (recordId: string): Promise<SavedContentRecord | undefined> => {
  const client = getSupabaseClient();

  if (!client) {
    return readLocalRecords().find((record) => record.id === recordId);
  }

  return getSupabaseRecord(client, recordId);
};

export const saveContentRecord = async (input: ContentRecordInput): Promise<PersistResult> => {
  const client = getSupabaseClient();

  if (!client) {
    return saveLocalRecord(input);
  }

  return saveSupabaseRecord(client, input);
};
