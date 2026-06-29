import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const MAX_THUMB_BYTES = 64 * 1024;

function runSips(args) {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/sips", args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export async function prepareWechatCover(input, outDir, { run = runSips } = {}) {
  if (process.platform !== "darwin") throw new Error("封面自动转换目前仅支持 macOS");
  if (!fs.existsSync(input)) throw new Error("封面图片不存在");
  if (![".jpg", ".jpeg", ".png"].includes(path.extname(input).toLowerCase())) {
    throw new Error("封面请选择 JPG 或 PNG 图片");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const output = path.join(outDir, "wechat-cover.jpg");
  const attempts = [
    { size: 900, quality: 72 },
    { size: 720, quality: 60 },
    { size: 600, quality: 48 },
    { size: 480, quality: 38 },
  ];

  for (const attempt of attempts) {
    await run([
      "-s", "format", "jpeg",
      "-s", "formatOptions", String(attempt.quality),
      "-Z", String(attempt.size),
      input,
      "--out", output,
    ]);
    const buffer = fs.readFileSync(output);
    if (buffer.length <= MAX_THUMB_BYTES) {
      return { buffer, filename: "wepub-cover.jpg" };
    }
  }

  throw new Error("封面压缩后仍超过微信 64 KB 限制，请选择更简单的图片");
}

export async function prepareWechatContentImage(image, outDir, { run = runSips } = {}) {
  if (["image/png", "image/jpeg"].includes(image.mime) && image.buffer.length <= 1024 * 1024) {
    return image;
  }
  if (process.platform !== "darwin") {
    throw new Error("正文大图和 WebP/GIF 自动转换目前仅支持 macOS");
  }

  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  }[image.mime];
  if (!extension) throw new Error(`不支持的正文图片格式：${image.mime}`);

  fs.mkdirSync(outDir, { recursive: true });
  const hash = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const input = path.join(outDir, `content-${hash}.${extension}`);
  const output = path.join(outDir, `content-${hash}.jpg`);
  fs.writeFileSync(input, image.buffer);

  for (const quality of [78, 65, 52]) {
    await run([
      "-s", "format", "jpeg",
      "-s", "formatOptions", String(quality),
      "-Z", "1600",
      input,
      "--out", output,
    ]);
    const buffer = fs.readFileSync(output);
    if (buffer.length <= 1024 * 1024) return { mime: "image/jpeg", buffer };
  }
  throw new Error("正文图片压缩后仍超过微信 1 MB 限制");
}
