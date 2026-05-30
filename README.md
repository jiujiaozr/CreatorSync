# 内容开发助手 CreatorSync

内容开发助手是一个面向内容创作者的多平台发布 Demo。用户输入一份原始内容，选择公众号、知乎、B站、小红书后，系统会生成不同平台的适配文案，并支持编辑、预览和一键模拟发布。

## 当前版本

第五次迭代重点接入 DeepSeek 真实 AI。真实 AI Key 不放在前端代码里，而是通过 Vercel Serverless 后端代理调用；用户仍然可以切回 Mock AI，保证演示稳定。

- 原始标题、正文、内容类型、目标受众、生成偏好输入
- 公众号、知乎、B站、小红书平台选择
- Mock AI 或 DeepSeek 真实 AI 生成平台文案
- 每个平台生成结果可编辑
- 不同平台预览样式不同
- 一键模拟发布，展示发布中和成功状态
- Supabase 邮箱密码登录、注册和退出登录
- 登录后上传或替换头像
- 登录后保存内容方案、平台草稿和模拟发布记录
- 刷新页面后从当前账号的历史内容重新打开保存方案
- DeepSeek 调用失败时给出提示，并允许回退到 Mock AI
- 平台适配器结构，方便后续扩展抖音、视频号、微博

## 本地运行

```bash
npm install
npm run dev
```

本地开发默认打开 Vite 提示的地址，例如 `http://localhost:5173/`。如果要看一次打包后的本地预览，可以运行：

```bash
npm run preview:local
```

本地预览请打开 `http://127.0.0.1:4173/`。不要在本地预览地址后手动加 `/CreatorSync/`，这个路径只给 GitHub Pages 线上部署使用。

如果要启用第四次迭代的 Supabase 登录、头像上传和云端保存，需要在本地创建 `.env.local`：

```bash
VITE_BASE_PATH=/
VITE_SUPABASE_URL=你的 Supabase Project URL
VITE_SUPABASE_ANON_KEY=你的 Supabase anon public key
VITE_AI_API_BASE_URL=你的 Vercel 后端地址，例如 https://creatorsync-ai.vercel.app
```

如果没有配置 Supabase 的两个变量，项目会自动退回到浏览器本地保存。这样做的好处是：没有数据库时也能演示保存和打开历史内容；配置 Supabase 后，同一套界面会启用真实登录、头像上传和当前用户的数据隔离。

如果没有配置 `VITE_AI_API_BASE_URL`，Mock AI 仍然可以正常生成；选择 DeepSeek 时，页面会提示先配置真实 AI 后端。

DeepSeek 的真实 API Key 只放在 Vercel 后端环境变量里：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_MODEL=deepseek-chat
```

`DEEPSEEK_MODEL` 可以不填，默认使用 `deepseek-chat`。注意：不要把 `DEEPSEEK_API_KEY` 写入 `.env.local`、前端代码或 GitHub Pages 构建变量，因为浏览器产物会被用户看到。

GitHub Pages 上线时，还需要在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中添加同名 Secrets：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_AI_API_BASE_URL`

GitHub Actions 构建时会读取这些前端变量，并把它们打进前端产物里。线上部署还会设置 `VITE_BASE_PATH=/CreatorSync/`，保证 GitHub Pages 的子路径可以正确加载资源。

构建检查：

```bash
npm run build
```

## 技术栈与依赖说明

项目使用 React + Vite + TypeScript 构建。简单说，React 负责页面交互，Vite 负责本地开发和打包，TypeScript 帮助提前发现类型问题。

第三方依赖：

- `react`、`react-dom`：页面组件和渲染。
- `vite`、`@vitejs/plugin-react`：本地开发服务器和生产构建。
- `typescript`：代码类型检查。
- `lucide-react`：页面里的图标。
- `@supabase/supabase-js`：第四次迭代用于连接 Supabase Auth、Storage 和数据库。
- Vercel Serverless：第五次迭代用于部署 DeepSeek 后端代理，不新增前端 npm 依赖。

原创功能部分：

- 多平台内容适配规则、平台专属字段和字段校验逻辑。
- Mock AI 生成流程。
- DeepSeek 真实 AI 生成代理、前端模式切换和失败回退流程。
- 平台预览、编辑、模拟发布、发布失败重试和发布记录。
- 第四次迭代的真实账号和数据保存流程：邮箱密码登录、头像上传、保存当前内容方案、读取当前账号历史内容、重新打开草稿、持久化模拟发布记录，并在 Supabase 未配置时提供本地保存兜底。
- 真实能力预研区和迭代规划说明。

## 产品流程

1. 输入原始内容。
2. 选择目标平台。
3. 选择 Mock AI 或 DeepSeek 生成模式。
4. 点击生成按钮。
5. 查看并编辑各平台版本。
6. 在右侧查看平台预览。
7. 点击“模拟发布”查看发布结果。

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

第二次迭代先做真实能力预研，不急着把所有真实接口一次性做完：

- 预研真实 AI API 的接入方式。
- 梳理平台 OAuth 授权和真实发布 API 的限制。
- 设计发布失败重试、发布记录和发布前字段校验。
- 判断哪些能力需要后端服务，哪些能力可以继续留在前端。

## 第三次迭代：免费上线展示版

第三次迭代优先把当前 Demo 免费部署到公网。目标不是马上做复杂后端，而是先让别人拿到网址后可以直接体验作品。

推荐方案：GitHub Pages。

这样做的原因：

- 当前项目是 React + Vite 的纯前端应用，适合部署成静态网站。
- GitHub Pages 可以免费提供公开访问链接。
- 不需要购买云服务器，也不需要先搭数据库。
- Mock AI 和模拟发布都在前端完成，适合先做作品展示。

线上地址占位：

```text
https://<github-username>.github.io/<repo-name>/
```

本项目第三次迭代使用的线上地址：

```text
https://jiujiaozr.github.io/CreatorSync/
```

上线前检查清单：

- `npm run build` 可以成功执行。
- 本地主要流程可以跑通：输入内容 -> 选择平台 -> 生成 -> 编辑 -> 预览 -> 模拟发布。
- 仓库已经推送到 GitHub。
- GitHub Pages 已开启，并指向构建产物。
- 如果页面部署后空白，需要检查 Vite 的 `base` 配置是否匹配仓库名。

第三次迭代暂不做：

- 不新增数据库。
- 不新增后端服务。
- 不新增登录注册。
- 不接入真实 AI API。
- 不接入真实平台发布接口。

## 第四次迭代：后端服务增强版

第四次迭代再做数据库和后端服务。简单说，后端服务就是运行在服务器上的程序，负责处理前端不适合直接做的事情；数据库就是长期保存数据的地方。

数据库和后端服务对这个项目的好处：

- 保存内容历史：生成和编辑过的内容刷新后也能找回来。
- 保存发布记录：可以追踪每个平台发布成功、失败和重试的状态。
- 保护 AI Key：真实 AI 的密钥不能放在前端代码里，后端可以统一保管。
- 支持用户账号：以后可以区分不同创作者或团队成员。
- 支持团队协作：为编辑、审核、发布这些流程打基础。
- 支持真实平台授权：OAuth 授权和真实发布通常需要后端处理回调和令牌。

第四次迭代建议先做小闭环：

- 用户可以保存一条生成记录。
- 刷新页面后可以重新打开这条记录。
- 每个平台的发布状态可以被记录和查看。
- AI API Key 不出现在前端代码中。

## 迭代顺序说明

推荐顺序是先上线，再增强：

1. 第一版：本地可演示，完成输入、生成、编辑、预览、模拟发布闭环。
2. 第二版：预研真实 AI、真实平台授权和发布接口。
3. 第三版：免费上线展示，让别人能通过公开网址访问。
4. 第四版：增加后端和数据库，让内容不丢、接口更安全、发布过程可追踪。
5. 第五版：接入 DeepSeek 真实 AI，通过后端代理保护密钥，并保留 Mock AI 兜底。
6. 第六版：梳理真实平台接入限制，提供半自动发布清单和发布前检查。
7. 第七版：选择一个平台先打通真实 API 或真实草稿同步小闭环。
8. 第八版：把真实或半自动发布能力扩展到更多平台。

## PR 提交说明

后续新增或修改功能都应通过 PR 提交，避免直接把大量代码一次性合入主分支。

每个 PR 建议保持小范围，只做一件主要事情，并在描述里写清：

- 标题：一句话说明新增或修改了什么。
- 功能描述：说明这个功能的作用和使用方式。
- 实现思路：简要说明核心实现逻辑。
- 测试方式：说明如何验证功能可以正常运行。

当前仓库已添加 PR 描述模板，创建新 PR 时可以直接按模板填写。

## 说明

项目本身不提供 image2 生图功能。如果开发过程中需要封面、示意图或演示素材，可以使用 image2 生成静态素材，但它不属于第一版产品功能。

## 第二次迭代实现说明

本次第二次迭代已经按“真实能力预研可视化版”落地。它不直接接真实 AI 或真实平台发布接口，也不新增后端和数据库，而是在现有演示闭环里补上真实上线前必须考虑的能力。

已增加内容：

- 真实能力预研区：说明真实 AI、平台 OAuth、真实发布 API 和前端可保留能力分别由谁负责。
- 发布前字段检查：检查标题、正文、标签和平台专属字段，提示用普通话说明原因。
- 模拟发布增强：小红书会先模拟失败，用来展示失败原因、发布记录和重试流程。
- 发布记录：记录平台、状态、失败原因、时间和重试次数。
- 专业工作台页面：继续保持首页即工作台，采用浅灰背景、白色面板、细边框和克制主色。

本次仍然不做：

- 不接入真实平台发布 API。
- 不接入真实 AI API。
- 不新增登录注册、数据库或后端服务。
- 不保存刷新后的历史内容。

## 第三次迭代实现说明

本次第三次迭代以“免费上线展示”为第一优先级。仓库公开后，项目使用 GitHub Pages 自动部署，别人拿到下面这个地址就可以直接访问作品：

```text
https://jiujiaozr.github.io/CreatorSync/
```

部署方式：

- 部署平台：GitHub Pages。
- 触发方式：代码合并到 `main` 后，由 GitHub Actions 自动构建并发布。
- 构建命令：`npm run build`。
- 发布目录：`dist`。
- Vite 生产资源路径：`/CreatorSync/`，用于避免 GitHub Pages 子路径部署后页面空白或样式丢失。

上线前检查：

- 本地先运行 `npm run build`，确认构建通过。
- 本地走通主要流程：输入内容 -> 选择平台 -> 生成 -> 编辑 -> 预览 -> 模拟发布 -> 查看结果。
- 仓库公开后，在 GitHub 仓库的 Pages 设置中选择 GitHub Actions 作为部署来源。
- 部署成功后，用无登录或隐身窗口打开线上地址，确认普通访问者也能进入页面。
- 如果页面刚发布后没有立即更新，可以等待几分钟后刷新；如果页面空白，优先检查 `vite.config.ts` 里的 `base` 是否仍为 `/CreatorSync/`。

本次仍然不做：

- 不新增数据库。
- 不新增后端服务。
- 不新增登录注册。
- 不接入真实 AI API。
- 不接入真实平台发布接口。

界面上，本次只做简约大气风格的细节打磨：减少背景装饰感，统一卡片、按钮、表单和状态标签的视觉层级，让桌面端和移动端的演示流程更清楚。

## 第四次迭代实现说明

本次第四次迭代按“Supabase 真实登录 + 头像上传 + 数据保存版”落地，重点解决“用户有账号、头像可上传、刷新后内容不丢、历史记录只归当前账号”的问题。

已增加内容：

- 个人中心新增邮箱密码登录、注册和退出登录。
- 登录后可以保存昵称，并上传或替换头像。
- 工作台新增“保存当前方案”：保存原始内容、目标平台、平台草稿和模拟发布记录。
- 发布记录页新增当前账号的历史内容列表：可以从历史记录重新打开之前保存过的内容方案。
- 模拟发布或重试后，如果当前方案已经保存过，会自动更新这条方案里的发布记录。
- 新增 Supabase 登录、头像和保存服务：配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 后读写 Supabase。
- 未配置 Supabase 时自动使用浏览器本地保存，方便继续演示完整流程。
- 新增 `supabase/schema.sql`，包含 `profiles`、`content_records`、`platform_drafts`、`publish_records`，并创建 `avatars` 存储桶。

Supabase 配置方式：

1. 在 Supabase 项目中打开 SQL Editor。
2. 复制 `supabase/schema.sql` 的内容并执行。
3. 将项目的 URL 和 anon public key 填入 `.env.local`。
4. 在 Authentication 中启用 Email 登录方式。
5. 本地运行 `npm run dev`，或在 GitHub Actions Secrets 中配置同名环境变量后合并到 `main` 自动部署。

本次仍然不做：

- 不接入真实 AI。
- 不接入真实平台发布 API。
- 不做复杂团队协作审批。
- 不做计费系统。

## 第五次迭代实现说明

本次第五次迭代按“DeepSeek 真实 AI 生成版”落地，重点解决“真实 AI 可以生成，但密钥不暴露在前端”的问题。

已增加内容：

- 新增 Vercel Serverless 接口 `api/generate.js`，由后端读取 `DEEPSEEK_API_KEY` 并调用 DeepSeek。
- 工作台新增生成模式切换：`Mock AI` 和 `DeepSeek`。
- 前端通过 `VITE_AI_API_BASE_URL` 调用真实 AI 后端，生成结果继续复用现有平台草稿结构。
- DeepSeek 调用失败、后端未配置或返回格式异常时，页面会展示可理解提示，并允许改用 Mock AI。
- 真实 AI 生成后的草稿仍然可以编辑、预览、保存到历史记录，并参与模拟发布流程。

Vercel 后端配置方式：

1. 将当前仓库导入 Vercel。
2. 在 Vercel 项目的 Environment Variables 中添加 `DEEPSEEK_API_KEY`。
3. 可选添加 `DEEPSEEK_MODEL`，不填时默认使用 `deepseek-chat`。
4. 部署后，把 Vercel 域名填入前端环境变量 `VITE_AI_API_BASE_URL`。
5. GitHub Pages 线上构建时，在 GitHub Actions Secrets 中添加 `VITE_AI_API_BASE_URL`。

安全边界：

- `DEEPSEEK_API_KEY` 只放在 Vercel 后端环境变量中。
- `VITE_AI_API_BASE_URL` 只是后端接口地址，可以进入前端构建产物。
- 前端不会直接请求 DeepSeek 官方接口，也不会保存真实 AI Key。
- 本次不做 AI 额度统计、计费、团队审批或真实平台发布 API。
