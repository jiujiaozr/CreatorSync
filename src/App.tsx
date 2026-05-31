import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  FileText,
  History,
  Home,
  KeyRound,
  Lightbulb,
  ListChecks,
  Loader2,
  Megaphone,
  MessageCircle,
  PenLine,
  PlugZap,
  RefreshCcw,
  RotateCcw,
  Save,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  UploadCloud,
  UserCircle,
  XCircle,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { adapterById, platformAdapters } from "./data/platformAdapters";
import {
  getCurrentSession,
  getProfile,
  isAuthConfigured,
  onAuthSessionChange,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  uploadAvatar,
  upsertProfile,
} from "./services/auth";
import {
  isRealApiGenerationConfigured,
  mockGenerationProvider,
  realApiGenerationProvider,
} from "./services/contentGeneration";
import { simulatePublish } from "./services/publish";
import { getContentRecord, getPersistenceMode, listContentRecords, saveContentRecord } from "./services/recordStorage";
import { getWechatDraftConfigStatus, syncWechatDraft } from "./services/wechatDraft";
import type {
  ContentType,
  IntegrationCapability,
  PersistenceMode,
  PlatformAccountConnection,
  PlatformDraft,
  PlatformIntegrationProfile,
  PlatformId,
  PublishChecklistItem,
  PublishAttempt,
  PublishResult,
  PublishState,
  SavedContentRecord,
  SourceContent,
  TonePreference,
  UserProfile,
  ValidationIssue,
  WechatDraftConfigStatus,
} from "./types";

const contentTypes: ContentType[] = ["知识分享", "产品介绍", "活动宣传", "经验复盘"];
const preferences: TonePreference[] = ["平衡清晰", "更正式", "更口语", "更有传播感"];
type AppView = "workspace" | "records" | "integrations" | "profile";
type GenerationMode = "mock" | "deepseek";

const generationModeLabel: Record<GenerationMode, string> = {
  mock: "Mock AI",
  deepseek: "DeepSeek",
};

const navItems: Array<{ id: AppView; label: string; icon: typeof Home }> = [
  { id: "workspace", label: "工作台", icon: Home },
  { id: "records", label: "发布记录", icon: History },
  { id: "integrations", label: "接入预研", icon: PlugZap },
  { id: "profile", label: "个人中心", icon: UserCircle },
];

const defaultSource: SourceContent = {
  title: "如何把一篇内容高效发布到多个平台",
  body: "创作者经常需要把同一份内容发布到公众号、知乎、B站、小红书等平台。\n不同平台的标题、正文结构、标签和表达方式都不一样，手动改写很容易耗时。\n如果能先生成平台版本，再统一编辑和预览，就能明显提高发布效率。",
  contentType: "知识分享",
  audience: "内容创作者",
  preference: "平衡清晰",
};

const initialPlatformIds = platformAdapters.map((adapter) => adapter.id);

const integrationCapabilities: IntegrationCapability[] = [
  {
    id: "real-ai",
    title: "真实 AI 生成",
    owner: "后端",
    status: "需要后端",
    description: "真实模型 Key 不能放在浏览器里，后端负责保管密钥、调用模型和处理错误。",
  },
  {
    id: "oauth",
    title: "平台 OAuth 授权",
    owner: "前后端协作",
    status: "存在限制",
    description: "公众号、知乎、B站、小红书的授权规则不同，通常需要后端处理回调和令牌刷新。",
  },
  {
    id: "publish-api",
    title: "真实发布 API",
    owner: "后端",
    status: "存在限制",
    description: "真实发布会受到平台审核、字段格式、频率限制影响，第六次迭代先展示限制、清单和人工发布流程。",
  },
  {
    id: "frontend-state",
    title: "前端可保留能力",
    owner: "前端",
    status: "已预留",
    description: "内容输入、平台适配预览、字段检查和模拟发布状态仍可在前端完成，适合作品演示。",
  },
];

const platformIntegrationProfiles: PlatformIntegrationProfile[] = [
  {
    platformId: "wechat",
    platformName: "微信公众号",
    authStatus: "草稿同步试点",
    requiredPermissions: ["公众号主体", "AppID / AppSecret", "草稿箱接口", "素材上传"],
    apiDifficulty: "中",
    limitations: ["需要后端保管密钥", "图片素材要先上传", "正式群发仍受平台审核和频率限制"],
    publishEntryUrl: "https://mp.weixin.qq.com/",
    nextStep: "第七次迭代接入草稿箱同步后端代理，不直接做群发。",
  },
  {
    platformId: "zhihu",
    platformName: "知乎",
    authStatus: "未授权",
    requiredPermissions: ["开放平台应用", "账号授权", "内容写入权限"],
    apiDifficulty: "高",
    limitations: ["公开平台更偏数据读取", "内容写入能力需要单独确认", "不适合作为第一个真实发布试点"],
    publishEntryUrl: "https://www.zhihu.com/",
    nextStep: "先保留半自动复制发布，等写入接口和审核要求更明确后再接入。",
  },
  {
    platformId: "bilibili",
    platformName: "B站",
    authStatus: "需要企业/创作者认证",
    requiredPermissions: ["开放平台账号", "应用身份认证", "稿件或专栏发布权限", "视频素材管理"],
    apiDifficulty: "中",
    limitations: ["视频投稿需要素材、分区、封面等更多字段", "应用审核和账号身份会影响接入速度"],
    publishEntryUrl: "https://member.bilibili.com/platform/upload/video/frame",
    nextStep: "当前先导出标题、简介、分区和脚本摘要，后续可评估专栏或视频稿件小闭环。",
  },
  {
    platformId: "xiaohongshu",
    platformName: "小红书",
    authStatus: "未授权",
    requiredPermissions: ["开放平台应用", "创作者或商家身份", "笔记发布权限", "封面和话题规则"],
    apiDifficulty: "高",
    limitations: ["公开能力更偏商家和电商场景", "笔记发布权限、风控和审核要求较重"],
    publishEntryUrl: "https://creator.xiaohongshu.com/",
    nextStep: "继续使用人工复制发布，重点检查封面标题、开头钩子和标签数量。",
  },
];

const emptyPublishResult = (platformId: PlatformId): PublishResult => ({
  platformId,
  state: "idle",
  message: "尚未发布",
});

const buildPlatformAccountConnections = (
  wechatStatus: WechatDraftConfigStatus,
): PlatformAccountConnection[] => [
  {
    platformId: "wechat",
    platformName: "微信公众号",
    status: wechatStatus.configured ? "草稿同步试点" : "待配置",
    capability: wechatStatus.configured ? "可同步到公众号草稿箱" : "等待后端配置后启用草稿箱同步",
    requirements: ["项目级 AppID / AppSecret", "草稿箱接口权限", "默认封面素材 media_id", "服务器 IP 白名单"],
    actionLabel: "同步当前草稿",
    enabled: true,
    note: `${wechatStatus.message} 真实同步不能只绑定 AppID，还需要后端保存 AppSecret 和默认封面素材 media_id。`,
  },
  {
    platformId: "zhihu",
    platformName: "知乎",
    status: "待接入",
    capability: "预留文章/问答内容导出与后续授权入口",
    requirements: ["开放平台写入能力确认", "账号授权流程", "内容审核规则"],
    actionLabel: "预留接口",
    enabled: false,
    note: "当前公开能力更偏数据查询，本次先保留半自动发布。",
  },
  {
    platformId: "bilibili",
    platformName: "B站",
    status: "待接入",
    capability: "预留视频稿件/专栏发布接入入口",
    requirements: ["创作者认证", "分区和封面素材", "稿件审核规则"],
    actionLabel: "预留接口",
    enabled: false,
    note: "B站更偏视频投稿，本次不接真实投稿 API。",
  },
  {
    platformId: "xiaohongshu",
    platformName: "小红书",
    status: "待接入",
    capability: "预留图文笔记发布前校验和后续授权入口",
    requirements: ["商家/服务商能力确认", "封面图和话题规则", "风控审核要求"],
    actionLabel: "预留接口",
    enabled: false,
    note: "当前公开入口更偏商家和电商服务，本次先保留半自动发布。",
  },
];

const stateLabel: Record<PublishState, string> = {
  idle: "未发布",
  pending: "待发布",
  publishing: "发布中",
  success: "成功",
  failed: "失败",
};

const storageModeLabel: Record<PersistenceMode, string> = {
  supabase: "Supabase 数据库",
  local: "浏览器本地保存",
};

const createEmptyDraftMap = (): Record<PlatformId, PlatformDraft | undefined> => ({
  wechat: undefined,
  zhihu: undefined,
  bilibili: undefined,
  xiaohongshu: undefined,
});

const createEmptyPublishResults = (): Record<PlatformId, PublishResult> => ({
  wechat: emptyPublishResult("wechat"),
  zhihu: emptyPublishResult("zhihu"),
  bilibili: emptyPublishResult("bilibili"),
  xiaohongshu: emptyPublishResult("xiaohongshu"),
});

const createEmptyRetryCounts = (): Record<PlatformId, number> => ({
  wechat: 0,
  zhihu: 0,
  bilibili: 0,
  xiaohongshu: 0,
});

const formatSavedAt = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const getInitials = (value?: string) => {
  const text = value?.trim();
  if (!text) {
    return "CS";
  }

  return text.slice(0, 2).toUpperCase();
};

const getAuthErrorMessage = (caught: unknown, mode: "sign-in" | "sign-up") => {
  const fallback = mode === "sign-in" ? "登录失败，请检查邮箱和密码。" : "注册失败，请检查邮箱、密码和 Supabase Auth 设置。";
  const errorLike = caught as { message?: string; status?: number; code?: string };
  const message = errorLike?.message ?? "";
  const normalized = message.toLowerCase();

  if (errorLike?.status === 429 || normalized.includes("rate limit") || normalized.includes("over_email_send_rate_limit")) {
    return "注册请求被 Supabase 限流了。新项目默认邮件服务额度很低，请到 Supabase 的 Authentication -> Providers -> Email 里临时关闭 Confirm email，或稍后再试。";
  }

  if (normalized.includes("already registered") || normalized.includes("user already registered")) {
    return "这个邮箱已经注册过了，请切换到登录，或者换一个邮箱注册。";
  }

  if (normalized.includes("password")) {
    return "密码不符合 Supabase 要求，请换一个更强的密码，建议至少 8 位并包含大小写字母和数字。";
  }

  if (normalized.includes("email")) {
    return "邮箱格式或邮箱验证设置有问题，请确认邮箱填写正确，并检查 Supabase 的 Email 登录设置。";
  }

  return message || fallback;
};

const buildDraftMap = (draftList: PlatformDraft[]) => {
  const next = createEmptyDraftMap();
  draftList.forEach((draft) => {
    next[draft.platformId] = draft;
  });
  return next;
};

const buildPublishSnapshot = (attempts: PublishAttempt[]) => {
  const results = createEmptyPublishResults();
  const retries = createEmptyRetryCounts();

  attempts.forEach((attempt) => {
    if (results[attempt.platformId].state === "idle") {
      results[attempt.platformId] = {
        platformId: attempt.platformId,
        state: attempt.state,
        message: attempt.message,
        failureReason: attempt.failureReason,
        publishedAt: attempt.createdAt,
      };
    }

    retries[attempt.platformId] = Math.max(retries[attempt.platformId], attempt.retryCount);
  });

  return { results, retries };
};

const formatDraftForCopy = (draft: PlatformDraft) => {
  const metaRows = Object.entries(draft.meta)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}：${value}`)
    .join("\n");

  return [
    `平台：${draft.platformName}`,
    `标题：${draft.title}`,
    draft.subtitle ? `摘要 / 简介：${draft.subtitle}` : "",
    "",
    "正文：",
    draft.body,
    "",
    `标签：${draft.tags.map((tag) => (draft.platformId === "xiaohongshu" ? `#${tag}` : tag)).join(" ")}`,
    metaRows ? `\n平台专属字段：\n${metaRows}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("copy failed");
  }
};

const buildPublishChecklist = (drafts: PlatformDraft[], issues: ValidationIssue[]): PublishChecklistItem[] =>
  drafts.flatMap((draft) => {
    const profileItem = platformIntegrationProfiles.find((item) => item.platformId === draft.platformId);
    const issueList = issues.filter((issue) => issue.platformId === draft.platformId);
    const items: PublishChecklistItem[] = [
      {
        platformId: draft.platformId,
        platformName: draft.platformName,
        label: "字段检查",
        status: issueList.length === 0 ? "通过" : "待处理",
        detail: issueList.length === 0 ? "标题、正文、标签和平台专属字段都已满足当前检查规则。" : issueList.map((issue) => issue.message).join("；"),
      },
      {
        platformId: draft.platformId,
        platformName: draft.platformName,
        label: "复制内容",
        status: "待处理",
        detail: `点击“复制发布内容”，再粘贴到${draft.platformName}后台。`,
      },
      {
        platformId: draft.platformId,
        platformName: draft.platformName,
        label: "打开发布入口",
        status: "待处理",
        detail: profileItem ? `打开 ${profileItem.publishEntryUrl} 后，用平台账号完成登录和人工发布。` : "打开平台后台后，人工粘贴内容并检查预览。",
      },
      {
        platformId: draft.platformId,
        platformName: draft.platformName,
        label: "真实限制确认",
        status: "待处理",
        detail: profileItem ? profileItem.limitations.join("；") : "发布前仍需确认平台审核、频率和账号权限。",
      },
    ];

    return items;
  });

function App() {
  const [activeView, setActiveView] = useState<AppView>("workspace");
  const [source, setSource] = useState<SourceContent>(defaultSource);
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>(initialPlatformIds);
  const [drafts, setDrafts] = useState<Record<PlatformId, PlatformDraft | undefined>>(createEmptyDraftMap);
  const [activePlatform, setActivePlatform] = useState<PlatformId>("wechat");
  const [publishResults, setPublishResults] = useState<Record<PlatformId, PublishResult>>(createEmptyPublishResults);
  const [publishAttempts, setPublishAttempts] = useState<PublishAttempt[]>([]);
  const [retryCounts, setRetryCounts] = useState<Record<PlatformId, number>>(createEmptyRetryCounts);
  const [savedRecords, setSavedRecords] = useState<SavedContentRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | undefined>();
  const [storageMode] = useState<PersistenceMode>(getPersistenceMode);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | undefined>();
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [profileNickname, setProfileNickname] = useState("创作者");
  const [authNotice, setAuthNotice] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("mock");
  const [isGenerating, setIsGenerating] = useState(false);
  const [canFallbackToMock, setCanFallbackToMock] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSyncingWechatDraft, setIsSyncingWechatDraft] = useState(false);
  const [wechatConfigStatus, setWechatConfigStatus] = useState<WechatDraftConfigStatus>({
    configured: false,
    message: "正在检查微信公众号草稿箱配置。",
  });
  const [isCheckingWechatConfig, setIsCheckingWechatConfig] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [showPublishChecklist, setShowPublishChecklist] = useState(false);
  const [error, setError] = useState("");

  const generatedDrafts = useMemo(
    () => platformAdapters.map((adapter) => drafts[adapter.id]).filter(Boolean) as PlatformDraft[],
    [drafts],
  );
  const activeDraft = drafts[activePlatform];
  const validationIssues = useMemo(() => getValidationIssues(generatedDrafts), [generatedDrafts]);
  const publishChecklist = useMemo(
    () => buildPublishChecklist(generatedDrafts, validationIssues),
    [generatedDrafts, validationIssues],
  );
  const activeIssues = activeDraft
    ? validationIssues.filter((issue) => issue.platformId === activeDraft.platformId)
    : validationIssues;
  const canGenerate = source.title.trim().length > 0 && source.body.trim().length > 0 && selectedPlatforms.length > 0;
  const canPublish = generatedDrafts.length > 0 && !isPublishing;
  const canSaveRecord = source.title.trim().length > 0 && source.body.trim().length > 0 && !isSavingRecord;
  const currentUserId = session?.user.id;
  const currentEmail = session?.user.email ?? "";
  const authReady = isAuthConfigured();
  const platformAccountConnections = useMemo(
    () => buildPlatformAccountConnections(wechatConfigStatus),
    [wechatConfigStatus],
  );

  const loadProfile = async (nextSession: Session | null) => {
    if (!nextSession?.user) {
      setProfile(undefined);
      setProfileNickname("创作者");
      return;
    }

    const loadedProfile = await getProfile(nextSession.user.id, nextSession.user.email ?? "");
    setProfile(loadedProfile);
    setProfileNickname(loadedProfile.nickname);
  };

  const refreshWechatConfigStatus = async () => {
    setIsCheckingWechatConfig(true);
    try {
      const status = await getWechatDraftConfigStatus();
      setWechatConfigStatus(status);
    } catch (caught) {
      setWechatConfigStatus({
        configured: false,
        message: caught instanceof Error ? caught.message : "读取微信公众号草稿箱配置失败。",
      });
    } finally {
      setIsCheckingWechatConfig(false);
    }
  };

  const refreshSavedRecords = async (ownerId = currentUserId) => {
    setIsLoadingRecords(true);
    try {
      if (storageMode === "supabase" && !ownerId) {
        setSavedRecords([]);
        setSaveNotice("请先登录账号，再查看云端历史内容。");
        return;
      }

      const records = await listContentRecords(ownerId);
      setSavedRecords(records);
      setSaveNotice(
        storageMode === "supabase"
          ? "已从 Supabase 读取当前账号的历史内容。"
          : "未配置 Supabase，当前使用浏览器本地保存演示。",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取历史内容失败，请检查 Supabase 配置。");
    } finally {
      setIsLoadingRecords(false);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const currentSession = await getCurrentSession();
        setSession(currentSession);
        await loadProfile(currentSession);
        await refreshSavedRecords(currentSession?.user.id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "读取登录状态失败，请检查 Supabase 配置。");
      }
    };

    void initAuth();
    void refreshWechatConfigStatus();

    return onAuthSessionChange((nextSession) => {
      setSession(nextSession);
      void loadProfile(nextSession);
      void refreshSavedRecords(nextSession?.user.id);
    });
  }, []);

  const updateSource = <K extends keyof SourceContent>(key: K, value: SourceContent[K]) => {
    setSource((current) => ({ ...current, [key]: value }));
  };

  const togglePlatform = (platformId: PlatformId) => {
    setSelectedPlatforms((current) => {
      const next = current.includes(platformId)
        ? current.filter((item) => item !== platformId)
        : [...current, platformId];

      if (!next.includes(activePlatform) && next[0]) {
        setActivePlatform(next[0]);
      }

      return next;
    });
  };

  const generateDrafts = async (modeOverride?: GenerationMode) => {
    if (!source.title.trim()) {
      setError("请先填写原始标题。");
      return;
    }

    if (!source.body.trim()) {
      setError("请先填写原始正文。");
      return;
    }

    if (selectedPlatforms.length === 0) {
      setError("请至少选择一个发布平台。");
      return;
    }

    const activeGenerationMode = modeOverride ?? generationMode;
    const provider = activeGenerationMode === "deepseek" ? realApiGenerationProvider : mockGenerationProvider;

    if (modeOverride) {
      setGenerationMode(modeOverride);
    }

    setError("");
    setCanFallbackToMock(false);
    setIsGenerating(true);

    try {
      const nextDrafts = await provider.generateDrafts(source, selectedPlatforms);
      setDrafts((current) => {
        const merged = { ...current };
        nextDrafts.forEach((draft) => {
          merged[draft.platformId] = draft;
        });
        return merged;
      });
      setActivePlatform(nextDrafts[0].platformId);
      setPublishResults((current) => {
        const reset = { ...current };
        nextDrafts.forEach((draft) => {
          reset[draft.platformId] = emptyPublishResult(draft.platformId);
        });
        return reset;
      });
      setPublishAttempts([]);
      setRetryCounts(createEmptyRetryCounts());
      setActiveRecordId(undefined);
      setSaveNotice(`已使用${generationModeLabel[activeGenerationMode]}生成新的平台草稿，保存后刷新页面也能重新打开。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败，请稍后重试。");
      setCanFallbackToMock(activeGenerationMode === "deepseek");
    } finally {
      setIsGenerating(false);
    }
  };

  const updateDraft = (platformId: PlatformId, changes: Partial<PlatformDraft>) => {
    setDrafts((current) => {
      const draft = current[platformId];
      if (!draft) {
        return current;
      }

      return {
        ...current,
        [platformId]: {
          ...draft,
          ...changes,
        },
      };
    });
  };

  const updateDraftMeta = (platformId: PlatformId, key: string, value: string) => {
    setDrafts((current) => {
      const draft = current[platformId];
      if (!draft) {
        return current;
      }

      return {
        ...current,
        [platformId]: {
          ...draft,
          meta: {
            ...draft.meta,
            [key]: value,
          },
        },
      };
    });
  };

  const saveCurrentRecord = async (attempts = publishAttempts) => {
    if (storageMode === "supabase" && !currentUserId) {
      setError("请先登录账号，再保存内容方案。");
      setActiveView("profile");
      return undefined;
    }

    setIsSavingRecord(true);
    setError("");

    try {
      const result = await saveContentRecord({
        id: activeRecordId,
        userId: currentUserId,
        source,
        selectedPlatforms,
        drafts: generatedDrafts,
        publishAttempts: attempts,
      });

      setActiveRecordId(result.record.id);
      setSavedRecords((current) => [result.record, ...current.filter((record) => record.id !== result.record.id)]);
      setSaveNotice(`已保存到${storageModeLabel[result.mode]}：${formatSavedAt(result.record.updatedAt)}。`);
      return result.record;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请检查 Supabase 环境变量和数据表。");
      return undefined;
    } finally {
      setIsSavingRecord(false);
    }
  };

  const openSavedRecord = async (recordId: string) => {
    setIsLoadingRecords(true);
    setError("");

    try {
      const record = await getContentRecord(recordId);
      if (!record) {
        setError("没有找到这条历史内容，可能已经被删除。");
        return;
      }

      setSource(record.source);
      setSelectedPlatforms(record.selectedPlatforms);
      setDrafts(buildDraftMap(record.drafts));
      setActivePlatform(record.drafts[0]?.platformId ?? record.selectedPlatforms[0] ?? "wechat");
      setPublishAttempts(record.publishAttempts);
      const snapshot = buildPublishSnapshot(record.publishAttempts);
      setPublishResults(snapshot.results);
      setRetryCounts(snapshot.retries);
      setActiveRecordId(record.id);
      setSaveNotice(`已打开历史内容：${formatSavedAt(record.updatedAt)}。`);
      setActiveView("workspace");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打开历史内容失败。");
    } finally {
      setIsLoadingRecords(false);
    }
  };

  const handleAuthSubmit = async () => {
    if (!authReady) {
      setAuthNotice("请先配置 Supabase 环境变量，才能使用真实登录。");
      return;
    }

    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthNotice("请填写邮箱和密码。");
      return;
    }

    setIsAuthenticating(true);
    setAuthNotice("");
    setError("");

    try {
      const nextSession =
        authMode === "sign-in"
          ? await signInWithEmail(authEmail.trim(), authPassword)
          : await signUpWithEmail(authEmail.trim(), authPassword, profileNickname.trim() || "创作者");

      setSession(nextSession);
      await loadProfile(nextSession);
      await refreshSavedRecords(nextSession?.user.id);
      setAuthNotice(
        authMode === "sign-in"
          ? "登录成功，已读取你的历史内容。"
          : nextSession
            ? "注册成功，已创建个人资料。"
            : "注册请求已提交，请先到邮箱完成确认；如果只是本地验收，可以在 Supabase 里临时关闭 Confirm email。",
      );
      setAuthPassword("");
    } catch (caught) {
      setAuthNotice(getAuthErrorMessage(caught, authMode));
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    setIsAuthenticating(true);
    setAuthNotice("");

    try {
      await signOut();
      setSession(null);
      setProfile(undefined);
      setSavedRecords([]);
      setActiveRecordId(undefined);
      setAuthNotice("已退出登录。");
      setSaveNotice("已退出登录，云端历史内容会在下次登录后读取。");
    } catch (caught) {
      setAuthNotice(caught instanceof Error ? caught.message : "退出登录失败，请稍后重试。");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleProfileSave = async () => {
    if (!currentUserId || !currentEmail) {
      setAuthNotice("请先登录账号，再保存个人资料。");
      return;
    }

    setIsAuthenticating(true);
    setAuthNotice("");

    try {
      const nextProfile = await upsertProfile(currentUserId, currentEmail, profileNickname.trim() || "创作者");
      setProfile(nextProfile);
      setAuthNotice("个人资料已保存。");
    } catch (caught) {
      setAuthNotice(caught instanceof Error ? caught.message : "保存个人资料失败。");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleAvatarChange = async (file?: File) => {
    if (!file) {
      return;
    }

    if (!currentUserId || !currentEmail) {
      setAuthNotice("请先登录账号，再上传头像。");
      return;
    }

    setIsUploadingAvatar(true);
    setAuthNotice("");

    try {
      const nextProfile = await uploadAvatar(currentUserId, currentEmail, file);
      setProfile(nextProfile);
      setProfileNickname(nextProfile.nickname);
      setAuthNotice("头像已上传。");
    } catch (caught) {
      setAuthNotice(caught instanceof Error ? caught.message : "头像上传失败，请检查 avatars bucket。");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const publishDraft = async (draft: PlatformDraft, retryCount: number): Promise<PublishAttempt | undefined> => {
    const draftIssues = getValidationIssues([draft]);
    if (draftIssues.length > 0) {
      setError(`${draft.platformName}还有字段没有补齐：${draftIssues.map((issue) => issue.field).join("、")}。`);
      return undefined;
    }

    setPublishResults((current) => ({
      ...current,
      [draft.platformId]: {
        platformId: draft.platformId,
        state: "publishing",
        message: retryCount > 0 ? "正在重试提交内容" : "正在模拟提交内容",
      },
    }));

    const result = await simulatePublish(draft, retryCount);
    setPublishResults((current) => ({
      ...current,
      [draft.platformId]: result,
    }));
    const attempt = {
      id: `${draft.platformId}-${Date.now()}`,
      platformId: draft.platformId,
      platformName: draft.platformName,
      state: result.state,
      message: result.message,
      retryCount,
      createdAt: result.publishedAt ?? new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      failureReason: result.failureReason,
    };
    setPublishAttempts((current) => [attempt, ...current]);
    return attempt;
  };

  const publishAll = async () => {
    if (!canPublish) {
      setError("请先生成至少一个平台版本。");
      return;
    }

    if (validationIssues.length > 0) {
      setError(`发布前请先补齐字段：${validationIssues[0].platformName}的${validationIssues[0].field}。`);
      setShowPublishConfirm(false);
      return;
    }

    setError("");
    setShowPublishConfirm(false);
    setIsPublishing(true);

    setPublishResults((current) => {
      const next = { ...current };
      generatedDrafts.forEach((draft) => {
        next[draft.platformId] = {
          platformId: draft.platformId,
          state: "pending",
          message: "等待发布",
        };
      });
      return next;
    });

    const nextAttempts: PublishAttempt[] = [];
    for (const draft of generatedDrafts) {
      const attempt = await publishDraft(draft, retryCounts[draft.platformId]);
      if (attempt) {
        nextAttempts.push(attempt);
      }
    }

    setIsPublishing(false);

    if (activeRecordId && nextAttempts.length > 0) {
      void saveCurrentRecord([...nextAttempts.reverse(), ...publishAttempts]);
    }
  };

  const retryPublish = async (platformId: PlatformId) => {
    const draft = drafts[platformId];
    if (!draft || isPublishing) {
      return;
    }

    const nextRetryCount = retryCounts[platformId] + 1;
    setRetryCounts((current) => ({
      ...current,
      [platformId]: nextRetryCount,
    }));
    setError("");
    setIsPublishing(true);
    const attempt = await publishDraft(draft, nextRetryCount);
    setIsPublishing(false);

    if (activeRecordId && attempt) {
      void saveCurrentRecord([attempt, ...publishAttempts]);
    }
  };

  const syncActiveWechatDraft = async (targetDraft = activeDraft) => {
    if (!targetDraft || targetDraft.platformId !== "wechat") {
      setCopyNotice("请先生成微信公众号草稿，再同步草稿箱。");
      setActivePlatform("wechat");
      setActiveView("workspace");
      return;
    }

    if (storageMode === "supabase" && !currentUserId) {
      setError("请先登录账号，再同步微信公众号草稿箱。同步结果会写入当前账号的发布记录。");
      setActiveView("profile");
      return;
    }

    const draftIssues = getValidationIssues([targetDraft]);
    if (draftIssues.length > 0) {
      setError(`同步前请先补齐字段：${draftIssues.map((issue) => issue.field).join("、")}。`);
      return;
    }

    setError("");
    setCopyNotice("");
    setIsSyncingWechatDraft(true);
    setPublishResults((current) => ({
      ...current,
      wechat: {
        platformId: "wechat",
        state: "publishing",
        message: "正在同步到微信公众号草稿箱",
      },
    }));

    try {
      const result = await syncWechatDraft(targetDraft);
      const publishResult: PublishResult = {
        platformId: "wechat",
        state: result.state,
        message: result.draftMediaId ? `${result.message} 草稿 media_id：${result.draftMediaId}` : result.message,
        publishedAt: new Date(result.publishedAt ?? Date.now()).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        failureReason: result.failureReason,
      };
      const attempt: PublishAttempt = {
        id: `wechat-draft-${Date.now()}`,
        platformId: "wechat",
        platformName: targetDraft.platformName,
        state: publishResult.state,
        message: publishResult.message,
        retryCount: retryCounts.wechat,
        createdAt: publishResult.publishedAt ?? new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        failureReason: publishResult.failureReason,
      };

      setPublishResults((current) => ({ ...current, wechat: publishResult }));
      setPublishAttempts((current) => [attempt, ...current]);
      setCopyNotice(publishResult.message);
      void saveCurrentRecord([attempt, ...publishAttempts]);
      void refreshWechatConfigStatus();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "公众号草稿箱同步失败。";
      const publishedAt = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      const publishResult: PublishResult = {
        platformId: "wechat",
        state: "failed",
        message,
        publishedAt,
        failureReason: message,
      };
      const attempt: PublishAttempt = {
        id: `wechat-draft-${Date.now()}`,
        platformId: "wechat",
        platformName: targetDraft.platformName,
        state: "failed",
        message,
        retryCount: retryCounts.wechat,
        createdAt: publishedAt,
        failureReason: message,
      };

      setPublishResults((current) => ({ ...current, wechat: publishResult }));
      setPublishAttempts((current) => [attempt, ...current]);
      setCopyNotice(message);
      void saveCurrentRecord([attempt, ...publishAttempts]);
      void refreshWechatConfigStatus();
    } finally {
      setIsSyncingWechatDraft(false);
    }
  };

  const copyActiveDraft = async () => {
    if (!activeDraft) {
      setCopyNotice("请先生成一个平台版本，再复制发布内容。");
      return;
    }

    try {
      await copyTextToClipboard(formatDraftForCopy(activeDraft));
      setCopyNotice(`已复制${activeDraft.platformName}发布内容，可以粘贴到平台后台。`);
    } catch {
      setCopyNotice("复制失败，请手动选中文本复制。");
    }
  };

  const openActivePublishEntry = () => {
    if (!activeDraft) {
      setCopyNotice("请先选择一个平台版本。");
      return;
    }

    const profileItem = platformIntegrationProfiles.find((item) => item.platformId === activeDraft.platformId);
    if (profileItem) {
      window.open(profileItem.publishEntryUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="CreatorSync 内容开发助手">
          <LogoMark />
          <div>
            <p className="eyebrow">CreatorSync V7</p>
            <h1>内容开发助手</h1>
            <p className="topbar-copy">公众号草稿箱同步试点版，支持 DeepSeek 和 Mock AI 双模式。</p>
          </div>
        </div>

        <nav className="top-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? "active" : ""}
                type="button"
                onClick={() => setActiveView(item.id)}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="user-area">
          <div className="status-strip" aria-label="项目状态">
            <span><CheckCircle2 size={16} /> {generationModeLabel[generationMode]}</span>
            <span><ShieldCheck size={16} /> {session ? "已登录" : "未登录"}</span>
          </div>
          <button className="avatar-button" type="button" onClick={() => setActiveView("profile")} aria-label="进入个人中心">
            <span className="avatar-face">
              {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : getInitials(profile?.nickname ?? currentEmail)}
            </span>
            <span className="avatar-name">{profile?.nickname ?? (session ? "已登录" : "登录")}</span>
          </button>
        </div>
      </header>

      {activeView === "workspace" ? (
        <>
          <DashboardStats
            generatedCount={generatedDrafts.length}
            selectedCount={selectedPlatforms.length}
            issueCount={validationIssues.length}
            publishCount={publishAttempts.length}
          />
          <section className="workspace">
        <aside className="input-panel" aria-label="原始内容">
          <div className="panel-heading">
            <FileText size={20} />
            <h2>原始内容</h2>
          </div>

          <label className="field">
            <span>标题</span>
            <input
              value={source.title}
              onChange={(event) => updateSource("title", event.target.value)}
              placeholder="请输入原始标题"
            />
          </label>

          <label className="field">
            <span>正文</span>
            <textarea
              value={source.body}
              onChange={(event) => updateSource("body", event.target.value)}
              placeholder="请输入要适配到多平台的正文"
              rows={10}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>内容类型</span>
              <select
                value={source.contentType}
                onChange={(event) => updateSource("contentType", event.target.value as ContentType)}
              >
                {contentTypes.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>生成偏好</span>
              <select
                value={source.preference}
                onChange={(event) => updateSource("preference", event.target.value as TonePreference)}
              >
                {preferences.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>目标受众</span>
            <input
              value={source.audience}
              onChange={(event) => updateSource("audience", event.target.value)}
              placeholder="例如 内容创作者、产品经理、学生"
            />
          </label>

          <div className="ai-mode-toggle" role="group" aria-label="生成模式">
            <button
              className={generationMode === "mock" ? "active" : ""}
              type="button"
              onClick={() => setGenerationMode("mock")}
            >
              <Bot size={16} />
              Mock AI
            </button>
            <button
              className={generationMode === "deepseek" ? "active" : ""}
              type="button"
              onClick={() => setGenerationMode("deepseek")}
              title={isRealApiGenerationConfigured() ? "使用 DeepSeek 真实 AI" : "需要配置 VITE_AI_API_BASE_URL"}
            >
              <Sparkles size={16} />
              DeepSeek
            </button>
          </div>

          <div className="platform-grid" aria-label="选择平台">
            {platformAdapters.map((adapter) => {
              const checked = selectedPlatforms.includes(adapter.id);
              return (
                <button
                  key={adapter.id}
                  className={`platform-choice ${checked ? "selected" : ""}`}
                  type="button"
                  onClick={() => togglePlatform(adapter.id)}
                  style={{ "--accent": adapter.accent } as CSSProperties}
                >
                  <span className="platform-choice-top">
                    <span className="choice-check">{checked ? <Check size={16} /> : null}</span>
                    <PlatformLogo platformId={adapter.id} />
                  </span>
                  <strong>{adapter.shortName}</strong>
                  <small>{adapter.description}</small>
                </button>
              );
            })}
          </div>

          {error ? (
            <div className="notice error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              {canFallbackToMock ? (
                <button className="inline-action" type="button" onClick={() => void generateDrafts("mock")} disabled={isGenerating}>
                  改用 Mock AI
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="save-box">
            <div>
              <strong>第四次迭代保存</strong>
              <span>{storageMode === "supabase" && !session ? "登录后保存到 Supabase" : storageModeLabel[storageMode]}</span>
            </div>
            <button className="secondary-action" type="button" onClick={() => void saveCurrentRecord()} disabled={!canSaveRecord}>
              {isSavingRecord ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              保存当前方案
            </button>
          </div>
          {saveNotice ? <p className="save-note">{saveNotice}</p> : null}

          <button className="primary-action" type="button" onClick={() => void generateDrafts()} disabled={!canGenerate || isGenerating}>
            {isGenerating ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            {isGenerating ? "生成中" : `用${generationModeLabel[generationMode]}生成`}
          </button>
        </aside>

        <section className="result-panel" aria-label="生成结果">
          <div className="panel-heading">
            <SquarePen size={20} />
            <h2>平台版本</h2>
          </div>

          {generatedDrafts.length === 0 ? (
            <div className="empty-state">
              <Sparkles size={28} />
              <h3>等待生成</h3>
              <p>输入内容并选择平台后，这里会出现不同平台的可编辑版本和发布前检查结果。</p>
            </div>
          ) : (
            <>
              <div className="tabs" role="tablist" aria-label="平台版本">
                {generatedDrafts.map((draft) => (
                  <button
                    key={draft.platformId}
                    className={draft.platformId === activePlatform ? "active" : ""}
                    type="button"
                    onClick={() => setActivePlatform(draft.platformId)}
                    style={{ "--accent": adapterById[draft.platformId].accent } as CSSProperties}
                  >
                    {draft.platformName}
                  </button>
                ))}
              </div>

              <ValidationPanel issues={activeIssues} />

              {activeDraft ? (
                <DraftEditor
                  draft={activeDraft}
                  onChange={(changes) => updateDraft(activeDraft.platformId, changes)}
                  onMetaChange={(key, value) => updateDraftMeta(activeDraft.platformId, key, value)}
                />
              ) : null}
            </>
          )}

        </section>

        <aside className="preview-panel" aria-label="预览和发布">
          <div className="panel-heading">
            <Megaphone size={20} />
            <h2>预览发布</h2>
          </div>

          {activeDraft ? <PlatformPreview draft={activeDraft} /> : <PreviewPlaceholder />}

          <SemiAutoPublishPanel
            activeDraft={activeDraft}
            checklist={publishChecklist}
            copyNotice={copyNotice}
            isSyncingWechatDraft={isSyncingWechatDraft}
            showChecklist={showPublishChecklist}
            onCopy={copyActiveDraft}
            onOpenEntry={openActivePublishEntry}
            onSyncWechatDraft={() => void syncActiveWechatDraft()}
            onToggleChecklist={() => setShowPublishChecklist((current) => !current)}
          />

          <div className="publish-box">
            <div className="publish-head">
              <h3>发布状态</h3>
              <button
                className="secondary-action"
                type="button"
                onClick={() => setShowPublishConfirm(true)}
                disabled={!canPublish}
              >
                {isPublishing ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                模拟发布
              </button>
            </div>

            <div className="publish-list">
              {platformAdapters.map((adapter) => (
                <PublishItem
                  key={adapter.id}
                  adapterId={adapter.id}
                  result={publishResults[adapter.id]}
                  retryCount={retryCounts[adapter.id]}
                  isPublishing={isPublishing}
                  onRetry={() => retryPublish(adapter.id)}
                />
              ))}
            </div>
          </div>

          <PublishHistory attempts={publishAttempts} />
        </aside>
      </section>
        </>
      ) : null}

      {activeView === "records" ? (
        <RecordsPage
          attempts={publishAttempts}
          records={savedRecords}
          activeRecordId={activeRecordId}
          storageMode={storageMode}
          isLoading={isLoadingRecords}
          onBackToWorkspace={() => setActiveView("workspace")}
          onOpenRecord={(recordId) => void openSavedRecord(recordId)}
          onRefreshRecords={() => void refreshSavedRecords()}
        />
      ) : null}

      {activeView === "integrations" ? (
        <IntegrationPage capabilities={integrationCapabilities} profiles={platformIntegrationProfiles} />
      ) : null}

      {activeView === "profile" ? (
        <ProfilePage
          generatedCount={generatedDrafts.length}
          publishCount={publishAttempts.length}
          storageMode={storageMode}
          authReady={authReady}
          session={session}
          profile={profile}
          platformConnections={platformAccountConnections}
          wechatConfigStatus={wechatConfigStatus}
          activeWechatDraft={drafts.wechat}
          authMode={authMode}
          authEmail={authEmail}
          authPassword={authPassword}
          profileNickname={profileNickname}
          authNotice={authNotice}
          isAuthenticating={isAuthenticating}
          isUploadingAvatar={isUploadingAvatar}
          isCheckingWechatConfig={isCheckingWechatConfig}
          isSyncingWechatDraft={isSyncingWechatDraft}
          onAuthModeChange={setAuthMode}
          onAuthEmailChange={setAuthEmail}
          onAuthPasswordChange={setAuthPassword}
          onProfileNicknameChange={setProfileNickname}
          onAuthSubmit={() => void handleAuthSubmit()}
          onSignOut={() => void handleSignOut()}
          onProfileSave={() => void handleProfileSave()}
          onAvatarChange={(file) => void handleAvatarChange(file)}
          onOpenWechatWorkspace={() => {
            setActivePlatform("wechat");
            setActiveView("workspace");
          }}
          onSyncWechatDraft={() => void syncActiveWechatDraft(drafts.wechat)}
          onRefreshWechatConfig={() => void refreshWechatConfigStatus()}
        />
      ) : null}

      {showPublishConfirm ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title">
            <h2 id="publish-title">确认模拟发布</h2>
            <p>本次会把已生成的平台版本进入模拟发布流程，不会发送到真实平台。发布前会先检查必填字段。</p>
            <div className="confirm-list">
              {generatedDrafts.map((draft) => (
                <span key={draft.platformId}>{draft.platformName}</span>
              ))}
            </div>
            <div className="modal-actions">
              <button className="ghost-action" type="button" onClick={() => setShowPublishConfirm(false)}>
                取消
              </button>
              <button className="secondary-action" type="button" onClick={publishAll}>
                <Send size={16} />
                确认模拟发布
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function DashboardStats({
  generatedCount,
  selectedCount,
  issueCount,
  publishCount,
}: {
  generatedCount: number;
  selectedCount: number;
  issueCount: number;
  publishCount: number;
}) {
  const stats = [
    { label: "已选平台", value: selectedCount, helper: "当前生成范围", icon: CheckCircle2 },
    { label: "生成版本", value: generatedCount, helper: "平台草稿数量", icon: FileText },
    { label: "待检查项", value: issueCount, helper: issueCount > 0 ? "发布前需处理" : "字段完整", icon: ListChecks },
    { label: "发布记录", value: publishCount, helper: "本次会话记录", icon: History },
  ];

  return (
    <section className="dashboard-stats" aria-label="工作台概览">
      {stats.map((item) => {
        const Icon = item.icon;
        return (
          <article className="stat-card" key={item.label}>
            <div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.helper}</p>
            </div>
            <Icon size={22} />
          </article>
        );
      })}
    </section>
  );
}

function RecordsPage({
  attempts,
  records,
  activeRecordId,
  storageMode,
  isLoading,
  onBackToWorkspace,
  onOpenRecord,
  onRefreshRecords,
}: {
  attempts: PublishAttempt[];
  records: SavedContentRecord[];
  activeRecordId?: string;
  storageMode: PersistenceMode;
  isLoading: boolean;
  onBackToWorkspace: () => void;
  onOpenRecord: (recordId: string) => void;
  onRefreshRecords: () => void;
}) {
  return (
    <section className="page-grid records-page">
      <article className="page-card">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Publish Records</p>
            <h2>发布记录</h2>
          </div>
          <div className="button-row">
            <button className="secondary-action" type="button" onClick={onRefreshRecords} disabled={isLoading}>
              {isLoading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
              刷新历史
            </button>
            <button className="secondary-action" type="button" onClick={onBackToWorkspace}>
              <Home size={16} />
              回到工作台
            </button>
          </div>
        </div>
        <PublishHistory attempts={attempts} />
      </article>

      <aside className="page-card side-card">
        <div className="panel-heading compact">
          <Database size={19} />
          <h2>历史内容</h2>
        </div>
        <p>
          当前保存方式：{storageModeLabel[storageMode]}。
          {storageMode === "local" ? " 配置 Supabase 后，这里会读取云端数据。" : " 刷新页面后仍可重新打开已保存内容。"}
        </p>
        {records.length === 0 ? (
          <p className="history-empty">还没有保存过内容方案。回到工作台点击“保存当前方案”后，这里会出现历史记录。</p>
        ) : (
          <div className="record-list">
            {records.map((record) => (
              <article className={`record-item ${record.id === activeRecordId ? "active" : ""}`} key={record.id}>
                <div>
                  <strong>{record.source.title}</strong>
                  <span>
                    {formatSavedAt(record.updatedAt)} · {record.drafts.length} 个草稿 · {record.publishAttempts.length} 条发布记录
                  </span>
                </div>
                <button className="retry-action" type="button" onClick={() => onOpenRecord(record.id)}>
                  打开
                </button>
              </article>
            ))}
          </div>
        )}
      </aside>
    </section>
  );
}

function IntegrationPage({
  capabilities,
  profiles,
}: {
  capabilities: IntegrationCapability[];
  profiles: PlatformIntegrationProfile[];
}) {
  return (
    <section className="page-grid">
      <article className="page-card">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Integration Research</p>
            <h2>真实平台接入预研</h2>
          </div>
          <span className="page-badge">先讲清边界，再做真实接入</span>
        </div>
        <IntegrationPanel capabilities={capabilities} />
        <PlatformIntegrationTable profiles={profiles} />
      </article>

      <aside className="page-card side-card">
        <div className="panel-heading compact">
          <Lightbulb size={19} />
          <h2>第七次优先级</h2>
        </div>
        <div className="priority-note">
          <strong>优先做微信公众号草稿箱同步</strong>
          <p>当前产品以图文内容改写和多平台发布准备为主，公众号草稿箱更贴合已有标题、摘要、正文和标签结构。</p>
          <p>B站更适合视频投稿，小红书和知乎的公开能力限制更多，所以先保留半自动发布。</p>
          <a href="https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html" target="_blank" rel="noreferrer">
            查看公众号草稿箱文档 <ExternalLink size={14} />
          </a>
        </div>
      </aside>
    </section>
  );
}

function ProfilePage({
  generatedCount,
  publishCount,
  storageMode,
  authReady,
  session,
  profile,
  platformConnections,
  wechatConfigStatus,
  activeWechatDraft,
  authMode,
  authEmail,
  authPassword,
  profileNickname,
  authNotice,
  isAuthenticating,
  isUploadingAvatar,
  isCheckingWechatConfig,
  isSyncingWechatDraft,
  onAuthModeChange,
  onAuthEmailChange,
  onAuthPasswordChange,
  onProfileNicknameChange,
  onAuthSubmit,
  onSignOut,
  onProfileSave,
  onAvatarChange,
  onOpenWechatWorkspace,
  onSyncWechatDraft,
  onRefreshWechatConfig,
}: {
  generatedCount: number;
  publishCount: number;
  storageMode: PersistenceMode;
  authReady: boolean;
  session: Session | null;
  profile?: UserProfile;
  platformConnections: PlatformAccountConnection[];
  wechatConfigStatus: WechatDraftConfigStatus;
  activeWechatDraft?: PlatformDraft;
  authMode: "sign-in" | "sign-up";
  authEmail: string;
  authPassword: string;
  profileNickname: string;
  authNotice: string;
  isAuthenticating: boolean;
  isUploadingAvatar: boolean;
  isCheckingWechatConfig: boolean;
  isSyncingWechatDraft: boolean;
  onAuthModeChange: (mode: "sign-in" | "sign-up") => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onProfileNicknameChange: (value: string) => void;
  onAuthSubmit: () => void;
  onSignOut: () => void;
  onProfileSave: () => void;
  onAvatarChange: (file?: File) => void;
  onOpenWechatWorkspace: () => void;
  onSyncWechatDraft: () => void;
  onRefreshWechatConfig: () => void;
}) {
  const email = session?.user.email ?? profile?.email ?? "";

  return (
    <section className="page-grid profile-page">
      <article className="page-card profile-card">
        <div className="profile-hero">
          <span className="profile-avatar">
            {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : getInitials(profile?.nickname ?? email)}
          </span>
          <div>
            <p className="eyebrow">Personal Center</p>
            <h2>个人中心</h2>
            <p>
              {session
                ? "这里已经接入 Supabase 登录、个人资料和头像上传，保存的内容只归当前账号。"
                : "请登录或注册账号。登录后可以上传头像，并把内容方案保存到自己的历史记录里。"}
            </p>
          </div>
        </div>

        <div className="profile-metrics">
          <span>生成版本 <strong>{generatedCount}</strong></span>
          <span>发布记录 <strong>{publishCount}</strong></span>
          <span>账号状态 <strong>{session ? "已登录" : "未登录"}</strong></span>
        </div>
      </article>

      <article className="page-card platform-account-card">
        <div className="page-heading compact-heading">
          <div>
            <p className="eyebrow">Platform Accounts</p>
            <h2>平台账号接入</h2>
          </div>
          <button className="ghost-action" type="button" onClick={onRefreshWechatConfig} disabled={isCheckingWechatConfig}>
            {isCheckingWechatConfig ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            刷新状态
          </button>
        </div>
        <p className="section-copy">
          本次先做微信公众号项目级草稿箱同步，其余平台保留接入入口。这里不会保存你的平台账号密码。
        </p>
        <div className="platform-account-grid">
          {platformConnections.map((connection) => {
            const isWechat = connection.platformId === "wechat";
            const hasWechatDraft = Boolean(activeWechatDraft);
            const actionLabel = isWechat
              ? hasWechatDraft
                ? connection.actionLabel
                : "先生成公众号草稿"
              : connection.actionLabel;
            const handleAction = isWechat
              ? hasWechatDraft
                ? onSyncWechatDraft
                : onOpenWechatWorkspace
              : undefined;

            return (
              <article className={`platform-account-item ${connection.enabled ? "enabled" : "reserved"}`} key={connection.platformId}>
                <div className="platform-account-head">
                  <div>
                    <PlatformLogo platformId={connection.platformId} />
                    <strong>{connection.platformName}</strong>
                  </div>
                  <span className={connection.enabled && wechatConfigStatus.configured ? "status-pill success" : "status-pill"}>
                    {connection.status}
                  </span>
                </div>
                <p>{connection.capability}</p>
                <div className="api-list">
                  {connection.requirements.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <p className="save-note">{connection.note}</p>
                {isWechat ? (
                  <p className="binding-note">
                    绑定方式：当前是项目级后端绑定。用户级公众号 OAuth 绑定会放到后续迭代。
                  </p>
                ) : null}
                <button
                  className={connection.enabled ? "secondary-action" : "ghost-action"}
                  type="button"
                  onClick={handleAction}
                  disabled={!connection.enabled || (isWechat && isSyncingWechatDraft)}
                >
                  {isWechat && isSyncingWechatDraft ? (
                    <Loader2 className="spin" size={16} />
                  ) : connection.enabled ? (
                    <Send size={16} />
                  ) : (
                    <PlugZap size={16} />
                  )}
                  {isWechat && isSyncingWechatDraft ? "同步中..." : actionLabel}
                </button>
              </article>
            );
          })}
        </div>
      </article>

      <aside className="page-card side-card">
        <div className="panel-heading compact">
          <Settings size={19} />
          <h2>{session ? "账号资料" : "登录 / 注册"}</h2>
        </div>
        {!authReady ? (
          <div className="notice error">
            <AlertCircle size={18} />
            当前没有配置 Supabase 环境变量，真实登录和头像上传暂不可用。
          </div>
        ) : null}

        {session ? (
          <div className="account-panel">
            <div className="account-row">
              <span>邮箱</span>
              <strong>{email}</strong>
            </div>
            <label className="field">
              <span>昵称</span>
              <input value={profileNickname} onChange={(event) => onProfileNicknameChange(event.target.value)} />
            </label>
            <label className="upload-field">
              <UploadCloud size={17} />
              {isUploadingAvatar ? "上传中..." : "上传或替换头像"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => onAvatarChange(event.target.files?.[0])}
                disabled={isUploadingAvatar}
              />
            </label>
            <div className="button-row profile-actions">
              <button className="secondary-action" type="button" onClick={onProfileSave} disabled={isAuthenticating}>
                {isAuthenticating ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                保存资料
              </button>
              <button className="ghost-action" type="button" onClick={onSignOut} disabled={isAuthenticating}>
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <div className="account-panel">
            <div className="auth-tabs" role="tablist" aria-label="登录方式">
              <button type="button" className={authMode === "sign-in" ? "active" : ""} onClick={() => onAuthModeChange("sign-in")}>
                登录
              </button>
              <button type="button" className={authMode === "sign-up" ? "active" : ""} onClick={() => onAuthModeChange("sign-up")}>
                注册
              </button>
            </div>
            <label className="field">
              <span>邮箱</span>
              <input value={authEmail} onChange={(event) => onAuthEmailChange(event.target.value)} placeholder="name@example.com" />
            </label>
            <label className="field">
              <span>密码</span>
              <input
                type="password"
                value={authPassword}
                onChange={(event) => onAuthPasswordChange(event.target.value)}
                placeholder="至少 6 位"
              />
            </label>
            {authMode === "sign-up" ? (
              <label className="field">
                <span>昵称</span>
                <input value={profileNickname} onChange={(event) => onProfileNicknameChange(event.target.value)} />
              </label>
            ) : null}
            <button className="primary-action" type="button" onClick={onAuthSubmit} disabled={isAuthenticating || !authReady}>
              {isAuthenticating ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
              {authMode === "sign-in" ? "登录账号" : "注册账号"}
            </button>
          </div>
        )}

        {authNotice ? <p className="save-note">{authNotice}</p> : null}
        <div className="api-list account-hints">
          <span>保存方式：{storageModeLabel[storageMode]}</span>
          <span>头像存储：Supabase Storage avatars bucket</span>
          <span>数据隔离：只读取当前登录用户的内容记录</span>
        </div>
      </aside>
    </section>
  );
}

function PlatformLogo({ platformId }: { platformId: PlatformId }) {
  if (platformId === "wechat") {
    return (
      <span className="platform-logo wechat-logo" aria-label="微信">
        <MessageCircle size={18} />
      </span>
    );
  }

  if (platformId === "zhihu") {
    return <span className="platform-logo zhihu-logo" aria-label="知乎">知</span>;
  }

  if (platformId === "bilibili") {
    return <span className="platform-logo bilibili-logo" aria-label="B站">B</span>;
  }

  return <span className="platform-logo xiaohongshu-logo" aria-label="小红书">RED</span>;
}

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <defs>
          <linearGradient id="logoGradient" x1="10" x2="54" y1="8" y2="56" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1b7cff" />
            <stop offset="0.58" stopColor="#19c2d1" />
            <stop offset="1" stopColor="#6b7cff" />
          </linearGradient>
        </defs>
        <path
          d="M12 16C12 11.6 15.6 8 20 8H44C48.4 8 52 11.6 52 16V48C52 52.4 48.4 56 44 56H20C15.6 56 12 52.4 12 48V16Z"
          fill="url(#logoGradient)"
        />
        <path
          d="M40.5 19.5H29.8C23.7 19.5 19.5 24.2 19.5 30C19.5 35.8 23.7 40.5 29.8 40.5H40.5"
          fill="none"
          stroke="white"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="6"
        />
        <path
          d="M27 32H39C42.6 32 45 34.2 45 37.4C45 40.8 42.4 43 38.7 43H24"
          fill="none"
          stroke="#e7fbff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="5"
        />
        <path d="M44 13L51 20L44 27" fill="none" stroke="#d8efff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      </svg>
    </div>
  );
}

function getValidationIssues(drafts: PlatformDraft[]): ValidationIssue[] {
  return drafts.flatMap((draft) => {
    const adapter = adapterById[draft.platformId];
    const issues: ValidationIssue[] = [];
    const titleLimit: Record<PlatformId, number> = {
      wechat: 64,
      zhihu: 80,
      bilibili: 80,
      xiaohongshu: 32,
    };
    const tagLimit: Record<PlatformId, number> = {
      wechat: 5,
      zhihu: 5,
      bilibili: 10,
      xiaohongshu: 10,
    };
    const bodyLimit: Record<PlatformId, number> = {
      wechat: 5000,
      zhihu: 5000,
      bilibili: 1200,
      xiaohongshu: 1000,
    };

    if (!draft.title.trim()) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "标题",
        message: "发布前需要有清楚的标题。",
      });
    } else if (draft.title.length > titleLimit[draft.platformId]) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "标题长度",
        message: `${adapter.shortName}标题建议控制在 ${titleLimit[draft.platformId]} 字以内，当前是 ${draft.title.length} 字。`,
      });
    }

    if (!draft.body.trim()) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "正文",
        message: "正文不能为空，否则用户看不到完整内容。",
      });
    } else if (draft.body.length > bodyLimit[draft.platformId]) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "正文长度",
        message: `${adapter.shortName}正文建议控制在 ${bodyLimit[draft.platformId]} 字以内，当前是 ${draft.body.length} 字。`,
      });
    }

    if (draft.tags.length === 0) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "标签",
        message: "至少保留一个标签，方便平台识别内容主题。",
      });
    } else if (draft.tags.length > tagLimit[draft.platformId]) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "标签数量",
        message: `${adapter.shortName}标签建议不超过 ${tagLimit[draft.platformId]} 个，当前是 ${draft.tags.length} 个。`,
      });
    }

    adapter.metaFields.forEach((field) => {
      if (!draft.meta[field.key]?.trim()) {
        issues.push({
          platformId: draft.platformId,
          platformName: draft.platformName,
          field: field.label,
          message: `${field.label}是${adapter.shortName}的专属字段，发布前建议补齐。`,
        });
      }
    });

    if (draft.platformId === "wechat" && (draft.meta.summary?.length ?? 0) > 120) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "摘要长度",
        message: "公众号摘要建议控制在 120 字以内，方便列表页展示。",
      });
    }

    if (draft.platformId === "xiaohongshu" && (draft.meta.coverTitle?.length ?? 0) > 16) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "封面标题",
        message: "小红书封面标题建议控制在 16 字以内，避免封面上文字太挤。",
      });
    }

    if (draft.platformId === "bilibili" && !draft.meta.scriptOutline?.includes("->")) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "脚本摘要",
        message: "B站脚本摘要建议保留分段结构，方便发布前检查视频内容顺序。",
      });
    }

    return issues;
  });
}

function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="validation-panel ok">
        <ListChecks size={18} />
        <span>发布前检查通过，当前平台字段完整。</span>
      </div>
    );
  }

  return (
    <div className="validation-panel warning">
      <AlertTriangle size={18} />
      <div>
        <strong>发布前还有 {issues.length} 项需要检查</strong>
        {issues.slice(0, 3).map((issue) => (
          <p key={`${issue.platformId}-${issue.field}`}>{issue.platformName}：{issue.message}</p>
        ))}
      </div>
    </div>
  );
}

function IntegrationPanel({ capabilities }: { capabilities: IntegrationCapability[] }) {
  const icons = [Bot, KeyRound, Server, Database];

  return (
    <section className="integration-panel" aria-label="真实能力预研">
      <div className="panel-heading compact">
        <ShieldCheck size={19} />
        <h2>真实能力预研</h2>
      </div>
      <div className="capability-grid">
        {capabilities.map((capability, index) => {
          const Icon = icons[index] ?? ShieldCheck;
          return (
            <article className="capability-card" key={capability.id}>
              <div className="capability-title">
                <Icon size={18} />
                <strong>{capability.title}</strong>
              </div>
              <p>{capability.description}</p>
              <div className="capability-meta">
                <span>{capability.owner}</span>
                <span>{capability.status}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PlatformIntegrationTable({ profiles }: { profiles: PlatformIntegrationProfile[] }) {
  return (
    <section className="platform-research" aria-label="平台接入限制">
      <div className="panel-heading compact">
        <PlugZap size={19} />
        <h2>平台授权与限制</h2>
      </div>
      <div className="research-grid">
        {profiles.map((profileItem) => {
          const adapter = adapterById[profileItem.platformId];
          return (
            <article className="research-card" key={profileItem.platformId}>
              <div className="research-card-head">
                <span className="publish-platform" style={{ "--accent": adapter.accent } as CSSProperties}>
                  {adapter.shortName}
                </span>
                <span>难度：{profileItem.apiDifficulty}</span>
              </div>
              <h3>{profileItem.platformName}</h3>
              <p>{profileItem.authStatus}</p>
              <div className="research-list">
                <strong>所需权限</strong>
                <span>{profileItem.requiredPermissions.join("、")}</span>
              </div>
              <div className="research-list">
                <strong>主要限制</strong>
                <span>{profileItem.limitations.join("；")}</span>
              </div>
              <div className="research-next">{profileItem.nextStep}</div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SemiAutoPublishPanel({
  activeDraft,
  checklist,
  copyNotice,
  isSyncingWechatDraft,
  showChecklist,
  onCopy,
  onOpenEntry,
  onSyncWechatDraft,
  onToggleChecklist,
}: {
  activeDraft?: PlatformDraft;
  checklist: PublishChecklistItem[];
  copyNotice: string;
  isSyncingWechatDraft: boolean;
  showChecklist: boolean;
  onCopy: () => void;
  onOpenEntry: () => void;
  onSyncWechatDraft: () => void;
  onToggleChecklist: () => void;
}) {
  const activeProfile = activeDraft
    ? platformIntegrationProfiles.find((item) => item.platformId === activeDraft.platformId)
    : undefined;
  const activeChecklist = activeDraft
    ? checklist.filter((item) => item.platformId === activeDraft.platformId)
    : checklist;
  const todoCount = activeChecklist.filter((item) => item.status === "待处理").length;

  return (
    <section className="semi-auto-panel" aria-label="半自动发布工具">
      <div className="publish-head">
        <h3>半自动发布</h3>
        <span>{activeDraft ? activeDraft.platformName : "等待生成"}</span>
      </div>
      <p>
        当前不会保存平台账号密码，也不会直接调用真实发布接口。这里先把可复制内容、发布入口和人工检查清单准备好。
      </p>
      <div className="semi-actions">
        {activeDraft?.platformId === "wechat" ? (
          <button className="primary-action" type="button" onClick={onSyncWechatDraft} disabled={isSyncingWechatDraft}>
            {isSyncingWechatDraft ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
            同步公众号草稿箱
          </button>
        ) : null}
        <button className="secondary-action" type="button" onClick={onCopy} disabled={!activeDraft}>
          <Copy size={16} />
          复制发布内容
        </button>
        <button className="ghost-action" type="button" onClick={onOpenEntry} disabled={!activeDraft}>
          <ExternalLink size={16} />
          打开发布入口
        </button>
        <button className="ghost-action" type="button" onClick={onToggleChecklist} disabled={checklist.length === 0}>
          <ClipboardList size={16} />
          {showChecklist ? "收起清单" : "生成清单"}
        </button>
      </div>
      {copyNotice ? <p className="save-note">{copyNotice}</p> : null}
      {activeProfile ? (
        <div className="entry-note">
          <strong>真实接入限制：</strong>
          <span>{activeProfile.limitations.join("；")}</span>
        </div>
      ) : null}
      {showChecklist ? (
        <div className="checklist-panel">
          <div className="checklist-summary">
            <strong>发布前清单</strong>
            <span>{todoCount > 0 ? `${todoCount} 项待处理` : "全部通过"}</span>
          </div>
          {activeChecklist.length === 0 ? (
            <p className="history-empty">生成平台版本后，这里会列出可执行的人工发布步骤。</p>
          ) : (
            activeChecklist.map((item) => (
              <article className={`checklist-item ${item.status === "通过" ? "passed" : "todo"}`} key={`${item.platformId}-${item.label}`}>
                <span>{item.status}</span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function DraftEditor({
  draft,
  onChange,
  onMetaChange,
}: {
  draft: PlatformDraft;
  onChange: (changes: Partial<PlatformDraft>) => void;
  onMetaChange: (key: string, value: string) => void;
}) {
  const adapter = adapterById[draft.platformId];

  return (
    <div className="editor">
      <label className="field">
        <span>标题</span>
        <input value={draft.title} onChange={(event) => onChange({ title: event.target.value })} />
      </label>

      <label className="field">
        <span>摘要 / 简介</span>
        <textarea value={draft.subtitle} onChange={(event) => onChange({ subtitle: event.target.value })} rows={3} />
      </label>

      <label className="field">
        <span>正文</span>
        <textarea value={draft.body} onChange={(event) => onChange({ body: event.target.value })} rows={10} />
      </label>

      <label className="field">
        <span>标签</span>
        <input
          value={draft.tags.join("，")}
          onChange={(event) =>
            onChange({
              tags: event.target.value
                .split(/[，,]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        />
      </label>

      <div className="field-row">
        {adapter.metaFields.map((field) => (
          <label className="field" key={field.key}>
            <span>{field.label}</span>
            <input
              value={draft.meta[field.key] ?? ""}
              onChange={(event) => onMetaChange(field.key, event.target.value)}
              placeholder={field.placeholder}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function PlatformPreview({ draft }: { draft: PlatformDraft }) {
  const adapter = adapterById[draft.platformId];
  const paragraphs = draft.body.split(/\n+/).filter(Boolean);

  if (draft.platformId === "bilibili") {
    return (
      <article className="preview bilibili" style={{ "--accent": adapter.accent } as CSSProperties}>
        <div className="video-frame">
          <PenLine size={30} />
          <span>{draft.meta.category}</span>
        </div>
        <h3>{draft.title}</h3>
        <p className="preview-subtitle">{draft.subtitle}</p>
        <p className="meta-line">{draft.meta.scriptOutline}</p>
        <TagRow tags={draft.tags} />
      </article>
    );
  }

  if (draft.platformId === "xiaohongshu") {
    return (
      <article className="preview xiaohongshu" style={{ "--accent": adapter.accent } as CSSProperties}>
        <div className="cover-title">{draft.meta.coverTitle}</div>
        <h3>{draft.title}</h3>
        <p className="preview-subtitle">{draft.meta.hook}</p>
        {paragraphs.slice(0, 5).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <TagRow tags={draft.tags.map((tag) => `#${tag}`)} />
      </article>
    );
  }

  if (draft.platformId === "zhihu") {
    return (
      <article className="preview zhihu" style={{ "--accent": adapter.accent } as CSSProperties}>
        <span className="question-label">{draft.meta.question}</span>
        <h3>{draft.title}</h3>
        <p className="preview-subtitle">{draft.meta.conclusion}</p>
        {paragraphs.slice(0, 4).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <TagRow tags={draft.tags} />
      </article>
    );
  }

  return (
    <article className="preview wechat" style={{ "--accent": adapter.accent } as CSSProperties}>
      <h3>{draft.title}</h3>
      <p className="preview-subtitle">{draft.meta.summary || draft.subtitle}</p>
      {paragraphs.slice(0, 5).map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <p className="ending">{draft.meta.ending}</p>
      <TagRow tags={draft.tags} />
    </article>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  return (
    <div className="tag-row">
      {tags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  );
}

function PublishItem({
  adapterId,
  result,
  retryCount,
  isPublishing,
  onRetry,
}: {
  adapterId: PlatformId;
  result: PublishResult;
  retryCount: number;
  isPublishing: boolean;
  onRetry: () => void;
}) {
  const adapter = adapterById[adapterId];
  const icon = {
    idle: <Clock3 size={16} />,
    pending: <Clock3 size={16} />,
    publishing: <Loader2 className="spin" size={16} />,
    success: <CheckCircle2 size={16} />,
    failed: <XCircle size={16} />,
  }[result.state];

  return (
    <div className={`publish-item ${result.state}`}>
      <span className="publish-platform" style={{ "--accent": adapter.accent } as CSSProperties}>
        {adapter.shortName}
      </span>
      <span className="publish-state">
        {icon}
        {stateLabel[result.state]}
      </span>
      <small>{result.publishedAt ? `${result.message} ${result.publishedAt}` : result.message}</small>
      {result.state === "failed" ? (
        <button className="retry-action" type="button" onClick={onRetry} disabled={isPublishing}>
          <RotateCcw size={14} />
          重试{retryCount > 0 ? ` ${retryCount}` : ""}
        </button>
      ) : null}
    </div>
  );
}

function PublishHistory({ attempts }: { attempts: PublishAttempt[] }) {
  return (
    <section className="history-panel" aria-label="发布记录">
      <div className="publish-head">
        <h3>发布记录</h3>
        <span>{attempts.length} 条</span>
      </div>
      {attempts.length === 0 ? (
        <p className="history-empty">完成模拟发布后，这里会记录每个平台的结果、失败原因和重试次数。</p>
      ) : (
        <div className="history-list">
          {attempts.slice(0, 6).map((attempt) => (
            <article className={`history-item ${attempt.state}`} key={attempt.id}>
              <strong>{attempt.platformName}</strong>
              <span>{stateLabel[attempt.state]} · {attempt.createdAt} · 重试 {attempt.retryCount} 次</span>
              <p>{attempt.failureReason || attempt.message}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PreviewPlaceholder() {
  return (
    <div className="preview-placeholder">
      <RefreshCcw size={24} />
      <p>生成后可查看平台预览。</p>
    </div>
  );
}

export default App;
