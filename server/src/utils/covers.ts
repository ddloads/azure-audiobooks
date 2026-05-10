import fs from "fs";
import path from "path";
import { getCoversRoot } from "./libraryConfig";

export const getCoverUrl = (coverName: string) =>
  `/api/library/cover/${encodeURIComponent(coverName)}`;

export const normalizeCoverPath = (coverPath?: string | null) => {
  if (!coverPath) {
    return coverPath ?? null;
  }

  const match = coverPath.match(/\/api\/library\/cover\/([^/?#]+)/i);
  if (!match) {
    return coverPath;
  }

  return getCoverUrl(decodeURIComponent(match[1]));
};

export const downloadCover = async (url: string, baseName: string): Promise<string | null> => {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      console.error(`Failed to download cover from ${url}: ${response.status} ${response.statusText}`);
      return null;
    }

    const contentType = response.headers.get("content-type");
    let ext = ".jpg";
    if (contentType?.includes("image/png")) ext = ".png";
    if (contentType?.includes("image/webp")) ext = ".webp";

    const fileName = `${baseName}${ext}`;
    const filePath = path.join(getCoversRoot(), fileName);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return fileName;
  } catch (error) {
    console.error(`Error downloading cover from ${url}:`, error);
    return null;
  }
};
