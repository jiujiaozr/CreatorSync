# 内容开发助手 CreatorSync

内容开发助手是一个面向内容创作者的多平台发布 Demo。用户输入一份原始内容，选择公众号、知乎、B站、小红书后，系统会生成不同平台的适配文案，并支持编辑、预览和一键模拟发布。

## 当前版本

第一版重点做稳定演示，不接真实平台，也不接真实 AI API。

- 原始标题、正文、内容类型、目标受众、生成偏好输入
- 公众号、知乎、B站、小红书平台选择
- Mock AI 生成平台文案
- 每个平台生成结果可编辑
- 不同平台预览样式不同
- 一键模拟发布，展示发布中和成功状态
- 平台适配器结构，方便后续扩展抖音、视频号、微博

## 本地运行

```bash
npm install
npm run dev
```

构建检查：

```bash
npm run build
```

## 产品流程

1. 输入原始内容。
2. 选择目标平台。
3. 点击“生成平台内容”。
4. 查看并编辑各平台版本。
5. 在右侧查看平台预览。
6. 点击“模拟发布”查看发布结果。

## 平台适配架构

平台能力集中在 `PlatformAdapter` 中。每个平台单独维护生成规则、专属字段和校验逻辑。新增平台时，只需要新增一个 adapter，再接入平台列表即可，不需要重写主流程。

核心类型：

```ts
type PlatformAdapter = {
  id: PlatformId;
  name: string;
  shortName: string;
  metaFields: PlatformMetaField[];
  generate: (input: SourceContent) => PlatformDraft;
  validate: (draft: PlatformDraft) => ValidationResult;
};
```

## 第二次迭代

第二次迭代再实现真实能力：

- 接入真实 AI API，用统一的生成服务替换 Mock AI。
- 接入平台 OAuth 授权。
- 接入公众号、知乎、B站、小红书真实发布接口。
- 增加发布失败重试、发布记录和发布前字段校验。
- 增加内容历史版本和团队协作流程。

## 说明

项目本身不提供 image2 生图功能。如果开发过程中需要封面、示意图或演示素材，可以使用 image2 生成静态素材，但它不属于第一版产品功能。
