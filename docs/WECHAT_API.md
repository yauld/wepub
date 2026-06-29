# 微信公众号 API 基线

最后核对：2026-06-29

wepub 的草稿同步实现以微信开发者平台中当前公众号实际显示的接口权限和以下官方文档为准：

| 能力 | 接口 | 官方文档 |
| --- | --- | --- |
| 稳定版调用凭据 | `POST /cgi-bin/stable_token` | [获取稳定版接口调用凭据](https://developers.weixin.qq.com/doc/subscription/api/base/api_getstableaccesstoken.html) |
| 上传正文图片 | `POST /cgi-bin/media/uploadimg` | [上传发表内容中的图片](https://developers.weixin.qq.com/doc/subscription/api/material/permanent/api_uploadimage.html) |
| 上传封面素材 | `POST /cgi-bin/material/add_material?type=thumb` | [上传永久素材](https://developers.weixin.qq.com/doc/subscription/api/material/permanent/api_addmaterial.html) |
| 新增草稿 | `POST /cgi-bin/draft/add` | [新增草稿](https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_add.html) |
| 校验草稿 | `POST /cgi-bin/draft/get` | [获取草稿详情](https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_getdraft.html) |

当前实现遵循的关键限制：

- 正文图片使用 `media` 表单字段，仅上传 JPG/PNG，且小于 1 MB。
- 封面使用永久素材的 `thumb` 类型，转换为小于 64 KB 的 JPG。
- 普通图文草稿显式传递 `article_type: "news"`。
- access_token 使用稳定版接口，并在本地内存中提前 5 分钟失效。
- 草稿创建成功后调用 `draft/get` 校验结果。

如果微信接口发生变化，应先更新本文件、对应实现和测试，再发布新版本。
