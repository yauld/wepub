import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { renderSource } from "./convert.mjs";
import { WechatClient, uploadArticleImages } from "./wechat/client.mjs";
import { createKeychainCredentialStore } from "./wechat/credentials.mjs";
import { prepareWechatContentImage, prepareWechatCover } from "./wechat/cover.mjs";

const require = createRequire(import.meta.url);
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const MERMAID_RUNTIME = require.resolve("mermaid/dist/mermaid.min.js");
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const localSources = new Map();
const localCovers = new Map();
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendJson(response, status, data) {
  send(response, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function hasTrustedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    return ["127.0.0.1", "localhost", "[::1]"].includes(originUrl.hostname)
      && originUrl.host === request.headers.host;
  } catch {
    return false;
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("上传内容超过 60 MB 限制");
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求内容不是有效的 JSON");
  }
}

function safeRelativePath(value, fallback) {
  const normalized = String(value || fallback)
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.join("/") || fallback;
}

function writeWorkspace(workDir, payload) {
  const sourceName = safeRelativePath(payload.filename, "article.md");
  const sourcePath = path.join(workDir, sourceName);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, String(payload.content || ""), "utf8");

  for (const asset of payload.assets || []) {
    if (!asset?.path || !asset?.data) continue;
    const assetPath = path.join(workDir, safeRelativePath(asset.path, crypto.randomUUID()));
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, Buffer.from(asset.data, "base64"));
  }

  return sourcePath;
}

function chooseLocalFile() {
  if (process.platform !== "darwin") {
    throw new Error("当前系统暂不支持原生文件选择，请拖入包含资源的整个文件夹");
  }

  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", [
      "-e",
      'POSIX path of (choose file with prompt "选择 Markdown 或 Jupyter Notebook 文档")',
    ], (error, stdout) => {
      if (error) {
        const cancelled = error.message?.includes("(-128)");
        reject(new Error(cancelled ? "已取消选择文件" : "无法打开本地文件选择器"));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function chooseCoverFile() {
  if (process.platform !== "darwin") throw new Error("当前系统暂不支持原生封面选择");
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", [
      "-e",
      'POSIX path of (choose file with prompt "选择微信公众号封面（JPG 或 PNG）" of type {"public.jpeg", "public.png"})',
    ], (error, stdout) => {
      if (error) {
        const cancelled = error.message?.includes("(-128)");
        reject(new Error(cancelled ? "已取消选择文件" : "无法打开封面选择器"));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function validateSourceFile(input) {
  const extension = path.extname(input).toLowerCase();
  if (![".md", ".markdown", ".ipynb"].includes(extension)) {
    throw new Error("仅支持 .md、.markdown 和 .ipynb 文件");
  }
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
    throw new Error("选择的文档不存在或无法读取");
  }
}

function listLocalFiles(dirPath) {
  const requested = dirPath ? String(dirPath) : os.homedir();
  const expanded = requested === "~" ? os.homedir() : requested.replace(/^~(?=\/|\\)/, os.homedir());
  const current = path.resolve(expanded);
  if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) {
    throw new Error("目录不存在或无法读取");
  }

  const entries = fs.readdirSync(current, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || /\.(md|markdown|ipynb)$/i.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(current, entry.name),
      type: entry.isDirectory() ? "directory" : "file",
    }))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true });
    });

  return {
    current,
    parent: path.dirname(current) === current ? null : path.dirname(current),
    home: os.homedir(),
    entries,
  };
}

async function openLocalRequest(response, pickFile) {
  const input = await pickFile();
  return openLocalPath(response, input);
}

async function openLocalPath(response, input) {
  validateSourceFile(input);
  const token = crypto.randomUUID();
  localSources.set(token, input);
  if (localSources.size > 100) localSources.delete(localSources.keys().next().value);

  sendJson(response, 200, {
    token,
    filename: path.basename(input),
    content: fs.readFileSync(input, "utf8"),
  });
}

async function openPathRequest(request, response) {
  const payload = await readJson(request);
  const input = String(payload.path || "").trim();
  if (!path.isAbsolute(input)) throw new Error("请输入文档的绝对路径");
  await openLocalPath(response, input);
}

function filesRequest(request, response) {
  const url = new URL(request.url, "http://localhost");
  sendJson(response, 200, listLocalFiles(url.searchParams.get("path")));
}

async function openCoverRequest(response, pickCover) {
  const input = await pickCover();
  const extension = path.extname(input).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(extension)) throw new Error("封面请选择 JPG 或 PNG 图片");
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error("封面图片不存在");
  const token = crypto.randomUUID();
  localCovers.set(token, input);
  if (localCovers.size > 100) localCovers.delete(localCovers.keys().next().value);
  const mime = extension === ".png" ? "image/png" : "image/jpeg";
  sendJson(response, 200, {
    token,
    filename: path.basename(input),
    preview: `data:${mime};base64,${fs.readFileSync(input).toString("base64")}`,
  });
}

async function renderRequest(request, response) {
  const payload = await readJson(request);
  if (!payload.filename || typeof payload.content !== "string") {
    return sendJson(response, 400, { error: "请选择 Markdown 或 Notebook 文件" });
  }

  const extension = path.extname(payload.filename).toLowerCase();
  if (![".md", ".markdown", ".ipynb"].includes(extension)) {
    return sendJson(response, 400, { error: "仅支持 .md、.markdown 和 .ipynb 文件" });
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "wepub-web-"));
  try {
    const localInput = payload.sourceToken ? localSources.get(payload.sourceToken) : null;
    const input = localInput || writeWorkspace(workDir, payload);
    const outDir = path.join(workDir, ".output");
    const result = renderSource({ content: payload.content, input, outDir });
    sendJson(response, 200, {
      title: result.title,
      warnings: result.warnings,
      articleHtml: result.articleHtml,
      previewHtml: result.previewHtml,
    });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/vendor/mermaid.min.js") {
    return send(response, 200, fs.readFileSync(MERMAID_RUNTIME), "text/javascript; charset=utf-8");
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.resolve(WEB_ROOT, requested);

  if (!file.startsWith(`${WEB_ROOT}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(response, 404, "Not found", "text/plain; charset=utf-8");
  }

  const contentType = MIME_TYPES[path.extname(file)] || "application/octet-stream";
  send(response, 200, fs.readFileSync(file), contentType);
}

export function createWebServer({
  pickFile = chooseLocalFile,
  pickCover = chooseCoverFile,
  credentialStore = createKeychainCredentialStore(),
  clientFactory = (credentials) => new WechatClient({ credentials }),
  prepareCover = prepareWechatCover,
  prepareContentImage = prepareWechatContentImage,
} = {}) {
  let wechatClient = null;
  const getWechatClient = async () => {
    if (wechatClient) return wechatClient;
    const credentials = await credentialStore.load();
    if (!credentials) throw new Error("请先配置微信公众号 AppID 和 AppSecret");
    wechatClient = clientFactory(credentials);
    return wechatClient;
  };

  return http.createServer(async (request, response) => {
    const requestPath = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`).pathname;
    try {
      if (!hasTrustedOrigin(request)) {
        sendJson(response, 403, { error: "拒绝来自非本地页面的请求" });
        return;
      }
      if (request.method === "POST" && requestPath === "/api/open-local") {
        await openLocalRequest(response, pickFile);
        return;
      }
      if (request.method === "POST" && requestPath === "/api/open-path") {
        await openPathRequest(request, response);
        return;
      }
      if (request.method === "GET" && requestPath === "/api/files") {
        filesRequest(request, response);
        return;
      }
      if (request.method === "POST" && requestPath === "/api/open-cover") {
        await openCoverRequest(response, pickCover);
        return;
      }
      if (request.method === "POST" && requestPath === "/api/render") {
        await renderRequest(request, response);
        return;
      }
      if (request.method === "GET" && requestPath === "/api/wechat/config/status") {
        sendJson(response, 200, await credentialStore.status());
        return;
      }
      if (request.method === "POST" && requestPath === "/api/wechat/config") {
        const payload = await readJson(request);
        await credentialStore.save({ appid: payload.appid, secret: payload.secret });
        wechatClient = null;
        sendJson(response, 200, await credentialStore.status());
        return;
      }
      if (request.method === "POST" && requestPath === "/api/wechat/test") {
        const client = await getWechatClient();
        await client.getAccessToken({ forceRefresh: true });
        sendJson(response, 200, { connected: true });
        return;
      }
      if (request.method === "POST" && requestPath === "/api/wechat/publish") {
        const payload = await readJson(request);
        const title = String(payload.title || "").trim();
        if (!title) throw new Error("请填写文章标题");
        if (!payload.articleHtml) throw new Error("文章内容为空");
        if (!payload.coverToken || !localCovers.has(payload.coverToken)) {
          throw new Error("请选择封面图片");
        }

        const client = await getWechatClient();
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "wepub-publish-"));
        try {
          const uploaded = await uploadArticleImages(payload.articleHtml, client, {
            prepareImage: (image) => prepareContentImage(image, workDir),
          });
          const contentSourceUrl = String(payload.contentSourceUrl || "").trim();
          const cover = await prepareCover(localCovers.get(payload.coverToken), workDir);
          const thumbMediaId = await client.uploadCover(cover);
          const mediaId = await client.addDraft({
            article_type: "news",
            title,
            author: String(payload.author || "").trim(),
            digest: String(payload.digest || "").trim(),
            content: uploaded.html,
            content_source_url: contentSourceUrl,
            thumb_media_id: thumbMediaId,
            need_open_comment: payload.needOpenComment ? 1 : 0,
            only_fans_can_comment: payload.onlyFansCanComment ? 1 : 0,
          });
          const draft = await client.getDraft(mediaId);
          const firstArticle = draft.news_item?.[0];
          if (!firstArticle || firstArticle.title !== title) {
            throw new Error("草稿已创建，但微信返回的校验结果与当前文章不一致");
          }
          localCovers.delete(payload.coverToken);
          sendJson(response, 200, {
            mediaId,
            title: firstArticle.title,
            uploadedImages: uploaded.uploadedCount,
            contentSourceUrl,
            verified: true,
          });
        } finally {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
        return;
      }
      if (request.method === "GET" || request.method === "HEAD") {
        serveStatic(request, response);
        return;
      }
      sendJson(response, 405, { error: "当前接口不支持这个请求方法，请刷新页面或重启 wepub 服务后再试" });
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: error.message || "转换失败" });
    }
  });
}

export function startWebServer({
  port = Number(process.env.PORT) || 4173,
  host = process.env.HOST || "127.0.0.1",
} = {}) {
  const server = createWebServer();
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" ? address.port : port;
    console.log(`wepub Web: http://${host}:${actualPort}`);
  });
  return server;
}
