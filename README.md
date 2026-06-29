# wepub

<p align="center">
  <strong>把 Markdown 和 Jupyter Notebook，优雅地搬进微信公众号。</strong>
</p>

<p align="center">
  本地 Web 工作台 · 自动解析关联图片 · 实时预览 · 一键复制富文本
</p>

<p align="center">
  <a href="https://github.com/yauld/wepub/blob/main/LICENSE"><img src="https://img.shields.io/github/license/yauld/wepub" alt="MIT License"></a>
  <a href="https://github.com/yauld/wepub/stargazers"><img src="https://img.shields.io/github/stars/yauld/wepub?style=social" alt="GitHub stars"></a>
</p>

![wepub 本地 Web 工作台](docs/images/wepub-workspace.png)

## 为什么做 wepub？

技术文章通常写在 Markdown 或 Jupyter Notebook 里，但发布到微信公众号时，代码块、表格、图片和层级样式往往需要重新整理。

wepub 把这段重复劳动压缩成三个动作：

1. 选择一个 `.md` 或 `.ipynb` 文档；
2. 在浏览器中检查公众号效果；
3. 点击「复制到公众号」，粘贴到公众号草稿箱。

文档和图片只在本机处理，不会上传到第三方服务。

## 功能

- Markdown 转微信公众号兼容的内联样式 HTML
- Jupyter Notebook Markdown、代码、文本输出和图片输出渲染
- 根据文档真实路径自动解析 `assets/...` 等本地关联图片
- Notebook attachment 图片支持
- SVG 自动通过本地 Chrome 转换成 PNG
- 标题、段落、列表、引用、代码块、表格和图片样式
- 桌面/手机宽度实时预览
- 一键复制富文本到微信公众号编辑器
- 下载独立 HTML 预览文件
- 保留 CLI，方便脚本和自动化工作流调用

## 快速开始

环境要求：

- Node.js 18 或更高版本
- macOS（Web 工作台的原生文档选择器）
- Google Chrome 或 Chromium（仅 SVG 转 PNG 时需要）

```bash
git clone https://github.com/yauld/wepub.git
cd wepub
npm install
npm run web
```

浏览器打开 <http://127.0.0.1:4173>，点击「打开本地文档」，选择 Markdown 或 Notebook 即可。文档引用的相对图片会从文档所在目录自动解析，无需逐张上传。

### CLI

```bash
node ./bin/wepub.mjs "/path/to/article.md" --out ./dist/article
```

也可以注册为本地命令：

```bash
npm link
wepub "/path/to/notebook.ipynb" --out ./dist/article
```

输出文件：

- `article.html`：可以嵌入编辑器的文章正文
- `preview.html`：带富文本复制按钮的独立预览
- `meta.json`：标题、来源、校验值和转换警告

## 图片目录示例

```text
my-article/
├── article.ipynb
└── assets/
    ├── architecture.svg
    └── result.png
```

只需要选择 `article.ipynb`。wepub 会自动找到两张图片、处理 SVG，并将图片和正文一起渲染。

## 工作原理

```text
本地文档选择器
      │
      ▼
读取 Markdown / Notebook ──► 解析本地图片与 Notebook 输出
      │
      ▼
生成内联样式 HTML ──► 实时预览 ──► 复制到公众号 / 下载 HTML
```

Web 工作台和 CLI 共用同一套转换核心。本地服务使用 Node.js 标准 HTTP 模块，没有引入重量级 Web 框架。

## 当前边界

- Web 原生文档选择器目前优先支持 macOS；其他系统可以先使用 CLI。
- wepub 负责生成和复制富文本，不会登录公众号或直接创建草稿。
- 微信公众号编辑器可能调整粘贴规则；遇到兼容问题欢迎提交 Issue，并附上最小复现文档。

## Roadmap

- [ ] Windows / Linux 原生文档选择
- [ ] 多套公众号主题和可视化主题编辑
- [ ] 代码语法高亮
- [ ] 图片压缩与尺寸优化
- [ ] npm 安装和一键启动
- [ ] 微信公众号草稿 API 集成
- [ ] GitHub Action / 批量转换

## 参与贡献

Bug、兼容性案例、主题设计和功能建议都很欢迎。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

如果这个项目让你的发布流程轻松了一点，欢迎点一个 ⭐。它会帮助更多写技术公众号的人发现 wepub。

## License

[MIT](LICENSE)
