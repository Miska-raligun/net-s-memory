// Deletion / takedown page detection.
//
// Pure function over what a content script can observe: the URL, the page
// title, the visible body text, and (Chrome 109+) the navigation's HTTP
// status. No network. Platform phrases are matched anywhere on short pages;
// generic phrases ("页面不存在") only on very short pages so an article that
// merely *mentions* a deletion is not misread as deleted.

export type PageState =
  | "live"
  | "deleted" // removed by the author or platform without a stated reason
  | "censored" // removed citing rules / laws ("违规", "相关法律法规")
  | "restricted" // exists but hidden (privacy settings, login wall on the post)
  | "not_found"; // HTTP 404/410 or a generic not-found page

export type Platform = "wechat" | "weibo" | "zhihu" | "douyin" | "bilibili" | "generic";

export interface DetectInput {
  url: string;
  title: string;
  bodyText: string;
  httpStatus?: number | null;
}

export interface Detection {
  state: PageState;
  platform: Platform;
  /** The phrase or signal that triggered the verdict, for display/audit. */
  evidence: string | null;
}

interface Rule {
  phrase: string;
  state: Exclude<PageState, "live">;
}

const PLATFORM_HOSTS: [Platform, RegExp][] = [
  ["wechat", /(^|\.)mp\.weixin\.qq\.com$/],
  ["weibo", /(^|\.)(weibo\.com|weibo\.cn)$/],
  ["zhihu", /(^|\.)zhihu\.com$/],
  ["douyin", /(^|\.)douyin\.com$/],
  ["bilibili", /(^|\.)bilibili\.com$/],
];

const PLATFORM_RULES: Record<Exclude<Platform, "generic">, Rule[]> = {
  wechat: [
    { phrase: "此内容因违规无法查看", state: "censored" },
    { phrase: "此内容被投诉且经审核涉嫌侵权", state: "censored" },
    { phrase: "此帐号已被屏蔽", state: "censored" },
    { phrase: "此账号已被屏蔽", state: "censored" },
    { phrase: "该公众号已被封禁", state: "censored" },
    { phrase: "此帐号已自主注销", state: "deleted" },
    { phrase: "此账号已自主注销", state: "deleted" },
    { phrase: "该内容已被发布者删除", state: "deleted" },
    { phrase: "此内容已被发布者删除", state: "deleted" },
    { phrase: "此内容发送失败无法查看", state: "deleted" },
  ],
  weibo: [
    { phrase: "根据《微博社区公约》", state: "censored" },
    { phrase: "因违反相关法律法规", state: "censored" },
    { phrase: "此微博已被作者删除", state: "deleted" },
    { phrase: "该微博已被删除", state: "deleted" },
    { phrase: "此微博已被删除", state: "deleted" },
    { phrase: "暂时没有这条微博的查看权限", state: "restricted" },
    { phrase: "微博不存在或暂无查看权限", state: "not_found" },
  ],
  zhihu: [
    { phrase: "根据相关法律法规和政策", state: "censored" },
    { phrase: "该内容暂时无法查看", state: "censored" },
    { phrase: "该回答已被删除", state: "deleted" },
    { phrase: "该文章已被删除", state: "deleted" },
    { phrase: "该问题已被删除", state: "deleted" },
    { phrase: "你似乎来到了没有知识存在的荒原", state: "not_found" },
  ],
  douyin: [
    { phrase: "作品已失效", state: "deleted" },
    { phrase: "该作品已删除", state: "deleted" },
    { phrase: "因违反社区规定", state: "censored" },
  ],
  bilibili: [
    { phrase: "视频不见了", state: "deleted" },
    { phrase: "该视频已被删除", state: "deleted" },
    { phrase: "稿件不可见", state: "restricted" },
  ],
};

const GENERIC_RULES: Rule[] = [
  { phrase: "根据相关法律法规", state: "censored" },
  { phrase: "依据相关法律法规", state: "censored" },
  { phrase: "因违规无法查看", state: "censored" },
  { phrase: "内容已被删除", state: "deleted" },
  { phrase: "文章已被删除", state: "deleted" },
  { phrase: "该内容已删除", state: "deleted" },
  { phrase: "页面不存在", state: "not_found" },
  { phrase: "内容不存在", state: "not_found" },
  { phrase: "您访问的页面不存在", state: "not_found" },
  { phrase: "404 not found", state: "not_found" },
];

/** Platform phrases count on pages shorter than this (chars of body text). */
export const PLATFORM_MAX_CHARS = 3000;
/** Generic phrases only count on pages shorter than this. */
export const GENERIC_MAX_CHARS = 600;

export function platformOf(url: string): Platform {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "generic";
  }
  for (const [p, re] of PLATFORM_HOSTS) if (re.test(host)) return p;
  return "generic";
}

function match(rules: Rule[], haystack: string): Rule | null {
  for (const r of rules) if (haystack.includes(r.phrase.toLowerCase())) return r;
  return null;
}

export function detectPageState(input: DetectInput): Detection {
  const platform = platformOf(input.url);
  const body = input.bodyText.replace(/\s+/g, " ").trim();
  const haystack = `${input.title}\n${body}`.toLowerCase();

  if (input.httpStatus === 404 || input.httpStatus === 410) {
    return { platform, state: "not_found", evidence: `HTTP ${input.httpStatus}` };
  }

  if (platform !== "generic" && body.length < PLATFORM_MAX_CHARS) {
    const hit = match(PLATFORM_RULES[platform], haystack);
    if (hit) return { platform, state: hit.state, evidence: hit.phrase };
  }

  if (body.length < GENERIC_MAX_CHARS) {
    const hit = match(GENERIC_RULES, haystack);
    if (hit) return { platform, state: hit.state, evidence: hit.phrase };
  }

  return { platform, state: "live", evidence: null };
}

export function isGone(state: PageState): boolean {
  return state !== "live";
}

export const STATE_LABEL: Record<PageState, string> = {
  live: "在线",
  deleted: "已删除",
  censored: "因违规/法规被屏蔽",
  restricted: "已设为不可见",
  not_found: "页面不存在",
};
