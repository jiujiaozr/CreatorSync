import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Database,
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
import { mockGenerationProvider } from "./services/contentGeneration";
import { simulatePublish } from "./services/publish";
import { getContentRecord, getPersistenceMode, listContentRecords, saveContentRecord } from "./services/recordStorage";
import type {
  ContentType,
  IntegrationCapability,
  PersistenceMode,
  PlatformDraft,
  PlatformId,
  PublishAttempt,
  PublishResult,
  PublishState,
  SavedContentRecord,
  SourceContent,
  TonePreference,
  UserProfile,
  ValidationIssue,
} from "./types";

const contentTypes: ContentType[] = ["知识分享", "产品介绍", "活动宣传", "经验复盘"];
const preferences: TonePreference[] = ["平衡清晰", "更正式", "更口语", "更有传播感"];
type AppView = "workspace" | "records" | "integrations" | "profile";

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
    description: "真实发布会受到平台审核、字段格式、频率限制影响，第二次迭代先展示检查和重试流程。",
  },
  {
    id: "frontend-state",
    title: "前端可保留能力",
    owner: "前端",
    status: "已预留",
    description: "内容输入、平台适配预览、字段检查和模拟发布状态仍可在前端完成，适合作品演示。",
  },
];

const emptyPublishResult = (platformId: PlatformId): PublishResult => ({
  platformId,
  state: "idle",
  message: "尚未发布",
});

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [error, setError] = useState("");

  const generatedDrafts = useMemo(
    () => platformAdapters.map((adapter) => drafts[adapter.id]).filter(Boolean) as PlatformDraft[],
    [drafts],
  );
  const activeDraft = drafts[activePlatform];
  const validationIssues = useMemo(() => getValidationIssues(generatedDrafts), [generatedDrafts]);
  const activeIssues = activeDraft
    ? validationIssues.filter((issue) => issue.platformId === activeDraft.platformId)
    : validationIssues;
  const canGenerate = source.title.trim().length > 0 && source.body.trim().length > 0 && selectedPlatforms.length > 0;
  const canPublish = generatedDrafts.length > 0 && !isPublishing;
  const canSaveRecord = source.title.trim().length > 0 && source.body.trim().length > 0 && !isSavingRecord;
  const currentUserId = session?.user.id;
  const currentEmail = session?.user.email ?? "";
  const authReady = isAuthConfigured();

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

  const generateDrafts = async () => {
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

    setError("");
    setIsGenerating(true);

    try {
      const nextDrafts = await mockGenerationProvider.generateDrafts(source, selectedPlatforms);
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
      setSaveNotice("已生成新的平台草稿，保存后刷新页面也能重新打开。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败，请稍后重试。");
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="CreatorSync 内容开发助手">
          <LogoMark />
          <div>
            <p className="eyebrow">CreatorSync V4</p>
            <h1>内容开发助手</h1>
            <p className="topbar-copy">真实登录与头像上传版，内容方案会保存到当前账号下。</p>
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
            <span><CheckCircle2 size={16} /> Mock AI</span>
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
              {error}
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

          <button className="primary-action" type="button" onClick={generateDrafts} disabled={!canGenerate || isGenerating}>
            {isGenerating ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            {isGenerating ? "生成中" : "生成平台内容"}
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
        <IntegrationPage capabilities={integrationCapabilities} />
      ) : null}

      {activeView === "profile" ? (
        <ProfilePage
          generatedCount={generatedDrafts.length}
          publishCount={publishAttempts.length}
          storageMode={storageMode}
          authReady={authReady}
          session={session}
          profile={profile}
          authMode={authMode}
          authEmail={authEmail}
          authPassword={authPassword}
          profileNickname={profileNickname}
          authNotice={authNotice}
          isAuthenticating={isAuthenticating}
          isUploadingAvatar={isUploadingAvatar}
          onAuthModeChange={setAuthMode}
          onAuthEmailChange={setAuthEmail}
          onAuthPasswordChange={setAuthPassword}
          onProfileNicknameChange={setProfileNickname}
          onAuthSubmit={() => void handleAuthSubmit()}
          onSignOut={() => void handleSignOut()}
          onProfileSave={() => void handleProfileSave()}
          onAvatarChange={(file) => void handleAvatarChange(file)}
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

function IntegrationPage({ capabilities }: { capabilities: IntegrationCapability[] }) {
  const suggestions = [
    "增加草稿保存状态：已保存、未保存、保存失败，让用户知道刷新前是否安全。",
    "增加发布前风险提示：比如敏感词、封面缺失、标题过长，能更像真实发布工具。",
    "增加平台授权清单：每个平台显示授权状态、有效期和需要的权限。",
    "增加演示数据入口：一键填入高质量样例，面试展示时更稳定。",
  ];

  return (
    <section className="page-grid">
      <article className="page-card">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Integration Research</p>
            <h2>接入预研</h2>
          </div>
          <span className="page-badge">不接真实接口，先讲清边界</span>
        </div>
        <IntegrationPanel capabilities={capabilities} />
      </article>

      <aside className="page-card side-card">
        <div className="panel-heading compact">
          <Lightbulb size={19} />
          <h2>新增建议</h2>
        </div>
        <div className="suggestion-list">
          {suggestions.map((item) => (
            <p key={item}>{item}</p>
          ))}
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
  authMode,
  authEmail,
  authPassword,
  profileNickname,
  authNotice,
  isAuthenticating,
  isUploadingAvatar,
  onAuthModeChange,
  onAuthEmailChange,
  onAuthPasswordChange,
  onProfileNicknameChange,
  onAuthSubmit,
  onSignOut,
  onProfileSave,
  onAvatarChange,
}: {
  generatedCount: number;
  publishCount: number;
  storageMode: PersistenceMode;
  authReady: boolean;
  session: Session | null;
  profile?: UserProfile;
  authMode: "sign-in" | "sign-up";
  authEmail: string;
  authPassword: string;
  profileNickname: string;
  authNotice: string;
  isAuthenticating: boolean;
  isUploadingAvatar: boolean;
  onAuthModeChange: (mode: "sign-in" | "sign-up") => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onProfileNicknameChange: (value: string) => void;
  onAuthSubmit: () => void;
  onSignOut: () => void;
  onProfileSave: () => void;
  onAvatarChange: (file?: File) => void;
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

    if (!draft.title.trim()) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "标题",
        message: "发布前需要有清楚的标题。",
      });
    }

    if (!draft.body.trim()) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "正文",
        message: "正文不能为空，否则用户看不到完整内容。",
      });
    }

    if (draft.tags.length === 0) {
      issues.push({
        platformId: draft.platformId,
        platformName: draft.platformName,
        field: "标签",
        message: "至少保留一个标签，方便平台识别内容主题。",
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
