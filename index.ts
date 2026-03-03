/**
 * Pi Extension: Web Search & Browse via Playwright (Bing)
 *
 * Provides two tools:
 * - web_search: Search the web via Bing and return results (title, URL, snippet)
 * - web_browse: Navigate to one or more URLs in parallel and extract text content
 *
 * Usage:
 * 1. npm install in this directory
 * 2. npx playwright install chromium
 * 3. Copy/symlink to ~/.pi/agent/extensions/ or .pi/extensions/
 *    OR run: pi -e ./index.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

// ── Browser singleton ────────────────────────────────────────────────────
let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function getContext(): Promise<BrowserContext> {
  if (!context || !browser?.isConnected()) {
    if (browser?.isConnected()) await browser.close().catch(() => {});

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    });

    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });
  }
  return context;
}

async function closeBrowser(): Promise<void> {
  if (context) { await context.close().catch(() => {}); context = null; }
  if (browser) { await browser.close().catch(() => {}); browser = null; }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Decode Bing redirect URLs to get the real destination URL. */
function decodeBingUrl(href: string): string {
  try {
    const u = new URL(href);
    const realUrl = u.searchParams.get("u");
    if (realUrl && realUrl.startsWith("a1")) {
      return Buffer.from(realUrl.slice(2), "base64").toString("utf-8");
    }
  } catch {}
  return href;
}

/** Extract readable text from a page, stripping boilerplate. */
async function extractPageText(page: Page, selector?: string): Promise<string> {
  if (selector) {
    return (await page.locator(selector).first().textContent({ timeout: 5000 })) || "";
  }

  return page.evaluate(() => {
    const candidates = ["article", "main", '[role="main"]', ".post-content", ".article-content", "#content"];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 200) return el.textContent.trim();
    }
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("script, style, nav, footer, header, aside, iframe, noscript, svg, [aria-hidden='true']")
      .forEach((el) => el.remove());
    return clone.textContent?.trim() || "";
  });
}

/** Clean up extracted text whitespace. */
function cleanText(raw: string): string {
  return raw.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
}

/** Fetch a single URL and return its content. */
async function fetchUrl(
  browserCtx: BrowserContext,
  url: string,
  selector?: string,
  maxLength = 20000,
): Promise<{ url: string; title: string; content: string; truncated: boolean; error?: string }> {
  let page: Page | null = null;
  try {
    page = await browserCtx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    const title = await page.title();
    let text = cleanText(await extractPageText(page, selector));

    let truncated = false;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength);
      truncated = true;
    }

    return { url, title, content: text, truncated };
  } catch (err: any) {
    return { url, title: "", content: "", truncated: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Search result type ───────────────────────────────────────────────────
interface SearchResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

// ── Extension ────────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {

  // ─── web_search (Bing) ─────────────────────────────────────────────────
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web via Bing and return a list of results (title, URL, snippet). " +
      "Use web_browse afterwards to read the full content of any result.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      maxResults: Type.Optional(Type.Number({ description: "Max results (default 10)", minimum: 1, maximum: 20 })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate) {
      const { query, maxResults = 10 } = params;
      let page: Page | null = null;

      try {
        onUpdate?.({ content: [{ type: "text", text: `Searching for: "${query}"…` }] });

        const ctx = await getContext();
        page = await ctx.newPage();

        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        // Wait for results
        await page.waitForSelector("#b_results .b_algo", { timeout: 10000 }).catch(() => {});

        const results: SearchResult[] = await page.evaluate((max: number) => {
          const items: { position: number; title: string; url: string; snippet: string }[] = [];
          document.querySelectorAll("#b_results .b_algo").forEach((el) => {
            if (items.length >= max) return;
            const a = el.querySelector("h2 a");
            const snip = el.querySelector(".b_caption p, .b_lineclamp2");
            if (!a) return;
            const href = a.getAttribute("href") || "";
            if (!href.startsWith("http")) return;

            // Decode Bing redirect URL
            let realUrl = href;
            try {
              const u = new URL(href);
              const encoded = u.searchParams.get("u");
              if (encoded && encoded.startsWith("a1")) {
                realUrl = atob(encoded.slice(2));
              }
            } catch {}

            items.push({
              position: items.length + 1,
              title: a.textContent?.trim() || "",
              url: realUrl,
              snippet: snip?.textContent?.trim() || "",
            });
          });
          return items;
        }, maxResults);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No results found for "${query}".` }],
            details: { query, results: [] },
          };
        }

        let out = `Search results for "${query}":\n\n`;
        for (const r of results) {
          out += `${r.position}. ${r.title}\n   ${r.url}\n`;
          if (r.snippet) out += `   ${r.snippet}\n`;
          out += "\n";
        }
        out += `${results.length} result(s) found.`;

        return {
          content: [{ type: "text", text: out }],
          details: { query, resultCount: results.length, results },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error searching: ${err.message}` }],
          isError: true,
          details: { query, error: err.message },
        };
      } finally {
        if (page) await page.close().catch(() => {});
      }
    },
  });

  // ─── web_browse (single or parallel) ──────────────────────────────────
  pi.registerTool({
    name: "web_browse",
    label: "Web Browse",
    description:
      "Fetch the text content of one or more web pages. " +
      "Accepts a single URL string or an array of URLs for parallel fetching. " +
      "Use this after web_search to read the full content of results.",
    parameters: Type.Object({
      urls: Type.Union(
        [
          Type.String({ description: "A single URL" }),
          Type.Array(Type.String(), { description: "Multiple URLs to fetch in parallel" }),
        ],
        { description: "URL or array of URLs to fetch" },
      ),
      selector: Type.Optional(
        Type.String({ description: "CSS selector to narrow content (e.g. 'article', 'main', '.content')" }),
      ),
      maxLengthPerPage: Type.Optional(
        Type.Number({ description: "Max characters per page (default 20000)", minimum: 1000, maximum: 100000 }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate) {
      const urlList = Array.isArray(params.urls) ? params.urls : [params.urls];
      const { selector, maxLengthPerPage = 20000 } = params;

      try {
        onUpdate?.({
          content: [{ type: "text", text: `Fetching ${urlList.length} page(s)…` }],
        });

        const ctx = await getContext();

        // Fetch all URLs in parallel
        const results = await Promise.all(urlList.map((url) => fetchUrl(ctx, url, selector, maxLengthPerPage)));

        // Format output
        let output = "";
        for (const r of results) {
          output += `${"─".repeat(60)}\n`;
          if (r.error) {
            output += `❌ ${r.url}\n   Error: ${r.error}\n\n`;
            continue;
          }
          output += `📄 ${r.title}\n   ${r.url}\n\n`;
          output += r.content + "\n";
          if (r.truncated) {
            output += `\n[Truncated at ${maxLengthPerPage} chars]\n`;
          }
          output += "\n";
        }

        // Truncate combined output to stay within context limits
        const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
        let finalText = truncation.content;
        if (truncation.truncated) {
          finalText += `\n\n[Output truncated: ${truncation.outputLines}/${truncation.totalLines} lines, ${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}]`;
        }

        const successCount = results.filter((r) => !r.error).length;
        const errorCount = results.filter((r) => r.error).length;

        return {
          content: [{ type: "text", text: finalText }],
          details: {
            fetched: successCount,
            errors: errorCount,
            pages: results.map((r) => ({ url: r.url, title: r.title, truncated: r.truncated, error: r.error })),
          },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error fetching pages: ${err.message}` }],
          isError: true,
          details: { urls: urlList, error: err.message },
        };
      }
    },
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    await closeBrowser();
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("🔍 Web Search & Browse extension loaded!", "info");
  });
}
