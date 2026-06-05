# 互联网记忆 · 信源可信度浏览器扩展

一个**去中心化、零自建服务器**的浏览器扩展：在任意新闻正文页实时显示信源可信度信号。
评估调用**你自己的 LLM key**在客户端完成，未来通过 **Nostr** 共享社区签名存证——
全程不依赖任何 net-s-memory 服务端。

这是 net-s-memory（互联网记忆）的「插件化 / 去中心化」分支，复用其四信号可信度模型、
信源信誉种子表与可信度卡片视觉。

## 状态：Phase 1（本地即时评估）

- ✅ Readability 抽正文 → 客户端调用户 LLM key 现场评估
- ✅ 四信号打分（来源信誉 + LLM 一致性 + 多源印证占位 + 社区存证占位），镜像后端 `credibility.py`
- ✅ 内置域名信誉种子表（先验）+ 注册域后缀匹配
- ✅ 页面右下角徽章（Shadow DOM 隔离）+ 展开可信度卡片
- ✅ popup（看当前页评估）+ options（配置 LLM 协议/端点/模型/key）
- ✅ 24h 本地缓存，断网/无 key 时降级为「仅来源信誉」
- ⏳ Phase 2/3：Nostr 身份、订阅/发布签名存证、关注图谱加权
- ⏳ Phase 4：OpenTimestamps 比特币锚定

隐私：正文只发给你在设置里填写的 LLM 端点；LLM 调用只在你点开徽章面板时触发；
默认不向任何第三方广播浏览行为。

## 开发

```bash
npm install
npm run dev        # Vite + CRXJS，开发时热重载
npm run typecheck  # tsc --noEmit
npm run test       # vitest 单测
npm run build      # 产出 dist/（可加载的扩展）
```

### 在浏览器加载

1. `npm run build`
2. Chrome → 扩展程序 → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `dist/`
3. 打开扩展设置，填入你自己的 LLM key（DeepSeek / SiliconFlow / OpenAI / Anthropic 任一）
4. 打开一篇新闻正文页，右下角出现可信度徽章，点开即可评估

## 技术栈

Manifest V3 · Vite + CRXJS · React 18 + TypeScript · @mozilla/readability ·
（Phase 2+）nostr-tools · @noble/curves · opentimestamps
