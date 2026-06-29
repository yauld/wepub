import assert from "node:assert/strict";
import test from "node:test";
import {
  WechatApiError,
  WechatClient,
  uploadArticleImages,
} from "../src/wechat/client.mjs";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("uses the official stable access token endpoint and caches the token", async () => {
  const calls = [];
  const client = new WechatClient({
    credentials: { appid: "wx1234567890abcdef", secret: "a-secret-value-long-enough" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ access_token: "token-value", expires_in: 7200 });
    },
    now: () => 1_000,
  });

  assert.equal(await client.getAccessToken(), "token-value");
  assert.equal(await client.getAccessToken(), "token-value");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.weixin.qq.com/cgi-bin/stable_token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    grant_type: "client_credential",
    appid: "wx1234567890abcdef",
    secret: "a-secret-value-long-enough",
    force_refresh: false,
  });
});

test("maps official WeChat IP whitelist errors to actionable messages", async () => {
  const client = new WechatClient({
    credentials: { appid: "wx1234567890abcdef", secret: "a-secret-value-long-enough" },
    fetchImpl: async () => jsonResponse({ errcode: 40164, errmsg: "invalid ip" }),
  });

  await assert.rejects(
    () => client.getAccessToken(),
    (error) => error instanceof WechatApiError
      && error.errcode === 40164
      && error.message.includes("白名单"),
  );
});

test("uploads duplicate embedded images only once and replaces their sources", async () => {
  const uploaded = [];
  const client = {
    async uploadContentImage(image) {
      uploaded.push(image);
      return "http://mmbiz.qpic.cn/wepub-image";
    },
  };
  const src = `data:image/png;base64,${Buffer.from("image-data").toString("base64")}`;
  const result = await uploadArticleImages(
    `<section><img src="${src}"><img src="${src}"></section>`,
    client,
  );

  assert.equal(uploaded.length, 1);
  assert.equal(result.uploadedCount, 1);
  assert.equal((result.html.match(/mmbiz\.qpic\.cn/g) || []).length, 2);
  assert.doesNotMatch(result.html, /data:image/);
});

test("rejects article images that are neither embedded nor hosted by WeChat", async () => {
  await assert.rejects(
    () => uploadArticleImages('<img src="http://127.0.0.1/image.png">', {}),
    /未上传到微信/,
  );
});
