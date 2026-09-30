import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

// In production (Tauri), UPLOAD_DIR points to a writable directory in appDataDir.
// In development, fall back to public/uploads so Next.js can serve them as static files.
const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");

// Kimi K2.5 视觉模型有效处理范围：长边不超过 1800px
// JPEG quality=85 在保证手写字迹可读性的前提下大幅压缩文件体积
const MAX_SIDE = 1800;
const JPEG_QUALITY = 85;

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".heic", ".heif"]);

async function resizeImageBuffer(buffer: Buffer, originalExt: string): Promise<{ buffer: Buffer; ext: string }> {
  const isImage = IMAGE_EXTS.has(originalExt.toLowerCase());
  if (!isImage) {
    return { buffer, ext: originalExt };
  }

  const resized = await sharp(buffer)
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  return { buffer: resized, ext: ".jpg" };
}

export async function saveUpload(file: File) {
  await mkdir(uploadDir, { recursive: true });
  const originalExt = path.extname(file.name) || ".jpg";
  const bytes = await file.arrayBuffer();
  const { buffer, ext } = await resizeImageBuffer(Buffer.from(bytes), originalExt);

  const fileName = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(uploadDir, fileName);
  await writeFile(filePath, buffer);
  return {
    fileName,
    publicPath: `/uploads/${fileName}`,
    originalName: file.name,
  };
}
