# 互联网记忆 · 信源可信度浏览器扩展

一个**去中心化、零自建服务器**的浏览器扩展：在任意新闻正文页实时显示信源可信度信号。
评估调用**你自己的 LLM key**在客户端完成，未来通过 **Nostr** 共享社区签名存证——
全程不依赖任何 net-s-memory 服务端。

这是 net-s-memory（互联网记忆）的「插件化 / 去中心化」分支，复用其四信号可信度模型、
信源信誉种子表与可信度卡片视觉。

## 状态：Phase 1–3（本地评估 + Nostr P2P 协同）

- ✅ Readability 抽正文 → 客户端调用户 LLM key 现场评估
- ✅ 四信号打分（来源信誉 + LLM 一致性 + 多源印证占位 + 社区存证），镜像后端 `credibility.py`
- ✅ 内置域名信誉种子表（先验）+ 注册域后缀匹配
- ✅ 页面右下角徽章（Shadow DOM 隔离）+ 展开可信度卡片
- ✅ popup（看当前页评估）+ options（LLM key / Nostr 身份 / 中继）
- ✅ 24h 本地缓存，断网/无 key 时降级为「仅来源信誉」
- ✅ **Phase 2/3 Nostr**：secp256k1/schnorr 身份；可信度断言签名为
  参数化可替换事件（kind 30909，按归一化 URL 寻址）发布到公共中继；
  订阅他人断言、客户端验签、按 NIP-02 关注图谱加权（信任网络）
- ✅ **Phase 4 OpenTimestamps**：把评估承诺哈希提交到公共日历服务器、
  锚定到比特币；「锚定到比特币 / 刷新锚定」按钮显示区块高度。
  `.ots` 二进制格式**自研零依赖实现**（Web Crypto + fetch），并在单测里
  与官方 `opentimestamps` 库做了逐字节交叉校验（运行时不打包该库，
  避开 node crypto/fs/bitcore）。锚定证明可嵌入 Nostr 事件一并传播。
  完整无信任的比特币区块头校验交给官方验证器（界面提供链接）。
- ✅ **Phase 5 冷启动桥接**（后端，可选）：`python -m app.bridge.run` 把
  net-s-memory 已有的签名 analysis 重新发布成 Nostr 存证（用桥接身份签名），
  让新装扩展的用户一上来就能看到种子数据而非空网络。这是唯一碰后端的部分，
  完全 opt-in（不配 `NOSTR_BRIDGE_SECKEY` 就什么都不做），且 URL 归一化/寻址
  与扩展逐一对齐（见 backend/tests/test_bridge.py 的 parity 测试）。

隐私：正文只发给你在设置里填写的 LLM 端点；评估只在你点开徽章面板时触发；
**背书（发布到 Nostr）是显式操作**，默认不向任何第三方广播浏览行为。

## 开发

```bash
npm install
npm run dev        # Vite + CRXJS，开发时热重载
npm run typecheck  # tsc --noEmit
npm run test       # vitest 单测（33 个，CI 跑这个）
npm run test:it    # 起一个进程内 NIP-01 中继，跑真实 publish→query→trust 全链路
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
