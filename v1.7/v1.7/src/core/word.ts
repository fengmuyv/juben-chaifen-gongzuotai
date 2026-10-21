import mammoth from 'mammoth';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { activeEpisode, segmentsOf, type Episode, type Project } from './model';
import { fields, values } from '../platforms/minimax-h3/skeleton';

export async function readWord(buffer: ArrayBuffer): Promise<string> {
  const input = { arrayBuffer: buffer, buffer: new Uint8Array(buffer) } as unknown as Parameters<typeof mammoth.extractRawText>[0];
  let result: { value: string };
  try { result = await mammoth.extractRawText(input); }
  catch { throw new Error('该 Word 文件无法解析：请确认是 .docx（而非改名的压缩包或旧版 .doc）'); }
  if (!result.value.trim()) throw new Error('Word 文档没有可读取的正文');
  return result.value.replace(/\r\n?/g, '\n').trim();
}

/**
 * 导出 Word 分镜。`segmentId` 缺省 = 整集；给了就只导那一个**片段**。
 *
 * 片段导出与整集导出**同源**：同一套段落构造、同一套 14 格取值口（`skeleton.values`），
 * 只把循环范围收成一段。故不存在「片段版与整集版版式不一致」这种两份实现才会有的病。
 */
export async function writeWord(project: Project, episodeId?: string, segmentId?: string): Promise<Uint8Array> {
  const episode: Episode = episodeId ? project.episodes.find((item) => item.id === episodeId) ?? activeEpisode(project) : activeEpisode(project);
  const scoped = segmentsOf(episode, segmentId);
  // 首行随范围收敛：整集写集号，片段写「集号 段号」——产物打开就能看出导的是哪一片。
  const scope = segmentId ? `${episode.label} ${segmentId}` : episode.label;
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: `${project.title} ${scope} 分镜脚本`, style: 'Title', spacing: { after: 240 } }),
    new Paragraph({ text: `MiniMax H3 · 骨架 ${project.skeletonVersion} · 编译器 ${project.compilerVersion}`, spacing: { after: 260 } }),
  ];
  for (const segment of scoped) {
    const scene = episode.scenes.find((item) => item.id === segment.sceneId);
    paragraphs.push(new Paragraph({ text: `${segment.id}  15秒  ${segment.mode === 'dialogue' ? '文戏' : '武戏'}  ${scene?.title ?? ''}`, heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 220, after: 120 } }));
    for (const shot of segment.shots) {
      paragraphs.push(new Paragraph({ text: `${shot.id}【${shot.purpose}｜${shot.duration}s】`, heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 140, after: 80 } }));
      values(project, shot).forEach((value, index) => paragraphs.push(new Paragraph({
        children: [new TextRun({ text: `${String.fromCharCode(0x2460 + index)} ${fields[index].label}：`, bold: true }), new TextRun(value)],
        spacing: { after: 45, line: 300 }, keepNext: index < fields.length - 1,
      })));
    }
  }
  const document = new Document({
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 21, color: '202A2A' }, paragraph: { spacing: { line: 300 } } } } },
    sections: [{ properties: { page: { margin: { top: 960, bottom: 960, left: 1000, right: 1000 } } }, children: paragraphs }],
  });
  // 浏览器 / Electron 渲染进程没有 Node Buffer：`toBuffer` 走 JSZip 的 nodebuffer 通道，
  // 会抛「nodebuffer is not supported by this platform」。统一走 Blob 通道再取字节，
  // 两种环境（浏览器 Blob / Node 18+ 全局 Blob）都可用。
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}
