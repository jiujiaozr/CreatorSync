import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  Megaphone,
  PenLine,
  RefreshCcw,
  Send,
  Sparkles,
  SquarePen,
  XCircle,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { adapterById, platformAdapters } from "./data/platformAdapters";
import { mockGenerationProvider } from "./services/contentGeneration";
import { simulatePublish } from "./services/publish";
import type {
  ContentType,
  PlatformDraft,
  PlatformId,
  PublishResult,
  PublishState,
  SourceContent,
  TonePreference,
} from "./types";

const contentTypes: ContentType[] = ["知识分享", "产品介绍", "活动宣传", "经验复盘"];
const preferences: TonePreference[] = ["平衡清晰", "更正式", "更口语", "更有传播感"];

const defaultSource: SourceContent = {
  title: "如何把一篇内容高效发布到多个平台",
  body: "创作者经常需要把同一份内容发布到公众号、知乎、B站、小红书等平台。\n不同平台的标题、正文结构、标签和表达方式都不一样，手动改写很容易耗时。\n如果能先生成平台版本，再统一编辑和预览，就能明显提高发布效率。",
  contentType: "知识分享",
  audience: "内容创作者",
  preference: "平衡清晰",
};

const initialPlatformIds = platformAdapters.map((adapter) => adapter.id);

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [error, setError] = useState("");

  const generatedDrafts = useMemo(
    () => platformAdapters.map((adapter) => drafts[adapter.id]).filter(Boolean) as PlatformDraft[],
    [drafts],
  );
  const activeDraft = drafts[activePlatform];
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

  const publishAll = async () => {
    if (!canPublish) {
      setError("请先生成至少一个平台版本。");
      return;
    }

    setError("");
    setShowPublishConfirm(false);
    setIsPublishing(true);

    const publishTargets = generatedDrafts.filter((draft) => {
      const validation = adapterById[draft.platformId].validate(draft);
      if (!validation.ok) {
        setError(`${draft.platformName}：${validation.message}`);
      }
      return validation.ok;
    });

    setPublishResults((current) => {
      const next = { ...current };
      publishTargets.forEach((draft) => {
        next[draft.platformId] = {
          platformId: draft.platformId,
          state: "pending",
          message: "等待发布",
        };
      });
      return next;
    });

    for (const draft of publishTargets) {
      setPublishResults((current) => ({
        ...current,
        [draft.platformId]: {
          platformId: draft.platformId,
          state: "publishing",
          message: "正在模拟提交内容",
        },
      }));

      const result = await simulatePublish(draft);
      setPublishResults((current) => ({
        ...current,
        [draft.platformId]: result,
      }));
    }

    setIsPublishing(false);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CreatorSync</p>
          <h1>内容开发助手</h1>
        </div>
        <div className="status-strip" aria-label="项目状态">
          <span><CheckCircle2 size={16} /> Mock AI</span>
          <span><Clock3 size={16} /> 第二迭代接真实接口</span>
        </div>
      </header>

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
                  <span className="choice-check">{checked ? <Check size={16} /> : null}</span>
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
              <p>输入内容并选择平台后，这里会出现不同平台的可编辑版本。</p>
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
                <PublishItem key={adapter.id} adapterId={adapter.id} result={publishResults[adapter.id]} />
              ))}
            </div>
          </div>
        </aside>
      </section>

      {showPublishConfirm ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title">
            <h2 id="publish-title">确认模拟发布</h2>
            <p>本次会把已生成的平台版本进入模拟发布流程，不会发送到真实平台。</p>
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

function PublishItem({ adapterId, result }: { adapterId: PlatformId; result: PublishResult }) {
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
    </div>
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
