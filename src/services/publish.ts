import type { PlatformDraft, PublishResult } from "../types";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const simulatePublish = async (draft: PlatformDraft, retryCount = 0): Promise<PublishResult> => {
  await wait(540 + Math.random() * 460);

  if (draft.platformId === "xiaohongshu" && retryCount === 0) {
    return {
      platformId: draft.platformId,
      state: "failed",
      message: "模拟发布失败，需要补充人工复核。",
      failureReason: "小红书发布前通常需要检查封面标题和敏感词，第二次迭代先用失败状态展示异常处理。",
      publishedAt: new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }

  return {
    platformId: draft.platformId,
    state: "success",
    message: retryCount > 0 ? "重试成功，内容已进入平台发布队列。" : "模拟发布成功，内容已进入平台发布队列。",
    publishedAt: new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
};
