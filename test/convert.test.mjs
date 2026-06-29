import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { convertArticle, renderArticle } from "../src/convert.mjs";

test("renderArticle returns embeddable article and preview HTML", () => {
  const result = renderArticle({
    markdown: "# Hello\n\nA **useful** article.",
    input: "/tmp/hello.md",
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), "wepub-test-")),
  });

  assert.equal(result.title, "Hello");
  assert.match(result.articleHtml, /data-wepub="article"/);
  assert.match(result.articleHtml, /<strong/);
  assert.match(result.previewHtml, /复制富文本/);
});

test("convertArticle preserves local images as data URIs", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wepub-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "article.md");
  const image = path.join(dir, "pixel.png");
  fs.writeFileSync(input, "# Image\n\n![pixel](pixel.png)");
  fs.writeFileSync(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64"));

  const result = await convertArticle({ input, outDir: path.join(dir, "dist") });
  const html = fs.readFileSync(result.files.article, "utf8");
  assert.match(html, /data:image\/png;base64,/);
  assert.deepEqual(result.warnings, []);
});

test("missing images render as placeholders instead of localhost URLs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wepub-test-"));
  const result = renderArticle({
    markdown: "# Missing\n\n![diagram](assets/missing.svg)",
    input: path.join(dir, "article.md"),
    outDir: path.join(dir, "dist"),
  });

  assert.match(result.articleHtml, /data-wepub-missing-image/);
  assert.match(result.articleHtml, /图片缺失/);
  assert.doesNotMatch(result.articleHtml, /src="assets\/missing\.svg"/);
  assert.deepEqual(result.warnings, ["Image not found: assets/missing.svg"]);
});
