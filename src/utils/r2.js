import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

const endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const bucket = process.env.R2_BUCKET;

const publicBase = "https://pub-499cd352d1a2490d86a3cbaf49bc7b04.r2.dev";

const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: false,
});

export const uploadBufferToR2 = async (key, buffer, contentType = "application/octet-stream") => {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(cmd);

  const url = `${publicBase}/${encodeURIComponent(key)}`;
  return url;
};

export const deleteObjectFromR2 = async (key) => {
  const cmd = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await s3.send(cmd);
  return true;
};

export const getKeyFromUrl = (url) => {
  try {
    const parts = new URL(url);
    const segments = parts.pathname.split("/").filter(Boolean);
    if (segments.length >= 2) {
      return segments.slice(1).join("/");
    }
    return segments.join("/");
  } catch {
    return null;
  }
};