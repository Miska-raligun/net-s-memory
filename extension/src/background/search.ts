// "查找其他报道": run the search in the user's own browser on Google or Bing
// (no search API, no domestic search provider). A background tab is opened on
// the results page; the SERP content script (src/content/serp.ts) parses it
// and answers SERP_EXTRACT. If the engine shows a captcha / consent wall the
// tab is brought to the front so the user can deal with it.

import { buildSearchUrl, filterHits } from "../lib/search/serp";
import { getArchiveSettings } from "../lib/storage";
import type { SearchOutcome, SerpExtractRequest, SerpExtractResponse } from "../lib/messages";

const LOAD_TIMEOUT_MS = 20_000;

function waitForComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("搜索页加载超时"));
    }, LOAD_TIMEOUT_MS);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extract(tabId: number): Promise<SerpExtractResponse | null> {
  // The content script runs at document_idle; retry briefly until it answers.
  for (let i = 0; i < 10; i++) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, {
        type: "SERP_EXTRACT",
      } satisfies SerpExtractRequest)) as SerpExtractResponse | undefined;
      if (res) return res;
    } catch {
      // not injected yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function searchElsewhere(query: string, excludeUrl?: string): Promise<SearchOutcome> {
  const settings = await getArchiveSettings();
  const engine = settings.search_engine;
  const searchUrl = buildSearchUrl(engine, query);
  const tab = await chrome.tabs.create({ url: searchUrl, active: false });
  if (tab.id === undefined) throw new Error("无法打开搜索标签页");
  const tabId = tab.id;

  let res: SerpExtractResponse | null = null;
  try {
    await waitForComplete(tabId);
    res = await extract(tabId);
  } catch {
    res = null;
  }

  if (!res || res.blocked || res.hits.length === 0) {
    // Leave the tab for the user (captcha, consent screen, or simply no hits).
    await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
    throw new Error(
      res?.blocked
        ? "搜索引擎要求人工验证，已切换到搜索标签页，完成后再点一次「查找其他报道」"
        : "没有读到搜索结果，已切换到搜索标签页，你可以直接在那里查看",
    );
  }

  await chrome.tabs.remove(tabId).catch(() => undefined);
  const { hits, hiddenDomestic } = filterHits(res.hits, {
    excludeUrl,
    hideDomestic: settings.hide_domestic,
  });
  return { engine, query, search_url: searchUrl, hits, hidden_domestic: hiddenDomestic };
}
