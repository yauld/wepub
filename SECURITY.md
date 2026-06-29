# Security Policy

## Supported versions

安全修复目前只针对 `main` 分支的最新版本。

## Reporting a vulnerability

请不要在公开 Issue 中披露尚未修复的安全问题。使用 GitHub 仓库的
**Security → Report a vulnerability** 私下提交报告，并包含影响范围、复现步骤和建议修复方式。

wepub 默认监听 `127.0.0.1`，处理的文档不会上传到第三方服务。请不要将本地服务改为公网监听，除非你已经增加身份验证和请求来源保护。

微信公众号 AppID 和 AppSecret 通过本地页面提交后保存在 macOS Keychain 的
`wepub.wechat.credentials` 条目中。服务端不会在日志中打印凭据，配置状态接口
只返回 AppID 尾号。文章在用户明确点击「确认同步到草稿箱」后才会上传到微信官方 API。
