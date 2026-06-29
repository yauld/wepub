import path from "node:path";
import { pathToFileURL } from "node:url";
import { convertArticle } from "./convert.mjs";

function usage() {
  console.log(`Usage:
  wepub <article.md|article.ipynb> [--out dist/wechat-article]

Examples:
  wepub "/path/to/article.md"
  wepub "/path/to/notebook.ipynb" --out dist/langgraph-01
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const input = path.resolve(args[0]);
  let outDir = path.resolve(process.cwd(), "dist/wechat-article");

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--out") {
      outDir = path.resolve(args[++i]);
    }
  }

  return { input, outDir };
}

export async function runCli(argv) {
  const { input, outDir } = parseArgs(argv);
  const result = await convertArticle({ input, outDir });

  console.log(`Generated: ${result.files.preview}`);
  console.log(`Article HTML: ${result.files.article}`);
  console.log(`Title: ${result.title}`);

  if (result.warnings.length) {
    console.log("Warnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }

  console.log(`Open preview: ${pathToFileURL(result.files.preview).href}`);
}
