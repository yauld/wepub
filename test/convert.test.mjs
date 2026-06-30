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

test("code blocks use WeChat editor safe line structure", () => {
  const result = renderArticle({
    markdown: [
      "# Code",
      "",
      "```python",
      "def hello():",
      "    return \"world\"",
      "```",
    ].join("\n"),
    input: "/tmp/code.md",
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), "wepub-test-")),
  });

  assert.match(result.articleHtml, /data-wepub-code="true"/);
  assert.doesNotMatch(result.articleHtml, /<pre\b/);
  assert.doesNotMatch(result.articleHtml, /<code\b/);
  assert.match(result.articleHtml, /def hello\(\):/);
  assert.match(result.articleHtml, /&nbsp;&nbsp;&nbsp;&nbsp;return &quot;world&quot;/);
});

test("links render with WeChat editor compatible attributes", () => {
  const result = renderArticle({
    markdown: [
      "# Links",
      "",
      "- [完整文章：MCP Transport：stdio 与 Streamable HTTP 如何传递消息](https://github.com/yauld/ai-forge/blob/main/labs/mcp/foundations/05%20%7C%20MCP%20Transport%EF%BC%9Astdio%20%E4%B8%8E%20Streamable%20HTTP%20%E5%A6%82%E4%BD%95%E4%BC%A0%E9%80%92%E6%B6%88%E6%81%AF.md)",
      "- [实验代码目录：labs/mcp/foundations/examples](https://github.com/yauld/ai-forge/tree/main/labs/mcp/foundations/examples)",
    ].join("\n"),
    input: "/tmp/links.md",
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), "wepub-test-")),
  });

  assert.match(result.articleHtml, /<a href="https:\/\/github\.com\/yauld\/ai-forge\/blob\/main\//);
  assert.match(result.articleHtml, /target="_blank"/);
  assert.match(result.articleHtml, /data-linktype="2"/);
  assert.match(result.articleHtml, /linktype="text"/);
  assert.match(result.articleHtml, /textvalue="完整文章：MCP Transport：stdio 与 Streamable HTTP 如何传递消息"/);
  assert.doesNotMatch(result.articleHtml, /\]\(https:\/\/github\.com/);
});

test("nested lists render without marked inline parser errors", () => {
  const result = renderArticle({
    markdown: [
      "# List",
      "",
      "- 外层",
      "  - 内层",
      "- 另一个外层",
    ].join("\n"),
    input: "/tmp/list.md",
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), "wepub-test-")),
  });

  assert.match(result.articleHtml, /外层/);
  assert.match(result.articleHtml, /内层/);
});
