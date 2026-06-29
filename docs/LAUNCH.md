# wepub 发布传播材料

这份文档用于发布 GitHub、社交平台或技术社区时快速复用。

## 一句话介绍

wepub 是一个本地优先的微信公众号发布工作台，可以把 Markdown 和 Jupyter Notebook 转成公众号友好的富文本，并一键同步到公众号草稿箱。

## 推荐 GitHub topics

- `wechat`
- `wechat-official-account`
- `wechat-draft`
- `markdown`
- `jupyter-notebook`
- `publishing`
- `local-first`
- `rich-text`

## 短版介绍

写技术公众号时，Markdown / Notebook 到微信编辑器之间总有一段重复劳动：图片要重传、代码块会塌、表格和层级样式要重调。

wepub 把这段流程放到本地 Web 工作台里：

1. 打开 Markdown 或 Notebook；
2. 自动解析同目录图片和 Notebook 输出；
3. 实时预览公众号效果；
4. 复制富文本，或直接同步到公众号草稿箱。

AppID / AppSecret 只保存在 macOS Keychain，文章只有在确认同步时才上传到微信官方 API。

## 长版介绍

wepub 面向技术写作者、课程作者和公众号运营者。它保留本地写作流，不要求把文档上传到第三方服务；同时补上微信公众号发布链路里最烦的几件事：本地图片解析、Notebook 输出渲染、微信兼容代码块、封面压缩、正文图片上传和草稿创建。

现在的重点能力：

- Markdown / Jupyter Notebook 转微信公众号内联样式 HTML；
- 自动解析本地 `assets/` 图片、Notebook attachment 和输出图片；
- SVG 本地转换为 PNG；
- 桌面 / 手机宽度实时预览；
- 一键复制到公众号编辑器；
- 通过微信官方 API 创建公众号草稿；
- macOS Keychain 安全保存公众号开发凭据。

## 发布前截图清单

发布文章或社交动态时，优先准备：

- 主工作台截图；
- 同步草稿箱弹窗截图；
- 微信公众号草稿箱或编辑器成功截图。

详见 [SCREENSHOTS.md](SCREENSHOTS.md)。
