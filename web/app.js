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
    const response = await fetch("/api/open-local", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "无法打开文档");

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
    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: state.filename,
        content,
        assets: state.assets,
        sourceToken: state.sourceToken,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "转换失败");
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
