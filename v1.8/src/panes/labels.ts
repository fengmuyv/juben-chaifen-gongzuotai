import type { ReferenceImage } from '../core/model';

/**
 * 界面用文案映射的**单一来源**。
 *
 * 拆壳（P0）前它们散在 `App.tsx` 顶部。`modeNames` 同时供顶栏「整集规划模式」与导演板段条使用、
 * `typeNames` 供顶栏内容类型、其余各归一个面板 —— 只要有两处引用，就必须单源，
 * 否则加一档位/一类资产时必有一处漏改。
 */
export const modeNames = { dialogue: '文戏', action: '武戏', combined: '综合' };
export const typeNames = { 'short-drama': '短剧', 'mid-drama': '中剧', 'long-drama': '长剧', film: '电影' };
export const confidenceNames = { high: '高', medium: '中', low: '低' } as const;
export const sourceNames = { local: '本地', ai: 'AI', manual: '人工' } as const;

/**
 * 资产两类：**顺序与名称单一来源**，同时供「分区列表」与「导入目标」使用 ——
 * 两处各写一套的话，加一类资产时必有一处漏改。
 *
 * 2026-10-06：「道具」图类按老大裁定**连数据层一起退役**（原话「道具选区不要了」），
 * 故此处只剩两类；同步的还有 `model.ts` 的 enum、`analyze.ts`、`match.ts`、
 * `skeleton.values()` 的 ④ 与 `electron/vision.ts` 的提示词。
 */
export const assetKinds = ['character', 'scene'] as const;
export const assetKindNames: Record<ReferenceImage['kind'], string> = { character: '人物', scene: '场景' };
