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

export type ValidationIssue = {
  platformId: PlatformId;
  platformName: string;
  field: string;
  message: string;
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
