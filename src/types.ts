export type PlatformId = "wechat" | "zhihu" | "bilibili" | "xiaohongshu";

export type ContentType = "知识分享" | "产品介绍" | "活动宣传" | "经验复盘";

export type TonePreference = "平衡清晰" | "更正式" | "更口语" | "更有传播感";

export type SourceContent = {
  title: string;
  body: string;
  contentType: ContentType;
  audience: string;
  preference: TonePreference;
};

export type PlatformMetaField = {
  key: string;
  label: string;
  placeholder: string;
};

export type PlatformDraft = {
  id: string;
  platformId: PlatformId;
  platformName: string;
  title: string;
  subtitle: string;
  body: string;
  tags: string[];
  meta: Record<string, string>;
};

export type ValidationResult = {
  ok: boolean;
  message?: string;
};

export type PublishState = "idle" | "pending" | "publishing" | "success" | "failed";

export type PublishResult = {
  platformId: PlatformId;
  state: PublishState;
  message: string;
  publishedAt?: string;
  failureReason?: string;
};

export type IntegrationCapability = {
  id: string;
  title: string;
  owner: "前端" | "后端" | "前后端协作";
  status: "已预留" | "需要后端" | "存在限制";
  description: string;
};

export type PlatformIntegrationProfile = {
  platformId: PlatformId;
  platformName: string;
  authStatus: "未授权" | "需要企业/创作者认证" | "适合后续试点" | "草稿同步试点";
  requiredPermissions: string[];
  apiDifficulty: "低" | "中" | "高";
  limitations: string[];
  publishEntryUrl: string;
  nextStep: string;
};

export type PlatformAccountConnection = {
  platformId: PlatformId;
  platformName: string;
  status: "已绑定" | "待绑定" | "待配置" | "待接入";
  capability: string;
  requirements: string[];
  actionLabel: string;
  enabled: boolean;
  note: string;
  boundAccountId?: string;
};

export type ValidationIssue = {
  platformId: PlatformId;
  platformName: string;
  field: string;
  message: string;
};

export type PublishChecklistItem = {
  platformId: PlatformId;
  platformName: string;
  label: string;
  status: "通过" | "待处理";
  detail: string;
};

export type WechatDraftSyncResult = {
  ok: boolean;
  platformId: "wechat";
  state: PublishState;
  message: string;
  accountId?: string;
  draftMediaId?: string;
  failureReason?: string;
  publishedAt?: string;
};

export type WechatDraftConfigStatus = {
  configured: boolean;
  message: string;
  missing?: string[];
  configuredAccountIds?: string[];
};

export type PublishAttempt = {
  id: string;
  platformId: PlatformId;
  platformName: string;
  state: PublishState;
  message: string;
  retryCount: number;
  createdAt: string;
  failureReason?: string;
};

export type PlatformAdapter = {
  id: PlatformId;
  name: string;
  shortName: string;
  description: string;
  accent: string;
  metaFields: PlatformMetaField[];
  generate: (input: SourceContent) => PlatformDraft;
  validate: (draft: PlatformDraft) => ValidationResult;
};

export type ContentGenerationProvider = {
  name: string;
  generateDrafts: (input: SourceContent, platformIds: PlatformId[]) => Promise<PlatformDraft[]>;
};

export type SavedContentRecord = {
  id: string;
  userId?: string;
  source: SourceContent;
  selectedPlatforms: PlatformId[];
  drafts: PlatformDraft[];
  publishAttempts: PublishAttempt[];
  createdAt: string;
  updatedAt: string;
};

export type ContentRecordInput = {
  id?: string;
  userId?: string;
  source: SourceContent;
  selectedPlatforms: PlatformId[];
  drafts: PlatformDraft[];
  publishAttempts: PublishAttempt[];
};

export type PersistenceMode = "supabase" | "local";

export type PersistResult = {
  record: SavedContentRecord;
  mode: PersistenceMode;
};

export type UserProfile = {
  id: string;
  email: string;
  nickname: string;
  avatarUrl?: string;
  updatedAt?: string;
};
