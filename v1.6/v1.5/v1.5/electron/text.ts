const decoder = (encoding: string, fatal = false) => new TextDecoder(encoding, { fatal });

/** 载荷类型：`docx` = OOXML 压缩包（交给 Word 读取器），`text` = 纯文本（交给字节解码）。 */
export type ScriptPayloadKind = 'docx' | 'text';

/** docx / zip 容器魔数（PK\x03\x04 / PK\x05\x06 / PK\x07\x08）。 */
export function isZipContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}

/** 旧版 .doc / WPS 二进制：OLE2 复合文档魔数 D0 CF 11 E0 A1 B1 1A E1。 */
export function isCompoundDocument(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
    && bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1;
}

/** RTF 富文本魔数 `{\rtf`。 */
export function isRichText(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x7b && bytes[1] === 0x5c && bytes[2] === 0x72 && bytes[3] === 0x74 && bytes[4] === 0x66;
}

/**
 * 载荷分流：**只认内容魔数，不认扩展名**。
 * 用户常把 docx 直接改名成 .txt 交付（剧本导出件的常见形态），若按扩展名当纯文本解码，
 * 整个 zip 流会被 GB18030 兜底解成乱码（实测 13.5 万字符、1.5 万个替换符）。
 */
export function sniffScriptPayload(bytes: Uint8Array): ScriptPayloadKind {
  return isZipContainer(bytes) ? 'docx' : 'text';
}

/**
 * 无 BOM 的 UTF-16 判定：UTF-8 / GB18030 正文里不会出现 0x00 字节，
 * UTF-16 的 ASCII 字符（换行、数字、空格）必然把 0x00 压在固定奇偶位上。
 * 二进制里的 0x00 没有奇偶倾向，用「3 倍不对称」把它挡在门外。
 * 已知边界：纯汉字、不含任何 ASCII 的无 BOM UTF-16 无法可靠识别，仍需另存为 UTF-8 或带 BOM。
 */
function utf16WithoutBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = Math.min(bytes.length, 8192) & ~1;
  if (sample < 8) return null;
  let even = 0;
  let odd = 0;
  for (let index = 0; index < sample; index += 2) {
    if (bytes[index] === 0) even += 1;
    if (bytes[index + 1] === 0) odd += 1;
  }
  const pairs = sample / 2;
  if (odd / pairs >= 0.05 && odd >= even * 3) return 'utf-16le';
  if (even / pairs >= 0.05 && even >= odd * 3) return 'utf-16be';
  return null;
}

/** 解码后的二进制体检：仍大量出现替换符或控制字符，说明根本不是文本，报错而不是把乱码灌进正文。 */
function assertReadableText(text: string): string {
  const sample = text.slice(0, 20000);
  if (!sample.length) return text;
  const broken = sample.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/g)?.length ?? 0;
  if (broken / sample.length > 0.005) {
    throw new Error('该文件不是文本剧本（疑似二进制或压缩容器）；若为 Word 文档，请直接选择 .docx 文件导入，旧版 .doc 请另存为 .docx 或 .txt');
  }
  return text;
}

export function decodeScriptBytes(bytes: Uint8Array): string {
  if (isCompoundDocument(bytes)) throw new Error('这是旧版 .doc（OLE 复合文档）或 WPS 专有二进制格式，无法直接读取；请用 Word 或 WPS 另存为 .docx 或 .txt 后再导入');
  if (isRichText(bytes)) throw new Error('这是 RTF 富文本格式，请用 Word 或 WPS 另存为 .docx 或 .txt 后再导入');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decoder('utf-16le').decode(bytes.slice(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decoder('utf-16be').decode(bytes.slice(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decoder('utf-8').decode(bytes.slice(3));
  const legacy = utf16WithoutBom(bytes);
  if (legacy) return assertReadableText(decoder(legacy).decode(bytes));
  let utf8: string | null = null;
  try { utf8 = decoder('utf-8', true).decode(bytes); } catch { utf8 = null; }
  return assertReadableText(utf8 ?? decoder('gb18030').decode(bytes));
}

export function normalizeScriptText(text: string): string {
  return text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}
