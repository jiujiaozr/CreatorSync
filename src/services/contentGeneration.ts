import { adapterById } from "../data/platformAdapters";
import type { ContentGenerationProvider, PlatformDraft, PlatformId, SourceContent } from "../types";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const mockGenerationProvider: ContentGenerationProvider = {
  name: "Mock AI",
  async generateDrafts(input: SourceContent, platformIds: PlatformId[]) {
    await wait(680);
    return platformIds.map((platformId) => adapterById[platformId].generate(input));
  },
};

export const realApiGenerationProvider: ContentGenerationProvider = {
  name: "Real AI API",
  async generateDrafts(): Promise<PlatformDraft[]> {
    throw new Error("真实 AI API 会在第二次迭代接入，第一版先使用 Mock AI。");
  },
};
