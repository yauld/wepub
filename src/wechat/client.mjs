import crypto from "node:crypto";

const API_ROOT = "https://api.weixin.qq.com";

export class WechatApiError extends Error {
  constructor(message, { errcode, errmsg, endpoint } = {}) {
    super(message);
    this.name = "WechatApiError";
    this.errcode = errcode;
    this.errmsg = errmsg;
    this.endpoint = endpoint;
  }
}

function describeWechatError(data, endpoint) {
  const descriptions = {
    40001: "AppSecret 不正确或 access_token 已失效",
    40005: "上传文件格式不受微信支持",
    40007: "微信返回无效的 media_id",
    40009: "图片尺寸或文件大小超过微信限制",
    40013: "AppID 不正确",
    40125: "AppSecret 不正确",
    40164: "当前出口 IP 不在微信公众号白名单中",
    40243: "AppSecret 已被冻结，请在微信开发者平台解冻",
    41002: "请求缺少 AppID",
    41004: "请求缺少 AppSecret",
    43002: "微信接口要求使用 POST 请求",
    45009: "已达到微信接口每日调用上限",
    45011: "微信接口调用过于频繁，请稍后重试",
    53404: "公众号草稿能力未开启",
    53405: "草稿数量已达到上限",
    53406: "草稿内容不符合微信要求",
  };
  const detail = descriptions[data.errcode] || data.errmsg || "微信接口调用失败";
  return new WechatApiError(`${detail}（错误码 ${data.errcode}）`, {
    errcode: data.errcode,
    errmsg: data.errmsg,
    endpoint,
  });
}

async function parseWechatResponse(response, endpoint) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new WechatApiError(`微信接口返回了无法解析的响应（HTTP ${response.status}）`, { endpoint });
  }
  if (!response.ok) {
    throw new WechatApiError(`微信接口请求失败（HTTP ${response.status}）`, { endpoint });
  }
  if (data.errcode && data.errcode !== 0) throw describeWechatError(data, endpoint);
  return data;
}

function extensionForMime(mime) {
  return mime === "image/jpeg" ? "jpg" : "png";
}

export class WechatClient {
  constructor({ credentials, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    this.credentials = credentials;
    this.fetch = fetchImpl;
    this.now = now;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && this.token && this.now() < this.tokenExpiresAt) return this.token;

    const endpoint = "/cgi-bin/stable_token";
    const response = await this.fetch(`${API_ROOT}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: this.credentials.appid,
        secret: this.credentials.secret,
        force_refresh: forceRefresh,
      }),
    });
    const data = await parseWechatResponse(response, endpoint);
    if (!data.access_token) throw new WechatApiError("微信未返回 access_token", { endpoint });

    this.token = data.access_token;
    const expiresIn = Number(data.expires_in) || 7200;
    this.tokenExpiresAt = this.now() + Math.max(60, expiresIn - 300) * 1000;
    return this.token;
  }

  async uploadContentImage({ buffer, mime, filename }) {
    if (!["image/jpeg", "image/png"].includes(mime)) {
      throw new Error("正文图片仅支持 JPG 和 PNG");
    }
    if (buffer.length > 1024 * 1024) throw new Error("正文图片必须小于 1 MB");

    const accessToken = await this.getAccessToken();
    const endpoint = "/cgi-bin/media/uploadimg";
    const form = new FormData();
    form.append("media", new Blob([buffer], { type: mime }), filename || `image.${extensionForMime(mime)}`);
    const response = await this.fetch(
      `${API_ROOT}${endpoint}?access_token=${encodeURIComponent(accessToken)}`,
      { method: "POST", body: form },
    );
    const data = await parseWechatResponse(response, endpoint);
    if (!data.url) throw new WechatApiError("微信未返回正文图片 URL", { endpoint });
    return data.url;
  }

  async uploadCover({ buffer, filename = "cover.jpg" }) {
    if (buffer.length > 64 * 1024) throw new Error("封面缩略图必须小于 64 KB");
    const accessToken = await this.getAccessToken();
    const endpoint = "/cgi-bin/material/add_material";
    const form = new FormData();
    form.append("media", new Blob([buffer], { type: "image/jpeg" }), filename);
    const response = await this.fetch(
      `${API_ROOT}${endpoint}?access_token=${encodeURIComponent(accessToken)}&type=thumb`,
      { method: "POST", body: form },
    );
    const data = await parseWechatResponse(response, endpoint);
    if (!data.media_id) throw new WechatApiError("微信未返回封面 media_id", { endpoint });
    return data.media_id;
  }

  async addDraft(article) {
    const accessToken = await this.getAccessToken();
    const endpoint = "/cgi-bin/draft/add";
    const response = await this.fetch(
      `${API_ROOT}${endpoint}?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: [article] }),
      },
    );
    const data = await parseWechatResponse(response, endpoint);
    if (!data.media_id) throw new WechatApiError("微信未返回草稿 media_id", { endpoint });
    return data.media_id;
  }

  async getDraft(mediaId) {
    const accessToken = await this.getAccessToken();
    const endpoint = "/cgi-bin/draft/get";
    const response = await this.fetch(
      `${API_ROOT}${endpoint}?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_id: mediaId }),
      },
    );
    return parseWechatResponse(response, endpoint);
  }
}

export function decodeDataImage(src) {
  const match = String(src).match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) return null;
  return {
    mime: match[1],
    buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64"),
  };
}

export async function uploadArticleImages(articleHtml, client, { prepareImage } = {}) {
  const matches = [...String(articleHtml).matchAll(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi)];
  const replacements = new Map();
  const uploaded = new Map();

  for (const match of matches) {
    const src = match[2];
    if (replacements.has(src)) continue;
    const image = decodeDataImage(src);
    if (!image) {
      if (/^https?:\/\/mmbiz\.qpic\.cn\//i.test(src)) continue;
      throw new Error(`正文仍包含未上传到微信的图片：${src.slice(0, 80)}`);
    }

    const hash = crypto.createHash("sha256").update(image.buffer).digest("hex");
    let url = uploaded.get(hash);
    if (!url) {
      const prepared = prepareImage ? await prepareImage(image) : image;
      url = await client.uploadContentImage({
        buffer: prepared.buffer,
        mime: prepared.mime,
        filename: `wepub-${hash.slice(0, 12)}.${extensionForMime(prepared.mime)}`,
      });
      uploaded.set(hash, url);
    }
    replacements.set(src, url);
  }

  let result = String(articleHtml);
  for (const [src, url] of replacements) result = result.replaceAll(src, url);
  return { html: result, uploadedCount: uploaded.size };
}
