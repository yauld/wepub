const elements = {
  openLocalButton: document.querySelector("#openLocalButton"),
  dropzone: document.querySelector("#dropzone"),
  fileMeta: document.querySelector("#fileMeta"),
  fileType: document.querySelector("#fileType"),
  fileName: document.querySelector("#fileName"),
  assetSummary: document.querySelector("#assetSummary"),
  clearButton: document.querySelector("#clearButton"),
  editor: document.querySelector("#sourceEditor"),
  editorLabel: document.querySelector("#editorLabel"),
  saveState: document.querySelector("#saveState"),
  messages: document.querySelector("#messages"),
  previewTitle: document.querySelector("#previewTitle"),
  emptyState: document.querySelector("#emptyState"),
  articleCanvas: document.querySelector("#articleCanvas"),
  articlePreview: document.querySelector("#articlePreview"),
  copyButton: document.querySelector("#copyButton"),
  downloadButton: document.querySelector("#downloadButton"),
  publishButton: document.querySelector("#publishButton"),
  settingsButton: document.querySelector("#settingsButton"),
  fileDialog: document.querySelector("#fileDialog"),
  fileBrowserForm: document.querySelector("#fileBrowserForm"),
  filePathInput: document.querySelector("#filePathInput"),
  fileHomeButton: document.querySelector("#fileHomeButton"),
  fileBrowserList: document.querySelector("#fileBrowserList"),
  fileBrowserStatus: document.querySelector("#fileBrowserStatus"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  wechatAppid: document.querySelector("#wechatAppid"),
  wechatSecret: document.querySelector("#wechatSecret"),
  connectionState: document.querySelector("#connectionState"),
  testConnectionButton: document.querySelector("#testConnectionButton"),
  publishDialog: document.querySelector("#publishDialog"),
  publishForm: document.querySelector("#publishForm"),
  draftTitle: document.querySelector("#draftTitle"),
  draftAuthor: document.querySelector("#draftAuthor"),
  draftDigest: document.querySelector("#draftDigest"),
  draftSourceUrl: document.querySelector("#draftSourceUrl"),
  draftComments: document.querySelector("#draftComments"),
  coverPicker: document.querySelector("#coverPicker"),
  coverPreview: document.querySelector("#coverPreview"),
  coverPlaceholder: document.querySelector("#coverPlaceholder"),
  coverName: document.querySelector("#coverName"),
  publishStatus: document.querySelector("#publishStatus"),
  confirmPublishButton: document.querySelector("#confirmPublishButton"),
  toast: document.querySelector("#toast"),
};

const state = {
  filename: "article.md",
  assets: [],
  articleHtml: "",
  previewHtml: "",
  renderId: 0,
  debounce: null,
  notebook: false,
  warnings: [],
  sourceToken: null,
  coverToken: null,
  wechatConfigured: false,
  fileBrowserHome: "",
};

const MERMAID_SCRIPT_URL = "/vendor/mermaid.min.js";
let mermaidScriptPromise = null;
let mermaidSequence = 0;

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function relativePath(file) {
  return file.webkitRelativePath || file._dropPath || file.name;
}

function isSource(file) {
  return /\.(md|markdown|ipynb)$/i.test(file.name);
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function basename(filePath) {
  return String(filePath).replaceAll("\\", "/").split("/").pop();
}

async function loadMermaid() {
  if (!mermaidScriptPromise) {
    mermaidScriptPromise = new Promise((resolve, reject) => {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }
      const script = document.createElement("script");
      script.src = MERMAID_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve(window.mermaid);
      script.onerror = () => reject(new Error("Mermaid runtime failed to load"));
      document.head.append(script);
    }).then((mermaid) => {
      if (!mermaid) throw new Error("Mermaid runtime failed to load");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        htmlLabels: true,
        theme: "default",
      });
      return mermaid;
    });
  }
  return mermaidScriptPromise;
}

function svgSize(svg) {
  const widthMatch = svg.match(/\bwidth="([\d.]+)(?:px)?"/i);
  const heightMatch = svg.match(/\bheight="([\d.]+)(?:px)?"/i);
  if (widthMatch && heightMatch) {
    return {
      width: Math.max(1, Math.ceil(Number(widthMatch[1]))),
      height: Math.max(1, Math.ceil(Number(heightMatch[1]))),
    };
  }

  const viewBoxMatch = svg.match(/\bviewBox="[^"]*?([\d.]+)\s+([\d.]+)"/i);
  if (viewBoxMatch) {
    return {
      width: Math.max(1, Math.ceil(Number(viewBoxMatch[1]))),
      height: Math.max(1, Math.ceil(Number(viewBoxMatch[2]))),
    };
  }

  return { width: 1200, height: 720 };
}

async function svgToPngDataUri(svg) {
  const image = new Image();
  const source = svg.startsWith("<svg") ? svg : svg.replace(/^[\s\S]*?(<svg\b)/i, "$1");
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  image.src = url;
  await image.decode();

  const size = svgSize(source);
  const scale = Math.min(2, Math.max(1, 1200 / size.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size.width * scale);
  canvas.height = Math.ceil(size.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function renderMermaidDiagrams(root = elements.articlePreview) {
  const blocks = [...root.querySelectorAll("[data-wepub-mermaid] .mermaid")];
  if (!blocks.length) return;

  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch {
    for (const block of blocks) {
      const error = block.closest("[data-wepub-mermaid]")?.querySelector("[data-wepub-mermaid-error]");
      if (error) {
        error.hidden = false;
        error.textContent = "Mermaid 加载失败，请检查网络后重试。";
      }
    }
    return;
  }

  for (const block of blocks) {
    const section = block.closest("[data-wepub-mermaid]");
    const source = block.textContent.trim();
    if (!source) continue;

    try {
      const id = `wepub-mermaid-${Date.now()}-${++mermaidSequence}`;
      const { svg } = await mermaid.render(id, source);
      const png = await svgToPngDataUri(svg);
      block.outerHTML = `<img data-wepub-mermaid-image="true" src="${png}" alt="Mermaid diagram" style="display:block;width:100%;max-width:100%;height:auto;margin:0 auto;border-radius:6px;">`;
      const error = section?.querySelector("[data-wepub-mermaid-error]");
      if (error) error.remove();
    } catch (error) {
      const message = section?.querySelector("[data-wepub-mermaid-error]");
      if (message) {
        message.hidden = false;
        message.textContent = `Mermaid 图表渲染失败：${error.message || "语法错误"}`;
      }
    }
  }

  state.articleHtml = elements.articlePreview.innerHTML;
}

function previewDocumentHtml(title, articleHtml) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f3f4f6; }
    .shell { max-width: 760px; margin: 0 auto; padding: 32px 18px 56px; background: #fff; min-height: 100vh; box-sizing: border-box; }
  </style>
</head>
<body>
  <main class="shell">
    <article>${articleHtml}</article>
  </main>
</body>
</html>`;
}

async function collectDroppedFiles(dataTransfer) {
  const entries = [...dataTransfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];

  const files = [];
  async function walk(entry, prefix = "") {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      file._dropPath = `${prefix}${file.name}`;
      files.push(file);
      return;
    }
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    } while (batch.length);
  }
  for (const entry of entries) await walk(entry);
  return files;
}

async function loadFiles(fileList) {
  const files = [...fileList];
  const source = files.find(isSource);
  if (!source) {
    if (!elements.editor.value.trim()) {
      toast("请先选择一个 Markdown 或 Notebook 文件");
      return;
    }
    const additions = await Promise.all(files.map(async (file) => ({
      path: relativePath(file),
      data: await readAsBase64(file),
    })));
    const paths = new Set(additions.map((asset) => asset.path));
    state.assets = [...state.assets.filter((asset) => !paths.has(asset.path)), ...additions];
    elements.assetSummary.textContent = `已关联 ${state.assets.length} 个资源文件`;
    toast(`已补充 ${additions.length} 个资源文件`);
    scheduleRender(0);
    return;
  }

  const sourcePath = relativePath(source);
  const commonPrefix = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) : "";
  state.filename = commonPrefix ? sourcePath.slice(commonPrefix.length) : source.name;
  state.sourceToken = null;
  state.notebook = /\.ipynb$/i.test(source.name);
  state.assets = await Promise.all(
    files.filter((file) => file !== source).map(async (file) => {
      let filePath = relativePath(file);
      if (commonPrefix && filePath.startsWith(commonPrefix)) filePath = filePath.slice(commonPrefix.length);
      return { path: filePath, data: await readAsBase64(file) };
    }),
  );

  elements.editor.value = await readAsText(source);
  elements.fileMeta.hidden = false;
  elements.fileType.textContent = state.notebook ? "IPYNB" : "MD";
  elements.fileName.textContent = source.name;
  elements.assetSummary.textContent = state.assets.length
    ? `已关联 ${state.assets.length} 个资源文件`
    : "未关联资源文件";
  elements.editorLabel.textContent = state.notebook ? "Notebook JSON" : "Markdown";
  scheduleRender(0);
}

async function openLocalDocument() {
  elements.fileDialog.showModal();
  await loadFileBrowser(elements.filePathInput.value || undefined);
}

async function loadFileBrowser(dirPath) {
  elements.fileBrowserStatus.textContent = "正在读取目录…";
  elements.fileBrowserList.replaceChildren();
  try {
    const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
    const result = await fetchJson(`/api/files${query}`);
    state.fileBrowserHome = result.home;
    elements.filePathInput.value = result.current;
    renderFileBrowser(result);
    elements.fileBrowserStatus.textContent = result.entries.length
      ? "请选择 Markdown 或 Notebook 文件"
      : "这个目录下没有可打开的文档";
  } catch (error) {
    elements.fileBrowserStatus.textContent = error.message;
  }
}

function renderFileBrowser(result) {
  const rows = [];
  if (result.parent) {
    rows.push(fileBrowserRow({
      name: "..",
      path: result.parent,
      type: "directory",
    }));
  }
  for (const entry of result.entries) rows.push(fileBrowserRow(entry));
  elements.fileBrowserList.replaceChildren(...rows);
}

function fileBrowserRow(entry) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `file-row ${entry.type}`;
  button.dataset.path = entry.path;
  button.dataset.type = entry.type;

  const icon = document.createElement("span");
  icon.className = "file-row-icon";
  icon.textContent = entry.type === "directory" ? "DIR" : "MD";

  const name = document.createElement("span");
  name.className = "file-row-name";
  name.textContent = entry.name;

  button.append(icon, name);
  button.addEventListener("click", async () => {
    if (entry.type === "directory") {
      await loadFileBrowser(entry.path);
      return;
    }
    await openLocalDocumentByPath(entry.path);
  });
  return button;
}

async function openLocalDocumentByPath(filePath) {
  const result = await fetchJson("/api/open-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  applyLocalDocument(result);
  elements.fileDialog.close();
}

function applyLocalDocument(result) {
  state.filename = result.filename;
  state.sourceToken = result.token;
  state.assets = [];
  state.notebook = /\.ipynb$/i.test(result.filename);
  elements.editor.value = result.content;
  elements.fileMeta.hidden = false;
  elements.fileType.textContent = state.notebook ? "IPYNB" : "MD";
  elements.fileName.textContent = result.filename;
  elements.assetSummary.textContent = "关联图片将从文档所在目录自动解析";
  elements.editorLabel.textContent = state.notebook ? "Notebook JSON" : "Markdown";
  scheduleRender(0);
}

async function render() {
  const content = elements.editor.value;
  if (!content.trim()) {
    resetPreview();
    elements.saveState.textContent = "等待输入";
    return;
  }

  const id = ++state.renderId;
  elements.saveState.textContent = "正在转换…";
  try {
    const result = await fetchJson("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: state.filename,
        content,
        assets: state.assets,
        sourceToken: state.sourceToken,
      }),
    });
    if (id !== state.renderId) return;

    const missingPaths = (result.warnings || [])
      .filter((warning) => warning.startsWith("Image not found:"))
      .map((warning) => warning.slice("Image not found:".length).trim());
    let remappedAsset = false;
    for (const missingPath of missingPaths) {
      const candidates = state.assets.filter((asset) => basename(asset.path) === basename(missingPath));
      if (candidates.length === 1 && candidates[0].path !== missingPath) {
        candidates[0].path = missingPath;
        remappedAsset = true;
      }
    }
    if (remappedAsset) {
      scheduleRender(0);
      return;
    }

    state.articleHtml = result.articleHtml;
    state.previewHtml = result.previewHtml;
    state.warnings = result.warnings || [];
    elements.articlePreview.innerHTML = result.articleHtml;
    await renderMermaidDiagrams();
    if (id !== state.renderId) return;
    elements.previewTitle.textContent = result.title || "公众号预览";
    elements.emptyState.hidden = true;
    elements.articleCanvas.hidden = false;
    elements.copyButton.disabled = false;
    elements.downloadButton.disabled = false;
    elements.publishButton.disabled = false;
    elements.saveState.textContent = "预览已更新";

    const warnings = state.warnings;
    elements.messages.hidden = warnings.length === 0;
    elements.messages.innerHTML = warnings.map((warning) => `<div>⚠ ${escapeHtml(warning)}</div>`).join("");
  } catch (error) {
    if (id !== state.renderId) return;
    elements.saveState.textContent = "转换失败";
    elements.messages.hidden = false;
    elements.messages.textContent = error.message;
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function scheduleRender(delay = 350) {
  clearTimeout(state.debounce);
  state.debounce = setTimeout(render, delay);
}

function resetPreview() {
  state.articleHtml = "";
  state.previewHtml = "";
  state.warnings = [];
  elements.articlePreview.replaceChildren();
  elements.previewTitle.textContent = "公众号预览";
  elements.emptyState.hidden = false;
  elements.articleCanvas.hidden = true;
  elements.copyButton.disabled = true;
  elements.downloadButton.disabled = true;
  elements.publishButton.disabled = true;
  elements.messages.hidden = true;
}

function clearAll() {
  state.filename = "article.md";
  state.assets = [];
  state.notebook = false;
  state.sourceToken = null;
  elements.editor.value = "";
  elements.fileMeta.hidden = true;
  elements.editorLabel.textContent = "Markdown";
  elements.saveState.textContent = "等待导入";
  resetPreview();
}

async function copyArticle() {
  if (!state.articleHtml) return;
  await renderMermaidDiagrams();
  const missingImages = state.warnings.filter((warning) => warning.startsWith("Image not found:"));
  if (missingImages.length) {
    elements.messages.hidden = false;
    elements.messages.scrollIntoView({ behavior: "smooth", block: "nearest" });
    toast(`还有 ${missingImages.length} 张图片未导入，请先补充资源`);
    return;
  }

  const text = elements.articlePreview.innerText;
  try {
    const range = document.createRange();
    range.selectNodeContents(elements.articlePreview);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const copied = document.execCommand("copy");
    selection.removeAllRanges();

    if (!copied) {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error("copy unavailable");
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([state.articleHtml], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    }
    toast("已复制富文本，可以粘贴到公众号");
  } catch {
    toast("浏览器未允许复制，请手动选择预览内容");
  }
}

async function downloadHtml() {
  if (!state.previewHtml) return;
  await renderMermaidDiagrams();
  const html = previewDocumentHtml(elements.previewTitle.textContent || "wepub-article", state.articleHtml);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${elements.previewTitle.textContent || "wepub-article"}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast("HTML 已下载");
}

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = element === elements.connectionState ? "connection-state" : "publish-status";
  if (type) element.classList.add(type);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let result = {};
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`${response.status} ${response.statusText || ""}：${text.slice(0, 120)}`);
    }
  }
  if (!response.ok) throw new Error(result.error || `${response.status} ${response.statusText || "请求失败"}`);
  return result;
}

async function loadWechatStatus() {
  try {
    const result = await fetchJson("/api/wechat/config/status");
    state.wechatConfigured = Boolean(result.configured);
    setStatus(
      elements.connectionState,
      result.configured ? `已配置 · AppID 尾号 ${result.appidSuffix}` : "尚未配置",
      result.configured ? "success" : "",
    );
  } catch {
    setStatus(elements.connectionState, "无法读取本地配置", "error");
  }
}

async function saveWechatConfig(event) {
  event.preventDefault();
  const submit = elements.settingsForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  setStatus(elements.connectionState, "正在保存到 Keychain…");
  try {
    const result = await fetchJson("/api/wechat/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appid: elements.wechatAppid.value,
        secret: elements.wechatSecret.value,
      }),
    });
    elements.wechatSecret.value = "";
    state.wechatConfigured = true;
    setStatus(elements.connectionState, `已安全保存 · AppID 尾号 ${result.appidSuffix}`, "success");
    toast("微信公众号凭据已保存到 Keychain");
  } catch (error) {
    setStatus(elements.connectionState, error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

async function testWechatConnection() {
  elements.testConnectionButton.disabled = true;
  setStatus(elements.connectionState, "正在连接微信官方 API…");
  try {
    await fetchJson("/api/wechat/test", { method: "POST" });
    setStatus(elements.connectionState, "连接成功，稳定版 access_token 已获取", "success");
  } catch (error) {
    setStatus(elements.connectionState, error.message, "error");
  } finally {
    elements.testConnectionButton.disabled = false;
  }
}

function openPublishDialog() {
  if (!state.wechatConfigured) {
    elements.settingsDialog.showModal();
    toast("请先配置微信公众号连接");
    return;
  }
  elements.draftTitle.value = elements.previewTitle.textContent || "";
  if (!elements.draftDigest.value) {
    elements.draftDigest.value = elements.articlePreview.innerText
      .replace(elements.draftTitle.value, "")
      .trim()
      .slice(0, 100);
  }
  setStatus(elements.publishStatus, "");
  elements.confirmPublishButton.disabled = false;
  elements.confirmPublishButton.textContent = "确认同步到草稿箱";
  elements.publishDialog.showModal();
}

function resetCoverSelection() {
  state.coverToken = null;
  elements.coverPreview.removeAttribute("src");
  elements.coverPreview.hidden = true;
  elements.coverPlaceholder.hidden = false;
  elements.coverName.textContent = "";
}

async function chooseCover() {
  elements.coverPicker.disabled = true;
  try {
    const result = await fetchJson("/api/open-cover", { method: "POST" });
    state.coverToken = result.token;
    elements.coverPreview.src = result.preview;
    elements.coverPreview.hidden = false;
    elements.coverPlaceholder.hidden = true;
    elements.coverName.textContent = result.filename;
  } catch (error) {
    if (error.message !== "已取消选择文件") setStatus(elements.publishStatus, error.message, "error");
  } finally {
    elements.coverPicker.disabled = false;
  }
}

async function publishDraft(event) {
  event.preventDefault();
  if (!state.coverToken) {
    setStatus(elements.publishStatus, "请选择封面图片", "error");
    return;
  }
  elements.confirmPublishButton.disabled = true;
  elements.confirmPublishButton.textContent = "正在同步…";
  setStatus(elements.publishStatus, "正在上传正文图片和封面，请勿关闭页面…");
  try {
    await renderMermaidDiagrams();
    const result = await fetchJson("/api/wechat/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleHtml: state.articleHtml,
        title: elements.draftTitle.value,
        author: elements.draftAuthor.value,
        digest: elements.draftDigest.value,
        contentSourceUrl: elements.draftSourceUrl.value,
        needOpenComment: elements.draftComments.checked,
        coverToken: state.coverToken,
      }),
    });
    state.coverToken = null;
    setStatus(
      elements.publishStatus,
      `草稿创建并校验成功 · 上传正文图片 ${result.uploadedImages} 张`,
      "success",
    );
    elements.confirmPublishButton.textContent = "已同步到草稿箱";
    elements.saveState.textContent = "已同步到公众号草稿箱";
    toast("草稿已进入微信公众号后台");
    setTimeout(() => {
      elements.publishDialog.close();
      elements.confirmPublishButton.disabled = false;
      elements.confirmPublishButton.textContent = "确认同步到草稿箱";
      resetCoverSelection();
      setStatus(elements.publishStatus, "");
    }, 1200);
    return;
  } catch (error) {
    setStatus(elements.publishStatus, error.message, "error");
  }
  elements.confirmPublishButton.disabled = false;
  elements.confirmPublishButton.textContent = "确认同步到草稿箱";
}

elements.openLocalButton.addEventListener("click", openLocalDocument);
elements.fileBrowserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadFileBrowser(elements.filePathInput.value);
});
elements.fileHomeButton.addEventListener("click", async () => {
  await loadFileBrowser(state.fileBrowserHome || undefined);
});
elements.editor.addEventListener("input", () => {
  if (!elements.fileMeta.hidden && state.notebook) {
    elements.saveState.textContent = "Notebook 已修改";
  }
  scheduleRender();
});
elements.clearButton.addEventListener("click", clearAll);
elements.copyButton.addEventListener("click", copyArticle);
elements.downloadButton.addEventListener("click", downloadHtml);
elements.settingsButton.addEventListener("click", () => elements.settingsDialog.showModal());
elements.settingsForm.addEventListener("submit", saveWechatConfig);
elements.testConnectionButton.addEventListener("click", testWechatConnection);
elements.publishButton.addEventListener("click", openPublishDialog);
elements.coverPicker.addEventListener("click", chooseCover);
elements.publishForm.addEventListener("submit", publishDraft);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("dragging");
  });
}
elements.dropzone.addEventListener("drop", async (event) => {
  const files = await collectDroppedFiles(event.dataTransfer);
  await loadFiles(files);
});

document.querySelectorAll(".switch-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".switch-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    elements.articleCanvas.classList.toggle("mobile", button.dataset.width === "mobile");
  });
});

loadWechatStatus();
