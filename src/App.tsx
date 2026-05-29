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
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  UserCircle,
  XCircle,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { adapterById, platformAdapters } from "./data/platformAdapters";
import { mockGenerationProvider } from "./services/contentGeneration";
import { simulatePublish } from "./services/publish";
import type {
  ContentType,
  IntegrationCapability,
  PlatformDraft,
  PlatformId,
  PublishAttempt,
  PublishResult,
  PublishState,
  SourceContent,
  TonePreference,
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

function App() {
  const [activeView, setActiveView] = useState<AppView>("workspace");
  const [source, setSource] = useState<SourceContent>(defaultSource);
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>(initialPlatformIds);
  const [drafts, setDrafts] = useState<Record<PlatformId, PlatformDraft | undefined>>({
    wechat: undefined,
    zhihu: undefined,
    bilibili: undefined,
    xiaohongshu: undefined,
  });
  const [activePlatform, setActivePlatform] = useState<PlatformId>("wechat");
  const [publishResults, setPublishResults] = useState<Record<PlatformId, PublishResult>>({
    wechat: emptyPublishResult("wechat"),
    zhihu: emptyPublishResult("zhihu"),
    bilibili: emptyPublishResult("bilibili"),
    xiaohongshu: emptyPublishResult("xiaohongshu"),
  });
  const [publishAttempts, setPublishAttempts] = useState<PublishAttempt[]>([]);
  const [retryCounts, setRetryCounts] = useState<Record<PlatformId, number>>({
    wechat: 0,
    zhihu: 0,
    bilibili: 0,
    xiaohongshu: 0,
  });
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
      setRetryCounts({
        wechat: 0,
        zhihu: 0,
        bilibili: 0,
        xiaohongshu: 0,
      });
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

  const publishDraft = async (draft: PlatformDraft, retryCount: number) => {
    const draftIssues = getValidationIssues([draft]);
    if (draftIssues.length > 0) {
      setError(`${draft.platformName}还有字段没有补齐：${draftIssues.map((issue) => issue.field).join("、")}。`);
      return;
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
    setPublishAttempts((current) => [
      {
        id: `${draft.platformId}-${Date.now()}`,
        platformId: draft.platformId,
        platformName: draft.platformName,
        state: result.state,
        message: result.message,
        retryCount,
        createdAt: result.publishedAt ?? new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        failureReason: result.failureReason,
      },
      ...current,
    ]);
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

    for (const draft of generatedDrafts) {
      await publishDraft(draft, retryCounts[draft.platformId]);
    }

    setIsPublishing(false);
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
    await publishDraft(draft, nextRetryCount);
    setIsPublishing(false);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="CreatorSync 内容开发助手">
          <LogoMark />
          <div>
            <p className="eyebrow">CreatorSync V2</p>
            <h1>内容开发助手</h1>
            <p className="topbar-copy">真实能力预研可视化版，不接真实接口也能讲清未来怎么落地。</p>
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
            <span><ShieldCheck size={16} /> 发布前检查</span>
          </div>
          <button className="avatar-button" type="button" onClick={() => setActiveView("profile")} aria-label="进入个人中心">
            <span className="avatar-face">CS</span>
            <span className="avatar-name">创作者</span>
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
        <RecordsPage attempts={publishAttempts} onBackToWorkspace={() => setActiveView("workspace")} />
      ) : null}

      {activeView === "integrations" ? (
        <IntegrationPage capabilities={integrationCapabilities} />
      ) : null}

      {activeView === "profile" ? (
        <ProfilePage generatedCount={generatedDrafts.length} publishCount={publishAttempts.length} />
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
  onBackToWorkspace,
}: {
  attempts: PublishAttempt[];
  onBackToWorkspace: () => void;
}) {
  return (
    <section className="page-grid records-page">
      <article className="page-card">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Publish Records</p>
            <h2>发布记录</h2>
          </div>
          <button className="secondary-action" type="button" onClick={onBackToWorkspace}>
            <Home size={16} />
            回到工作台
          </button>
        </div>
        <PublishHistory attempts={attempts} />
      </article>

      <aside className="page-card side-card">
        <div className="panel-heading compact">
          <Database size={19} />
          <h2>第四次迭代接口预留</h2>
        </div>
        <p>后端接入后，这里可以从服务端读取历史发布记录，而不是只保存当前页面里的临时状态。</p>
        <div className="api-list">
          <span>GET /api/publish-records</span>
          <span>POST /api/publish-records/:id/retry</span>
          <span>GET /api/content-drafts/:id</span>
        </div>
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
}: {
  generatedCount: number;
  publishCount: number;
}) {
  return (
    <section className="page-grid profile-page">
      <article className="page-card profile-card">
        <div className="profile-hero">
          <span className="profile-avatar">CS</span>
          <div>
            <p className="eyebrow">Personal Center</p>
            <h2>个人中心</h2>
            <p>这里先预留用户头像、昵称、账号设置和团队入口，第四次迭代接登录后直接替换为真实用户数据。</p>
          </div>
        </div>

        <div className="profile-metrics">
          <span>生成版本 <strong>{generatedCount}</strong></span>
          <span>发布记录 <strong>{publishCount}</strong></span>
          <span>账号状态 <strong>演示用户</strong></span>
        </div>
      </article>

      <aside className="page-card side-card">
        <div className="panel-heading compact">
          <Settings size={19} />
          <h2>后续可接能力</h2>
        </div>
        <div className="api-list">
          <span>头像上传</span>
          <span>账号资料编辑</span>
          <span>平台授权管理</span>
          <span>团队成员和角色</span>
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
