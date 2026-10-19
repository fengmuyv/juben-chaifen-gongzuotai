# AI 段 · emotion.design（L1 策略，非 L0 判据）

> 由 `src/platforms/minimax-h3/director.ts` 抽取生成，**不得手改**；改口径请改正本后重跑 `node scripts/build-skill-packages.mjs`。

本包**不含 L0 判据节**（`rules.json` 的 `sections` 为空数组，属如实标注、非漏抄）：
情绪档 × 弧光强度的设计口径属施工方案 §4.1 的 **L1 生成策略**，归各引擎适配层，
实现见 `src/platforms/minimax-h3/director.ts` 的情绪档表，**不搬进判据包**（否则本地引擎与 AI 侧的
「同一件事两种写法」会被固化）。

本包对交付的贡献在方法学层：15 秒单人情绪短片的**情绪七段式骨架**（僵住 / 裂开 / 下坠 / 复位 /
爆发 / 凝固 / 余韵，8–30 秒自适应换算）与**动作锚点机制**。人读正本见同目录 `SKILL.md`。
