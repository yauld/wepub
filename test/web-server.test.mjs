import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWebServer } from "../src/web-server.mjs";
import { createMemoryCredentialStore } from "../src/wechat/credentials.mjs";

async function withServer(t) {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test("serves the Web workspace", async (t) => {
  const base = await withServer(t);
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /公众号文章工作台/);
});

test("renders Markdown through the API", async (t) => {
  const base = await withServer(t);
  const response = await fetch(`${base}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "demo.md",
      content: "# Web works\n\nHello from **wepub**.",
      assets: [],
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.title, "Web works");
  assert.match(result.articleHtml, /Hello from/);
});

test("accepts related image assets from the Web client", async (t) => {
  const base = await withServer(t);
  const response = await fetch(`${base}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "demo.md",
      content: "# Image\n\n![pixel](assets/pixel.png)",
      assets: [{
        path: "assets/pixel.png",
        data: Buffer.from("small-image-fixture").toString("base64"),
      }],
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.match(result.articleHtml, /data:image\/png;base64,/);
  assert.deepEqual(result.warnings, []);
});

test("opens a local document and resolves its sibling assets automatically", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wepub-local-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "article.md");
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(input, "# Local\n\n![diagram](assets/diagram.png)");
  fs.writeFileSync(path.join(dir, "assets/diagram.png"), "image-fixture");

  const server = createWebServer({ pickFile: async () => input });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const openResponse = await fetch(`${base}/api/open-local`, { method: "POST" });
  const opened = await openResponse.json();
  assert.equal(opened.filename, "article.md");

  const renderResponse = await fetch(`${base}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: opened.filename,
      content: opened.content,
      sourceToken: opened.token,
      assets: [],
    }),
  });
  const rendered = await renderResponse.json();
  assert.equal(renderResponse.status, 200);
  assert.match(rendered.articleHtml, /data:image\/png;base64,/);
  assert.deepEqual(rendered.warnings, []);
});

test("rejects browser requests from non-local origins", async (t) => {
  const base = await withServer(t);
  const response = await fetch(`${base}/api/open-local`, {
    method: "POST",
    headers: { Origin: "https://example.com" },
  });
  assert.equal(response.status, 403);
});

test("saves config and tests the WeChat connection without exposing credentials", async (t) => {
  const credentialStore = createMemoryCredentialStore();
  let tokenRequested = false;
  const server = createWebServer({
    credentialStore,
    clientFactory: () => ({
      async getAccessToken() {
        tokenRequested = true;
        return "access-token";
      },
    }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const saveResponse = await fetch(`${base}/api/wechat/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appid: "wx1234567890abcdef",
      secret: "a-secret-value-long-enough",
    }),
  });
  const saved = await saveResponse.json();
  assert.deepEqual(saved, { configured: true, appidSuffix: "abcdef" });
  assert.equal(JSON.stringify(saved).includes("secret"), false);

  const testResponse = await fetch(`${base}/api/wechat/test`, { method: "POST" });
  assert.equal(testResponse.status, 200);
  assert.equal(tokenRequested, true);
});

test("uploads article images and verifies a newly created draft", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wepub-cover-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const coverPath = path.join(dir, "cover.png");
  fs.writeFileSync(coverPath, "cover-source");
  let draftedArticle;
  const client = {
    async uploadContentImage() {
      return "http://mmbiz.qpic.cn/wepub-content";
    },
    async uploadCover() {
      return "thumb-media-id";
    },
    async addDraft(article) {
      draftedArticle = article;
      return "draft-media-id";
    },
    async getDraft() {
      return { news_item: [{ title: draftedArticle.title, content: draftedArticle.content }] };
    },
  };
  const server = createWebServer({
    pickCover: async () => coverPath,
    credentialStore: createMemoryCredentialStore({
      appid: "wx1234567890abcdef",
      secret: "a-secret-value-long-enough",
    }),
    clientFactory: () => client,
    prepareCover: async () => ({
      buffer: Buffer.from("small-jpeg"),
      filename: "cover.jpg",
    }),
    prepareContentImage: async (image) => image,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const coverResponse = await fetch(`${base}/api/open-cover`, { method: "POST" });
  const cover = await coverResponse.json();
  const imageSrc = `data:image/png;base64,${Buffer.from("article-image").toString("base64")}`;
  const publishResponse = await fetch(`${base}/api/wechat/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articleHtml: `<section><img src="${imageSrc}"></section>`,
      title: "Verified draft",
      coverToken: cover.token,
    }),
  });
  const published = await publishResponse.json();

  assert.equal(publishResponse.status, 200);
  assert.equal(published.mediaId, "draft-media-id");
  assert.equal(published.verified, true);
  assert.equal(published.uploadedImages, 1);
  assert.equal(draftedArticle.article_type, "news");
  assert.equal(draftedArticle.thumb_media_id, "thumb-media-id");
  assert.match(draftedArticle.content, /mmbiz\.qpic\.cn/);
});
