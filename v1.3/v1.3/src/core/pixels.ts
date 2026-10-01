export type SampledImage = { width: number; height: number; pixels: Uint8ClampedArray };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = src;
  });
}

/** 缩略采样：把参考图缩到最长边 size 像素后取 RGBA 缓冲，供本地像素统计。 */
export async function samplePixels(dataUrl: string, size = 64): Promise<SampledImage> {
  const image = await loadImage(dataUrl);
  const ratio = Math.min(1, size / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布上下文');
  context.drawImage(image, 0, 0, width, height);
  return { width, height, pixels: context.getImageData(0, 0, width, height).data };
}
