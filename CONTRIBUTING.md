# Contributing to wepub

感谢你愿意帮助改进 wepub。

## 提交问题

请先搜索已有 Issue。提交 Bug 时，尽量包含：

- 操作系统、Node.js 和浏览器版本
- 输入格式（Markdown 或 Notebook）
- 最小可复现文档或片段
- wepub 预览与公众号结果的截图
- 控制台或终端错误信息（请先移除隐私数据）

## 本地开发

```bash
git clone https://github.com/yauld/wepub.git
cd wepub
npm install
npm run web
```

运行测试：

```bash
npm test
```

## Pull Request

1. 从 `main` 创建功能分支。
2. 保持改动聚焦，并为转换逻辑补充测试。
3. 确认 `npm test` 和 `git diff --check` 通过。
4. 在 PR 中说明问题、实现方式、用户影响和验证结果。

涉及 UI 的改动请附上截图；涉及公众号兼容性的改动，请同时说明 wepub 预览和公众号编辑器中的结果。
