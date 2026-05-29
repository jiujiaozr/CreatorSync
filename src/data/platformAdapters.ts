import type { PlatformAdapter, PlatformDraft, PlatformId, SourceContent } from "../types";

const getParagraphs = (body: string) =>
  body
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

const compact = (text: string, max = 72) => {
  const source = text.replace(/\s+/g, " ").trim();
  return source.length > max ? `${source.slice(0, max)}...` : source;
};

const baseTags = (input: SourceContent) => {
  const audience = input.audience.trim() || "内容创作者";
  return [input.contentType, audience, input.preference].map((item) => item.replace(/\s+/g, ""));
};

const makeDraft = (
  platformId: PlatformId,
  platformName: string,
  input: SourceContent,
  draft: Omit<PlatformDraft, "id" | "platformId" | "platformName">,
): PlatformDraft => ({
  id: `${platformId}-${Date.now()}`,
  platformId,
  platformName,
  ...draft,
});

const validateDraft = (draft: PlatformDraft) => {
  if (!draft.title.trim()) {
    return { ok: false, message: "标题不能为空" };
  }

  if (!draft.body.trim()) {
    return { ok: false, message: "正文不能为空" };
  }

  return { ok: true };
};

export const platformAdapters: PlatformAdapter[] = [
  {
    id: "wechat",
    name: "微信公众号",
    shortName: "公众号",
    description: "适合长文、品牌表达和清晰排版",
    accent: "#1677ff",
    metaFields: [
      { key: "summary", label: "摘要", placeholder: "写给公众号列表页的短摘要" },
      { key: "ending", label: "结尾引导", placeholder: "引导读者收藏、转发或留言" },
    ],
    generate: (input) => {
      const paragraphs = getParagraphs(input.body);
      const audience = input.audience.trim() || "内容创作者";
      return makeDraft("wechat", "微信公众号", input, {
        title: `${input.title}：给${audience}的一份清晰指南`,
        subtitle: `围绕「${input.contentType}」整理重点，让读者可以快速理解并行动。`,
        body: [
          `开头：很多${audience}在处理类似主题时，真正困难的不是想法本身，而是如何把想法讲清楚、讲完整。`,
          ...paragraphs.map((paragraph, index) => `第 ${index + 1} 部分：${paragraph}`),
          "总结：把内容拆成清楚的结构，再根据平台语境表达，能明显减少重复沟通和二次修改。",
        ].join("\n\n"),
        tags: ["深度内容", "内容运营", ...baseTags(input)].slice(0, 5),
        meta: {
          summary: compact(input.body, 80),
          ending: "如果这篇内容对你有帮助，欢迎收藏并分享给正在做内容分发的朋友。",
        },
      });
    },
    validate: validateDraft,
  },
  {
    id: "zhihu",
    name: "知乎",
    shortName: "知乎",
    description: "适合问题意识、观点表达和逻辑论证",
    accent: "#0f8b8d",
    metaFields: [
      { key: "question", label: "问题", placeholder: "知乎式问题标题" },
      { key: "conclusion", label: "结论", placeholder: "开头先给出的核心观点" },
    ],
    generate: (input) => {
      const paragraphs = getParagraphs(input.body);
      return makeDraft("zhihu", "知乎", input, {
        title: `${input.title}这件事，普通创作者该怎么判断？`,
        subtitle: "先说结论：重点不是多发几个平台，而是让内容符合每个平台的阅读习惯。",
        body: [
          "我的判断是：同一份内容可以复用，但不能原样搬运。",
          ...paragraphs.map((paragraph, index) => `${index + 1}. ${paragraph}\n这部分的关键，是把事实、观点和行动建议分开表达。`),
          "最后总结：平台适配不是简单改标题，而是重新组织读者最关心的信息。",
        ].join("\n\n"),
        tags: ["内容创作", "产品思维", ...baseTags(input)].slice(0, 5),
        meta: {
          question: `${input.title}是否值得多平台同步发布？`,
          conclusion: "值得，但需要按平台重写结构和表达方式。",
        },
      });
    },
    validate: validateDraft,
  },
  {
    id: "bilibili",
    name: "B站",
    shortName: "B站",
    description: "适合视频标题、简介、标签和脚本摘要",
    accent: "#fb7299",
    metaFields: [
      { key: "category", label: "分区", placeholder: "例如 知识 / 职业职场" },
      { key: "scriptOutline", label: "脚本摘要", placeholder: "视频分段脚本" },
    ],
    generate: (input) => {
      const paragraphs = getParagraphs(input.body);
      return makeDraft("bilibili", "B站", input, {
        title: `3分钟讲清：${input.title}`,
        subtitle: `这期视频把「${input.contentType}」拆成几个容易理解的步骤，适合边看边记。`,
        body: [
          "视频简介：这期内容适合想提高内容分发效率的创作者。我们会从问题、方法和落地步骤三个角度讲清楚。",
          "时间轴：",
          "00:00 为什么多平台发布会耗时",
          "00:45 不同平台真正差在哪里",
          ...paragraphs.slice(0, 3).map((paragraph, index) => `0${index + 2}:30 ${compact(paragraph, 46)}`),
          "结尾：如果你也在做多平台内容，可以把这套流程收藏起来。",
        ].join("\n"),
        tags: ["内容运营", "创作者工具", "效率工具", ...baseTags(input)].slice(0, 6),
        meta: {
          category: "知识 / 职业职场",
          scriptOutline: ["开场痛点", "平台差异", "方法拆解", "工具演示", "总结行动"].join(" -> "),
        },
      });
    },
    validate: validateDraft,
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    shortName: "小红书",
    description: "适合口语表达、封面标题和话题标签",
    accent: "#ff4d4f",
    metaFields: [
      { key: "coverTitle", label: "封面标题", placeholder: "适合放在封面上的短标题" },
      { key: "hook", label: "开头钩子", placeholder: "第一眼吸引人的开头" },
    ],
    generate: (input) => {
      const paragraphs = getParagraphs(input.body);
      return makeDraft("xiaohongshu", "小红书", input, {
        title: `别再手动改稿了：${input.title}`,
        subtitle: "一份内容发多个平台，真的可以更省心。",
        body: [
          `开头：如果你也经常写完一篇内容，还要为不同平台改半天，这条可以先收藏。`,
          ...paragraphs.map((paragraph) => `- ${compact(paragraph, 58)}`),
          "我的建议：先准备一份原始内容，再按平台生成不同版本，最后统一检查标题、正文和标签。",
          "结尾：适合创作者、运营同学和正在准备作品集的朋友。",
        ].join("\n\n"),
        tags: ["内容创作", "自媒体运营", "效率工具", "新手博主", ...baseTags(input)].slice(0, 7),
        meta: {
          coverTitle: "一稿多发省时方法",
          hook: "写完一篇内容，却卡在多平台发布？",
        },
      });
    },
    validate: validateDraft,
  },
];

export const adapterById = platformAdapters.reduce(
  (acc, adapter) => {
    acc[adapter.id] = adapter;
    return acc;
  },
  {} as Record<PlatformId, PlatformAdapter>,
);
