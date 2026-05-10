import fs from "fs";
import path from "path";

export const getCoverUrl = (bookId: string) =>
  `/api/library/cover/${encodeURIComponent(bookId)}`;

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

export const findCoverInFolder = (folderPath: string): string | null => {
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const p = path.join(folderPath, `cover${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

export const downloadCover = async (url: string, folderPath: string): Promise<boolean> => {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      console.error(`Failed to download cover from ${url}: ${response.status} ${response.statusText}`);
      return false;
    }

    const contentType = response.headers.get("content-type");
    let ext = ".jpg";
    if (contentType?.includes("image/png")) ext = ".png";
    if (contentType?.includes("image/webp")) ext = ".webp";

    const filePath = path.join(folderPath, `cover${ext}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return true;
  } catch (error) {
    console.error(`Error downloading cover from ${url}:`, error);
    return false;
  }
};
