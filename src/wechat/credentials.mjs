import { execFile } from "node:child_process";

const SERVICE = "wepub.wechat.credentials";
const ACCOUNT = "default";

function runSecurity(args) {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/security", args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function validateCredentials(credentials) {
  const appid = String(credentials?.appid || "").trim();
  const secret = String(credentials?.secret || "").trim();
  if (!/^wx[a-zA-Z0-9]{10,}$/.test(appid)) throw new Error("AppID 格式不正确");
  if (secret.length < 16) throw new Error("AppSecret 格式不正确");
  return { appid, secret };
}

export function createKeychainCredentialStore({ run = runSecurity } = {}) {
  return {
    async load() {
      if (process.platform !== "darwin") {
        throw new Error("安全凭据存储目前仅支持 macOS Keychain");
      }
      try {
        const raw = await run([
          "find-generic-password",
          "-a", ACCOUNT,
          "-s", SERVICE,
          "-w",
        ]);
        return validateCredentials(JSON.parse(raw.trim()));
      } catch (error) {
        if (error?.code === 44 || /could not be found/i.test(error?.stderr || "")) return null;
        if (error instanceof SyntaxError) throw new Error("Keychain 中的微信公众号配置已损坏");
        throw error;
      }
    },

    async save(credentials) {
      if (process.platform !== "darwin") {
        throw new Error("安全凭据存储目前仅支持 macOS Keychain");
      }
      const value = JSON.stringify(validateCredentials(credentials));
      await run([
        "add-generic-password",
        "-U",
        "-a", ACCOUNT,
        "-s", SERVICE,
        "-l", "wepub 微信公众号开发凭据",
        "-w", value,
      ]);
    },

    async status() {
      const credentials = await this.load();
      return {
        configured: Boolean(credentials),
        appidSuffix: credentials ? credentials.appid.slice(-6) : "",
      };
    },
  };
}

export function createMemoryCredentialStore(initial = null) {
  let credentials = initial ? validateCredentials(initial) : null;
  return {
    async load() {
      return credentials;
    },
    async save(value) {
      credentials = validateCredentials(value);
    },
    async status() {
      return {
        configured: Boolean(credentials),
        appidSuffix: credentials ? credentials.appid.slice(-6) : "",
      };
    },
  };
}
