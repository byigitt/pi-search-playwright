# 🔍 pi-search-playwright

A [pi](https://shittycodingagent.ai) extension that gives your coding agent the ability to search the web and browse pages using Playwright.

## Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web via Bing and return results (title, URL, snippet) |
| `web_browse` | Fetch the text content of one or more web pages in parallel |

## Install

```bash
# From npm
pi install npm:pi-search-playwright

# From GitHub
pi install https://github.com/byigitt/pi-search-playwright
```

### Post-install: Chromium

After installing, you need to install the Chromium browser that Playwright uses:

```bash
npx playwright install chromium
```

> This is a one-time setup. Playwright downloads a sandboxed Chromium binary (~150 MB) — it does **not** affect your system browser.

## Usage

Once installed, your pi agent will have access to two new tools:

### `web_search`

Search the web and get a list of results.

```
Search for "rust async runtime benchmarks 2026"
```

**Parameters:**
- `query` (required) — Search query string
- `maxResults` (optional) — Number of results to return (1–20, default 10)

### `web_browse`

Fetch and extract readable text from one or more URLs.

```
Browse https://docs.rs/tokio/latest/tokio/ and summarize the main concepts
```

**Parameters:**
- `urls` (required) — A single URL string or an array of URLs for parallel fetching
- `selector` (optional) — CSS selector to narrow content (e.g. `article`, `main`, `.content`)
- `maxLengthPerPage` (optional) — Max characters per page (1,000–100,000, default 20,000)

## How it works

- Launches a headless Chromium browser via Playwright
- Searches via Bing and parses result elements from the DOM
- Browses pages by navigating to URLs and extracting readable text (strips nav, footer, scripts, etc.)
- Reuses a single browser instance across calls for performance
- Automatically cleans up when the pi session ends

## License

MIT — see [LICENSE](./LICENSE). If you use this, please credit **[byigitt](https://github.com/byigitt)**.

## Author

**Barış Bayburtlu** ([@byigitt](https://github.com/byigitt))
