import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { marked, Renderer } = require("marked");

const ARTICLE_WIDTH = "677px";

const theme = {
  text: "#252525",
  muted: "#6b7280",
  faint: "#eef2f7",
  border: "#d9e2ec",
  accent: "#2563eb",
  accentSoft: "#eff6ff",
  codeBg: "#0f172a",
  codeText: "#e5e7eb",
  quoteBg: "#f8fafc",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function escapeCodeLine(value = "") {
  return escapeHtml(value)
    .replaceAll("\t", "    ")
    .replace(/ {2,}/g, (spaces) => "&nbsp;".repeat(spaces.length))
    .replace(/^ /, "&nbsp;");
}

function renderCodeBlock(code = "", language = "") {
  const lang = String(language || "").trim();
  const normalized = String(code || "").replace(/\n$/, "");
  const lines = normalized.split("\n");
  const label = lang
    ? `<p style="margin:0 0 10px;padding:0;font-size:12px;line-height:1.35;color:#93c5fd;font-family:Menlo,Consolas,Monaco,'Courier New',monospace;">${escapeHtml(lang)}</p>`
    : "";
  const body = lines.map((line) => {
    const content = line ? escapeCodeLine(line) : "&nbsp;";
    return `<p style="margin:0;padding:0;min-height:20px;font-size:13px;line-height:1.65;color:${theme.codeText};font-family:Menlo,Consolas,Monaco,'Courier New',monospace;word-break:break-all;overflow-wrap:anywhere;">${content}</p>`;
  }).join("");
  return `<section data-wepub-code="true" style="margin:18px 0;padding:16px;border-radius:8px;background:${theme.codeBg};overflow:hidden;">${label}${body}</section>`;
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");
}

function titleFromMarkdown(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match) return match[1].replace(/[*_`]/g, "").trim();
  return path.basename(fallback, path.extname(fallback));
}

function fileToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  }[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${data}`;
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function svgToPngDataUri(svgPath, outDir, warnings) {
  const assetDir = path.join(outDir, "assets");
  fs.mkdirSync(assetDir, { recursive: true });

  const hash = crypto.createHash("sha256").update(svgPath).digest("hex").slice(0, 12);
  const pngPath = path.join(assetDir, `svg-${hash}.png`);

  if (!fs.existsSync(pngPath)) {
    const chrome = chromeExecutable();
    if (!chrome) {
      warnings.push(`SVG kept as data URI because Chrome was not found: ${svgPath}`);
      return fileToDataUri(svgPath);
    }

    execFileSync(chrome, [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--screenshot=" + pngPath,
      "--window-size=1400,900",
      pathToFileURL(svgPath).href,
    ], { stdio: "ignore" });
  }

  return fileToDataUri(pngPath);
}

function normalizeImageHref(href, sourceDir, outDir, warnings) {
  if (!href || /^(https?:|data:|file:)/i.test(href)) return href;

  const cleanHref = decodeURIComponent(href).replace(/^<|>$/g, "");
  const absolute = path.resolve(sourceDir, cleanHref);

  if (!fs.existsSync(absolute)) {
    warnings.push(`Image not found: ${cleanHref}`);
    return "";
  }

  if (absolute.toLowerCase().endsWith(".svg")) {
    const png = absolute.replace(/\.svg$/i, ".png");
    if (fs.existsSync(png)) return fileToDataUri(png);
    return svgToPngDataUri(absolute, outDir, warnings);
  }

  return fileToDataUri(absolute);
}

function buildNotebookMarkdownContent(content, input, outDir) {
  const nb = JSON.parse(content);
  const parts = [];
  const assetDir = path.join(outDir, "assets");
  fs.mkdirSync(assetDir, { recursive: true });

  for (const [cellIndex, cell] of (nb.cells || []).entries()) {
    let source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "");

    if (cell.cell_type === "markdown") {
      if (cell.attachments) {
        for (const [attachmentName, payload] of Object.entries(cell.attachments)) {
          const mime = Object.keys(payload || {}).find((key) => key.startsWith("image/"));
          if (!mime) continue;

          const raw = Array.isArray(payload[mime]) ? payload[mime].join("") : payload[mime];
          const safeName = attachmentName.replace(/[^\w.-]+/g, "-");
          const dest = path.join(assetDir, `cell-${cellIndex + 1}-${safeName || "attachment"}`);

          fs.writeFileSync(dest, Buffer.from(raw, "base64"));
          source = source.replaceAll(`attachment:${attachmentName}`, fileToDataUri(dest));
        }
      }

      parts.push(source.trim());
      continue;
    }

    if (cell.cell_type !== "code") continue;

    const code = source.trim();
    if (code) {
      parts.push(`\n\`\`\`python\n${code}\n\`\`\``);
    }

    for (const [outputIndex, output] of (cell.outputs || []).entries()) {
      if (output.output_type === "stream") {
        const text = Array.isArray(output.text) ? output.text.join("") : String(output.text || "");
        if (text.trim()) parts.push(`\n\`\`\`text\n${text.trim()}\n\`\`\``);
      }

      const data = output.data || {};
      const imageData = data["image/png"] || data["image/jpeg"];
      if (imageData) {
        const ext = data["image/png"] ? "png" : "jpg";
        const raw = Array.isArray(imageData) ? imageData.join("") : imageData;
        const name = `cell-${cellIndex + 1}-output-${outputIndex + 1}.${ext}`;
        const dest = path.join(assetDir, name);

        fs.writeFileSync(dest, Buffer.from(raw, "base64"));
        parts.push(`\n![notebook output](${path.relative(path.dirname(input), dest)})`);
      }
    }
  }

  return parts.filter(Boolean).join("\n\n");
}

function buildNotebookMarkdown(input, outDir) {
  return buildNotebookMarkdownContent(fs.readFileSync(input, "utf8"), input, outDir);
}

function markdownFromInput(input, outDir) {
  if (!fs.existsSync(input)) throw new Error(`Input file does not exist: ${input}`);
  if (input.toLowerCase().endsWith(".ipynb")) return buildNotebookMarkdown(input, outDir);
  return fs.readFileSync(input, "utf8");
}

function markdownFromContent(content, input, outDir) {
  if (input.toLowerCase().endsWith(".ipynb")) {
    return buildNotebookMarkdownContent(content, input, outDir);
  }
  return content;
}

function makeRenderer(sourceDir, outDir, warnings) {
  const renderer = new Renderer();
  const inline = (ctx, token) => ctx.parser.parseInline(token.tokens || []);

  renderer.heading = function (token) {
    const text = inline(this, token);
    if (token.depth === 1) {
      return `<h1 style="margin:0 0 24px;padding:0 0 18px;border-bottom:1px solid ${theme.border};font-size:25px;line-height:1.45;font-weight:700;color:${theme.text};letter-spacing:0;">${text}</h1>`;
    }
    if (token.depth === 2) {
      return `<h2 style="margin:34px 0 16px;padding:0 0 0 12px;border-left:4px solid ${theme.accent};font-size:20px;line-height:1.45;font-weight:700;color:${theme.text};letter-spacing:0;">${text}</h2>`;
    }
    if (token.depth === 3) {
      return `<h3 style="margin:28px 0 12px;font-size:17px;line-height:1.55;font-weight:700;color:${theme.text};letter-spacing:0;">${text}</h3>`;
    }
    return `<h${token.depth} style="margin:22px 0 10px;font-size:16px;line-height:1.55;font-weight:700;color:${theme.text};letter-spacing:0;">${text}</h${token.depth}>`;
  };

  renderer.paragraph = function (token) {
    if (token.tokens?.length === 1 && token.tokens[0].type === "image") {
      return inline(this, token);
    }
    return `<p style="margin:14px 0;font-size:15px;line-height:1.95;color:${theme.text};letter-spacing:0;text-align:left;">${inline(this, token)}</p>`;
  };

  renderer.strong = function (token) {
    return `<strong style="font-weight:700;color:#111827;">${inline(this, token)}</strong>`;
  };

  renderer.em = function (token) {
    return `<em style="font-style:normal;color:${theme.accent};">${inline(this, token)}</em>`;
  };

  renderer.codespan = function (token) {
    return escapeHtml(decodeHtmlEntities(token.text || ""));
  };

  renderer.code = function (token) {
    return renderCodeBlock(token.text || "", token.lang || "");
  };

  renderer.blockquote = function (token) {
    const body = marked.parse(token.text || "", { renderer: makeNestedRenderer(sourceDir, outDir, warnings) });
    return `<blockquote style="margin:18px 0;padding:12px 16px;border-left:4px solid ${theme.border};background:${theme.quoteBg};color:${theme.muted};">${body}</blockquote>`;
  };

  renderer.list = function (token) {
    const tag = token.ordered ? "ol" : "ul";
    const start = token.start ? ` start="${token.start}"` : "";
    return `<${tag}${start} style="margin:14px 0 14px 0;padding-left:24px;color:${theme.text};font-size:15px;line-height:1.9;">${token.items.map((item) => renderer.listitem(item)).join("")}</${tag}>`;
  };

  renderer.listitem = function (token) {
    const body = token.tokens?.some((item) => item.type === "list")
      ? this.parser.parse(token.tokens || [])
      : inline(this, token);
    return `<li style="margin:6px 0;padding-left:2px;font-size:15px;line-height:1.9;color:${theme.text};word-break:normal;overflow-wrap:break-word;">${body}</li>`;
  };

  renderer.image = function (token) {
    const src = normalizeImageHref(token.href, sourceDir, outDir, warnings);
    const alt = escapeHtml(token.text || "");
    if (!src) {
      const missing = escapeHtml(decodeURIComponent(token.href || ""));
      return `<figure data-wepub-missing-image="${missing}" style="margin:22px 0;padding:22px 16px;border:1px dashed ${theme.border};border-radius:6px;background:${theme.quoteBg};text-align:center;color:${theme.muted};"><span style="display:block;font-size:13px;line-height:1.6;">图片缺失：${missing}</span>${alt ? `<figcaption style="margin-top:6px;font-size:12px;line-height:1.5;">${alt}</figcaption>` : ""}</figure>`;
    }
    return `<figure style="margin:22px 0;text-align:center;"><img src="${src}" alt="${alt}" style="display:block;width:100%;max-width:100%;height:auto;margin:0 auto;border-radius:6px;"><figcaption style="margin-top:8px;font-size:12px;line-height:1.5;color:${theme.muted};">${alt}</figcaption></figure>`;
  };

  renderer.link = function (token) {
    const href = escapeHtml(token.href || "");
    return `<a href="${href}" style="color:${theme.accent};text-decoration:none;border-bottom:1px solid ${theme.accentSoft};">${inline(this, token)}</a>`;
  };

  renderer.hr = function () {
    return `<hr style="margin:28px 0;border:0;border-top:1px solid ${theme.faint};">`;
  };

  renderer.table = function (token) {
    const header = token.header.map((cell) => `<th style="padding:10px;border:1px solid ${theme.border};background:${theme.quoteBg};font-size:14px;line-height:1.6;text-align:left;color:${theme.text};font-weight:700;">${inline(this, cell)}</th>`).join("");
    const rows = token.rows.map((row) => `<tr>${row.map((cell) => `<td style="padding:10px;border:1px solid ${theme.border};font-size:14px;line-height:1.65;color:${theme.text};vertical-align:top;">${inline(this, cell)}</td>`).join("")}</tr>`).join("");
    return `<section style="margin:18px 0;overflow-x:auto;"><table style="border-collapse:collapse;width:100%;min-width:420px;">${header ? `<thead><tr>${header}</tr></thead>` : ""}<tbody>${rows}</tbody></table></section>`;
  };

  return renderer;
}

function makeNestedRenderer(sourceDir, outDir, warnings) {
  const nested = makeRenderer(sourceDir, outDir, warnings);
  nested.paragraph = function (token) {
    return `<p style="margin:6px 0;font-size:15px;line-height:1.85;color:${theme.muted};">${this.parser.parseInline(token.tokens || [])}</p>`;
  };
  return nested;
}

function renderWechatHtml(markdown, input, outDir, warnings) {
  const clean = stripFrontmatter(markdown);
  const sourceDir = path.dirname(input);
  const renderer = makeRenderer(sourceDir, outDir, warnings);
  const body = marked(clean, {
    renderer,
    gfm: true,
    breaks: false,
    mangle: false,
    headerIds: false,
  });

  return `<section data-wepub="article" style="max-width:${ARTICLE_WIDTH};margin:0 auto;padding:0 4px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif;color:${theme.text};font-size:15px;line-height:1.9;letter-spacing:0;">${body}</section>`;
}

export function fullPreviewPage(title, articleHtml) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f3f4f6; }
    .shell { max-width: 760px; margin: 0 auto; padding: 32px 18px 56px; background: #fff; min-height: 100vh; box-sizing: border-box; }
    .toolbar { position: sticky; top: 0; z-index: 3; margin: -32px -18px 28px; padding: 12px 18px; display: flex; gap: 10px; align-items: center; background: rgba(255,255,255,.94); border-bottom: 1px solid #e5e7eb; backdrop-filter: blur(8px); }
    button { border: 0; border-radius: 6px; padding: 8px 12px; background: #2563eb; color: white; font-size: 14px; cursor: pointer; }
    .hint { font-size: 13px; color: #6b7280; }
  </style>
</head>
<body>
  <main class="shell">
    <div class="toolbar">
      <button id="copy">复制富文本</button>
      <span class="hint">复制后粘贴到微信公众号草稿箱正文区域</span>
    </div>
    <article id="article">${articleHtml}</article>
  </main>
  <script>
    const button = document.getElementById('copy');
    button.addEventListener('click', async () => {
      const articleElement = document.getElementById('article');
      const article = articleElement.innerHTML;
      const text = articleElement.innerText;
      try {
        if (articleElement.querySelector('[data-wepub-missing-image]')) {
          button.textContent = '存在缺失图片，请先补充资源';
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(articleElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const copied = document.execCommand('copy');
        selection.removeAllRanges();
        if (!copied) {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([article], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' })
            })
          ]);
        }
        button.textContent = '已复制';
      } catch (error) {
        button.textContent = '复制失败，请手动选择正文复制';
        console.error(error);
      }
    });
  </script>
</body>
</html>`;
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export async function convertArticle({ input, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });

  const markdown = markdownFromInput(input, outDir);
  const result = renderArticle({ markdown, input, outDir });
  const { title, warnings, articleHtml, previewHtml } = result;
  const checksum = crypto.createHash("sha256").update(articleHtml).digest("hex").slice(0, 12);

  const articlePath = path.join(outDir, "article.html");
  const previewPath = path.join(outDir, "preview.html");
  const metaPath = path.join(outDir, "meta.json");

  fs.writeFileSync(articlePath, articleHtml, "utf8");
  fs.writeFileSync(previewPath, previewHtml, "utf8");
  writeJson(metaPath, {
    title,
    source: input,
    generatedAt: new Date().toISOString(),
    checksum,
    warnings,
    files: {
      article: articlePath,
      preview: previewPath,
    },
  });

  return {
    title,
    warnings,
    files: {
      article: articlePath,
      preview: previewPath,
      meta: metaPath,
    },
  };
}

export function renderArticle({ markdown, input = "article.md", outDir = process.cwd() }) {
  fs.mkdirSync(outDir, { recursive: true });

  const title = titleFromMarkdown(stripFrontmatter(markdown), input);
  const warnings = [];
  const articleHtml = renderWechatHtml(markdown, input, outDir, warnings);
  const previewHtml = fullPreviewPage(title, articleHtml);

  return {
    title,
    warnings,
    articleHtml,
    previewHtml,
  };
}

export function renderSource({ content, input = "article.md", outDir = process.cwd() }) {
  const markdown = markdownFromContent(content, input, outDir);
  return renderArticle({ markdown, input, outDir });
}
