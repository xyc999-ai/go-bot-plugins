# Go Bot 插件

[English](README.md) · [简体中文](README.zh-CN.md)

[Go Bot](https://github.com/xyc999-ai/go-bot) 的经审核业务插件仓库。
插件安装包、图标、教程和市场清单独立发布，不再与 Controller、Host 镜像绑定。

| 插件 | 能力 |
| --- | --- |
| agent-browser | 浏览器自动化与原始上游 Skill |
| officecli | Word、PPT、Excel 处理及上游 Skills |
| x | 通过官方 CLI / MCP 使用 X |
| google-workspace | 通过 gws 使用邮件、云盘、日历与办公文档 |
| gemini-api | Google 原生 API CLI 与其原始 Agent 指令 |

## 使用

在 Go Bot 的插件市场中安装并启用插件，按需完成各插件提供的授权流程。
安装这些公开发布包不要求用户提供 GitHub 或 npm Token；用户账号凭证仍由自己的
Host 保存，不放入本仓库。

Go Bot 读取 [catalog.json](catalog.json)，通过 pnpm 安装选定版本，交给 Host 的
共享 Cordis 运行环境加载。新发布版本只提示可更新，不会自动替换已安装版本。

## 开发与发布

需要 Node.js 24.9+，发布打包还需要 Docker：

```bash
npm --prefix plugins/x ci --ignore-scripts
npm --prefix plugins/gemini-api ci --ignore-scripts
npm test
npm run check
```

每个 `plugins/<id>/` 是独立标准包。业务安装逻辑放在 package.json 的生命周期
脚本中；Cordis apply 仅检查并注册能力，停用不卸载 CLI。插件使用 Host 已提供的
框架实例，Cordis / SDK 类型放在开发依赖或可选 peer 中，不放入生产依赖。

发布时同时递增 package.json 与 plugin.json 的版本，在 GitHub Actions 中手动
运行 **Publish plugins**，选择单个插件或全部插件。工作流在隔离容器中通过官方
方式准备原始 Skills，再执行 `npm pack`，上传 `<插件>-v<版本>` Release；完整上传
成功后才更新市场清单，保留历史版本。展示文案、图标和教程取自 plugin.json。

本地预览安装包，不会发布或修改市场：

```bash
docker buildx build -f build/Dockerfile.pack \
  --build-arg PLUGIN=all --output type=local,dest=out .
```

结果位于 `out/<插件>/`，包括 tgz、展示资源及自动生成的 release.json。
生成物和打包阶段复制的上游 Skills 不进入 Git。已发布包与资源不能覆盖；需要修改
时发布新版本。若包已上传但清单未提交，可以重试工作流，工具会核对已完成的发布。

插件接口见主仓库 [SDK 文档](https://github.com/xyc999-ai/go-bot/tree/main/extensions/sdk)。
仓库采用 MIT，各插件保留上游许可和第三方声明。
