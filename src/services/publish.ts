import type { PlatformDraft, PublishResult } from "../types";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const simulatePublish = async (draft: PlatformDraft): Promise<PublishResult> => {
  await wait(540 + Math.random() * 460);

  return {
    platformId: draft.platformId,
    state: "success",
    message: "模拟发布成功，内容已进入平台发布队列。",
    publishedAt: new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
};
