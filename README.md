# wepub

Convert local Markdown and Jupyter Notebook files into WeChat-ready article HTML.

`wepub` is a small CLI for technical writers who write in `.md` or `.ipynb` and publish to WeChat Official Account. It generates inline-style HTML plus a local preview page with one-click rich text copy.

## Features

- Markdown to WeChat-friendly HTML
- Jupyter Notebook markdown/code/output rendering
- Local images converted to data URI for stable preview
- Jupyter attachment images supported
- Inline styles for headings, paragraphs, lists, quotes, code blocks, tables, and images
- Local `preview.html` with a rich-text copy button

## Install

```bash
npm install
```

During local development, run directly:

```bash
node ./bin/wepub.mjs "/path/to/article.md" --out ./dist/article
```

Or link it as a local command:

```bash
npm link
wepub "/path/to/article.ipynb" --out ./dist/article
```

## Usage

```bash
wepub "/path/to/article.md" --out ./dist/my-article
```

Generated files:

- `article.html`: WeChat article body HTML
- `preview.html`: local preview page with a copy button
- `meta.json`: title, source file, checksum, warnings

Open `preview.html`, click `复制富文本`, then paste into the WeChat Official Account draft editor.

## Current Scope

This first version is intentionally small. It focuses on the daily publishing path:

```text
local .md/.ipynb -> inline-style HTML -> preview -> copy to WeChat draft
```

Possible next steps:

- theme configuration
- image compression and SVG-to-PNG conversion
- local preview server
- GitHub Action
- WeChat draft automation

## License

MIT
