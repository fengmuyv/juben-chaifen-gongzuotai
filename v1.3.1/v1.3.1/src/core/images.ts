import type { ReferenceImage } from './model';

export async function prepareImage(file: File, kind: ReferenceImage['kind']): Promise<ReferenceImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('仅支持 JPG、PNG、WebP 图片');
  if (file.size > 15 * 1024 * 1024) throw new Error('图片不能超过15MB');
  const bytes = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { id: hash, sha256: hash, name: file.name, dataUrl: canvas.toDataURL('image/jpeg', 0.74), kind, description: '', confirmed: false, version: 1 };
  } finally { bitmap.close(); }
}
