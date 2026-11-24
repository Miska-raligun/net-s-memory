// "境内信源" classification for search results. Used to hide or de-prioritize
// mainland-hosted sources when looking for independent corroboration: the
// point of searching is to find reports that do not share the same
// takedown pressure as the original.

import { domainCandidates } from "../url";

const DOMESTIC_DOMAINS = new Set([
  "qq.com", "163.com", "126.net", "sina.com", "sina.cn", "sohu.com", "weibo.com", "weibo.cn",
  "zhihu.com", "baidu.com", "toutiao.com", "ixigua.com", "douyin.com", "kuaishou.com",
  "bilibili.com", "xiaohongshu.com", "douban.com", "ifeng.com", "thepaper.cn", "people.com.cn",
  "xinhuanet.com", "news.cn", "cctv.com", "cntv.cn", "chinadaily.com.cn", "huanqiu.com",
  "guancha.cn", "caixin.com", "yicai.com", "jiemian.com", "36kr.com", "bjnews.com.cn",
  "chinanews.com", "chinanews.com.cn", "gmw.cn", "youth.cn", "cnr.cn", "cri.cn", "ce.cn",
  "eastday.com", "kankanews.com", "163yun.com", "csdn.net", "jianshu.com", "sogou.com",
  "so.com", "360.cn", "hupu.com", "zol.com.cn", "tencent.com", "alibaba.com", "aliyun.com",
  "taobao.com", "jd.com", "bytedance.com", "dzwww.com", "rednet.cn", "southcn.com",
  "nfnews.com", "ynet.com", "cqnews.net", "hebnews.cn", "zjol.com.cn", "sznews.com",
]);

export function isDomestic(domain: string): boolean {
  const d = domain.toLowerCase();
  if (d === "cn" || d.endsWith(".cn")) return true;
  return domainCandidates(d).some((c) => DOMESTIC_DOMAINS.has(c));
}
