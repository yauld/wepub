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
};

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
  elements.openLocalButton.disabled = true;
  elements.openLocalButton.textContent = "等待选择…";
  try {
    const result = await fetchJson("/api/open-local", { method: "POST" });

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
  } catch (error) {
    if (error.message !== "已取消选择文件") toast(error.message);
  } finally {
    elements.openLocalButton.disabled = false;
    elements.openLocalButton.textContent = "打开本地文档";
  }
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

function downloadHtml() {
  if (!state.previewHtml) return;
  const blob = new Blob([state.previewHtml], { type: "text/html;charset=utf-8" });
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
