import { type Beat, type Episode, type ImageAnalysis, type Project, type Segment } from '../../core/model';
import { generatedKeys, type EditableShotKey } from './skeleton';
import { transitionForbiddenPattern } from './validator';

export type BeatCategory = 'action' | 'dialogue' | 'emotion' | 'establish';

/** 生成通道的单镜草稿：只承载 10 条可生成字段。 */
export type ShotDraft = { shotId: string; fields: Partial<Record<EditableShotKey, string>>; source: 'local' | 'ai' | 'manual' };

const actionWords = /挥|踢|砍|格挡|刺|扑|打斗|出拳|撞|摔|追击|推开|抓住|挣脱|拔|翻滚|跃|冲|按住|夺|拽|扇|掐|踹|顶|砸|递|接住|抱|挣|扳|推倒/u;
const emotionWords = /泪|颤|怔|咬牙|苦笑|冷笑|蹙|皱眉|哽咽|怒|悲|喜|惊|惧|痛|慌|愣|僵|叹|红着眼|沉默/u;
const establishWords = /窗外|门口|大厅|街道|晨|夜|夕阳|黄昏|灯光|桌上|屋内|走廊|天台|楼|车|雨|雪|风|光|远处|背景|房间|墙|院落/u;

/** 节拍分类：动作 / 对话 / 情绪 / 场景建立。确定性、可单测。 */
export function classifyBeat(beat: Beat): BeatCategory {
  if (beat.kind === 'dialogue') {
    if (emotionWords.test(beat.text) && /[！？…]|\.\.\./u.test(beat.text)) return 'emotion';
    return 'dialogue';
  }
  if (actionWords.test(beat.text)) return 'action';
  if (emotionWords.test(beat.text)) return 'emotion';
  if (establishWords.test(beat.text)) return 'establish';
  return 'establish';
}

/** 镜头模板：动作→中近景·35mm·跟拍；对话→过肩·50mm·静止；情绪→特写·85mm；建立→大全景·24mm。 */
export const shotTemplates: Record<BeatCategory, { scale: string; lens: string; movement: string }> = {
  action: { scale: '中近景', lens: '35mm', movement: '手持跟拍' },
  dialogue: { scale: '过肩中景', lens: '50mm', movement: '固定机位' },
  emotion: { scale: '面部特写', lens: '85mm', movement: '微幅前移' },
  establish: { scale: '大全景', lens: '24mm', movement: '缓慢横移' },
};

const actionTemplates: Record<BeatCategory, string[]> = {
  action: ['重心前压，右臂自后向前挥出，左脚跨步逼近对方', '侧身沉肩，手臂格挡后顺势外推，脚步横移半步'],
  dialogue: ['保持站立，双手自然下垂，重心微微前倾', '双手交叠在身前，身体朝向交谈对象略微侧转'],
  emotion: ['双手垂在身侧，指尖轻微收拢，肩线随呼吸微起伏', '一只手撑在身侧平面上，另一只手慢慢收回到腰侧'],
  establish: ['人物静止站在空间里，视线落在画面纵深方向', '人物从画面一侧缓慢走入，停在空间中央'],
};

const performanceTemplates = [
  '眉峰轻微上抬，眼睑略收，唇角绷直',
  '眉心向内收拢，下眼睑收紧，下巴微抬',
  '目光短暂下垂后重新抬起，鼻翼轻微翕动',
  '嘴角一侧轻微下沉，下颌线绷紧，喉结轻动',
  '眉梢下压，瞳孔短暂收缩，嘴唇抿成一条线',
];

const soundTemplates: Record<BeatCategory, string[]> = {
  action: ['拳脚击中躯干的闷响与衣物摩擦声', '脚步急停的摩擦声与呼吸加重'],
  dialogue: ['室内环境底噪，远处隐隐的城市低频', '空间轻微混响，偶发器物轻响'],
  emotion: ['呼吸声被放大，环境音几近静默', '极轻的衣物摩擦声与不稳的呼吸'],
  establish: ['空间环境音铺底，风声与远处零星动静', '开阔环境声场，远处车流与鸟鸣'],
};

/** 合规衔接池：动作接动作、视线引导、遮挡转场、匹配剪辑、J-Cut / L-Cut、声音先入、空镜缓冲、同向运动顺接、光影变化接、焦点转移接。 */
export const transitionPool = [
  '动作接动作：本镜末的抬手动作接下一镜同一动作的继续，动势方向保持一致',
  '视线引导：本镜末人物视线落向画面右侧，下一镜顺视线方向切到目标物',
  '遮挡转场：前景人物肩背横过画面遮蔽，下一镜由遮挡物移开后显露新空间',
  '匹配剪辑：以信封的圆形轮廓匹配下一镜的钟表表盘，形状与画面位置对齐',
  'J-Cut：下一镜的环境声与对话先于画面进入，本镜画面仍在延续',
  'L-Cut：本镜台词延续到下一镜画面，用声音搭桥完成空间切换',
  '声音先入：下一镜的脚步声中先于画面出现，形成听觉预期',
  '空镜缓冲：插入雨打窗棂的短暂空镜，承接情绪后再回到人物',
  '同向运动顺接：人物横向移动方向与下一镜机位横移方向一致',
  '光影变化接：本镜末灯光渐次熄灭，下一镜在暗部重新亮起',
  '焦点转移接：焦点从前景人物转移到后景门把手，下一镜以门把手为前景',
] as const;

/** 若衔接命中转场禁词，替换为确定性合规衔接（禁词表是硬红线）。 */
export function sanitizeTransition(text: string): string {
  return transitionForbiddenPattern.test(text) ? transitionPool[0] : text;
}

function startOfBeat(beat: Beat | undefined): BeatCategory {
  return beat ? classifyBeat(beat) : 'dialogue';
}

function analysisFor(project: Project, episode: Episode, segment: Segment, analysisByImage: Map<string, ImageAnalysis>): ImageAnalysis | undefined {
  const images = segment.imageIds.map((id) => episode.images.find((image) => image.id === id)).filter((image): image is NonNullable<typeof image> => !!image);
  const ordered = [...images.filter((image) => image.kind === 'scene'), ...images.filter((image) => image.kind !== 'scene')];
  for (const image of ordered) {
    const analysis = analysisByImage.get(image.id) ?? image.analysis;
    if (analysis) return analysis;
  }
  return undefined;
}

function lightFor(analysis: ImageAnalysis | undefined): string {
  if (!analysis) return '自然散射光，中性色温，中等照度';
  const direction = { top: '顶部来光', left: '左侧来光', right: '右侧来光', bottom: '底部反光', flat: '均匀散射光' }[analysis.lightDirection];
  const temperature = { warm: '暖色温', cool: '冷色温', neutral: '中性色温' }[analysis.temperature];
  const level = analysis.brightness > 0.62 ? '高照度' : analysis.brightness > 0.38 ? '中等照度' : '低照度';
  return `${direction}，${temperature}，${level}`;
}

function atmosphereFor(analysis: ImageAnalysis | undefined): string {
  if (!analysis) return '环境光均匀，情绪平稳';
  const temperature = { warm: '暖调', cool: '冷调', neutral: '中性调' }[analysis.temperature];
  const mood = analysis.saturation > 0.45 ? '色彩饱满' : analysis.saturation > 0.25 ? '色彩克制' : '低饱和';
  const space = analysis.indoor === 'indoor' ? '室内封闭' : analysis.indoor === 'outdoor' ? '室外开阔' : '空间层次待定';
  return `${temperature}${mood}，${space}`;
}

function blockingTemplate(category: BeatCategory, speaker: string): string {
  const who = speaker || '主要人物';
  if (category === 'action') return `${who}位于画面中央偏后，面向画面纵深方向，轴线保持在画面左侧`;
  if (category === 'emotion') return `${who}位于画面中央，正面朝向镜头，左右留白基本对称`;
  if (category === 'establish') return `人物尚未入画或静止于画面右三分之一，空间全貌占据画面`;
  return `${who}位于画面左三分之一，面向画面右侧的交谈对象，视线保持同一轴线`;
}

function actionFor(category: BeatCategory, beat: Beat | undefined, index: number): string {
  if (beat && beat.kind === 'action' && beat.text.trim()) return beat.text.trim();
  const pool = actionTemplates[category];
  return pool[index % pool.length];
}

/**
 * 规则导演：为整集逐段生成 10 条可生成字段（③⑤⑥⑦⑧⑨⑩⑪⑬⑭），
 * 连续性继承（站位逐镜承接）、衔接取自合规池并过滤禁词。确定性实现，可重复可单测。
 */
export function generateEpisodeDrafts(project: Project, episode: Episode, analysisByImage: Map<string, ImageAnalysis> = new Map()): Map<string, ShotDraft[]> {
  const result = new Map<string, ShotDraft[]>();
  let lastBlocking = '';
  episode.segments.forEach((segment, segmentIndex) => {
    const analysis = analysisFor(project, episode, segment, analysisByImage);
    const light = lightFor(analysis);
    const atmosphere = atmosphereFor(analysis);
    let currentBlocking = lastBlocking;
    const drafts: ShotDraft[] = segment.shots.map((shot, shotIndex) => {
      const beat = episode.beats.find((item) => shot.beatIds.includes(item.id));
      const category = startOfBeat(beat);
      const template = shotTemplates[category];
      const speaker = beat?.dialogue?.speaker ?? '';
      if (!currentBlocking) currentBlocking = blockingTemplate(category, speaker);
      const nextShot = segment.shots[shotIndex + 1];
      const nextBeat = nextShot ? episode.beats.find((item) => nextShot.beatIds.includes(item.id)) : undefined;
      const nextSegment = episode.segments[segmentIndex + 1];
      const nextCategory = nextShot ? startOfBeat(nextBeat) : nextSegment ? startOfBeat(episode.beats.find((item) => nextSegment.beatIds.includes(item.id))) : category;
      const transition = sanitizeTransition(nextShot ? transitionPool[(segmentIndex + shotIndex + 1) % transitionPool.length] : `交棒下一段：保持轴线与人物方位不变，以${nextCategory === 'action' ? '动作起势' : nextCategory === 'emotion' ? '视线与呼吸' : '环境声'}进入下一段`);
      const fields: Partial<Record<EditableShotKey, string>> = {
        scale: template.scale, lens: template.lens, movement: template.movement,
        light, atmosphere, blocking: currentBlocking,
        action: actionFor(category, beat, segmentIndex + shotIndex),
        performance: performanceTemplates[(segmentIndex + shotIndex) % performanceTemplates.length],
        sound: soundTemplates[category][(segmentIndex + shotIndex) % soundTemplates[category].length],
        transition,
      };
      currentBlocking = fields.blocking!;
      return { shotId: shot.id, fields, source: 'local' as const };
    });
    lastBlocking = currentBlocking;
    result.set(segment.id, drafts);
  });
  return result;
}

export function generatedFieldCount(drafts: ShotDraft[]): number {
  return drafts.reduce((sum, draft) => sum + generatedKeys.filter((key) => !!draft.fields[key]?.trim()).length, 0);
}
