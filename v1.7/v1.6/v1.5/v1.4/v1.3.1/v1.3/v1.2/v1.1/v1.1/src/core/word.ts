import mammoth from 'mammoth';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { Project } from './model';
import { fields, values } from '../platforms/minimax-h3/skeleton';

export async function readWord(buffer: ArrayBuffer): Promise<string> {
  const input = { arrayBuffer: buffer, buffer: new Uint8Array(buffer) } as unknown as Parameters<typeof mammoth.extractRawText>[0];
  const result = await mammoth.extractRawText(input);
  if (!result.value.trim()) throw new Error('Word 文档没有可读取的正文');
  return result.value.replace(/\r\n?/g, '\n').trim();
}

export async function writeWord(project: Project): Promise<Uint8Array> {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: `${project.title} ${project.episode} 分镜脚本`, style: 'Title', spacing: { after: 240 } }),
    new Paragraph({ text: `MiniMax H3 · 骨架 ${project.skeletonVersion} · 编译器 ${project.compilerVersion}`, spacing: { after: 260 } }),
  ];
  for (const segment of project.segments) {
    const scene = project.scenes.find((item) => item.id === segment.sceneId);
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
  return new Uint8Array(await Packer.toBuffer(document));
}
