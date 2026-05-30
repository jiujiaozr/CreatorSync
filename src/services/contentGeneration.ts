import { adapterById } from "../data/platformAdapters";
import type { ContentGenerationProvider, PlatformDraft, PlatformId, SourceContent } from "../types";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const aiApiBaseUrl = import.meta.env.VITE_AI_API_BASE_URL as string | undefined;

const joinApiUrl = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, "")}${path}`;

export const isRealApiGenerationConfigured = () => Boolean(aiApiBaseUrl?.trim());

export const mockGenerationProvider: ContentGenerationProvider = {
  name: "Mock AI",
  async generateDrafts(input: SourceContent, platformIds: PlatformId[]) {
    await wait(680);
    return platformIds.map((platformId) => adapterById[platformId].generate(input));
  },
};

export const realApiGenerationProvider: ContentGenerationProvider = {
  name: "DeepSeek",
  async generateDrafts(input: SourceContent, platformIds: PlatformId[]): Promise<PlatformDraft[]> {
    const baseUrl = aiApiBaseUrl?.trim();
    if (!baseUrl) {
      throw new Error("请先配置 VITE_AI_API_BASE_URL，才能使用 DeepSeek 真实 AI。");
    }

    const response = await fetch(joinApiUrl(baseUrl, "/api/generate"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: input, platformIds }),
    });

    const data = (await response.json().catch(() => null)) as { drafts?: PlatformDraft[]; error?: string } | null;
    if (!response.ok) {
      throw new Error(data?.error || "DeepSeek 真实 AI 调用失败，请稍后重试。");
    }

    if (!Array.isArray(data?.drafts)) {
      throw new Error("DeepSeek 返回格式不正确，暂时无法生成平台草稿。");
    }

    return data.drafts;
  },
};
