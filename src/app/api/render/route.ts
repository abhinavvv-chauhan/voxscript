import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

interface Word {
  word: string;
  start: number;
  end: number;
}

interface AssConfig {
  chunkSize?: number;
  silenceThresholdSec?: number;
  highlightColor?: string;
  playResX?: number;
  playResY?: number;
  fontSize?: number;
}

const DEFAULT_CONFIG: Required<AssConfig> = {
  chunkSize: 4,
  silenceThresholdSec: 0.05,
  highlightColor: "0000FFFF",
  playResX: 1080,
  playResY: 1920,
  fontSize: 95,
};

const toAssTimestamp = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) {
    throw new RangeError(`Invalid timestamp value: ${seconds}`);
  }

  const totalCs = Math.round(seconds * 100);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);

  return (
    `${hr}:` +
    `${String(min).padStart(2, "0")}:` +
    `${String(sec).padStart(2, "0")}.` +
    `${String(cs).padStart(2, "0")}`
  );
};

const sanitizeAssText = (text: string): string =>
  text.replace(/[\r\n\\{}/]/g, "").trim();

const dialogueLine = (start: string, end: string, text: string): string =>
  `Dialogue: 0,${start},${end},TikTok,,0,0,0,,${text}\n`;

const buildHighlightLine = (
  chunk: Word[],
  activeIndex: number,
  word: Word,
  highlightColor: string
): string => {
  const text = chunk
    .map((cw, idx) =>
      idx === activeIndex
        ? `{\\c&H${highlightColor}&}${sanitizeAssText(cw.word)}{\\c&HFFFFFF&}`
        : sanitizeAssText(cw.word)
    )
    .join(" ");

  return dialogueLine(toAssTimestamp(word.start), toAssTimestamp(word.end), text);
};

const buildSilenceLine = (chunk: Word[], from: number, to: number): string => {
  const text = chunk.map((cw) => sanitizeAssText(cw.word)).join(" ");
  return dialogueLine(toAssTimestamp(from), toAssTimestamp(to), text);
};

const buildAssHeader = (cfg: Required<AssConfig>): string =>
  `[Script Info]
ScriptType: v4.00+
PlayResX: ${cfg.playResX}
PlayResY: ${cfg.playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,Arial Rounded MT Bold,${cfg.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,6,2,2,40,40,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const validateWords = (words: Word[]): void => {
  if (!Array.isArray(words) || words.length === 0) {
    throw new TypeError("words must be a non-empty array");
  }

  words.forEach((w, i) => {
    if (typeof w.word !== "string" || w.word.trim() === "") {
      throw new TypeError(`words[${i}].word must be a non-empty string`);
    }
    if (typeof w.start !== "number" || typeof w.end !== "number") {
      throw new TypeError(`words[${i}] has non-numeric start/end timestamps`);
    }
    if (w.start < 0 || w.end < 0) {
      throw new RangeError(`words[${i}] has negative timestamps`);
    }
    if (w.end <= w.start) {
      throw new RangeError(
        `words[${i}] ("${w.word}") has end (${w.end}) ≤ start (${w.start})`
      );
    }
  });
};

const generateAssFile = (
  words: Word[],
  outputPath: string,
  config: AssConfig = {}
): void => {
  validateWords(words);

  if (!outputPath.endsWith(".ass")) {
    console.warn(`outputPath "${outputPath}" does not end in .ass`);
  }

  const cfg: Required<AssConfig> = { ...DEFAULT_CONFIG, ...config };

  const chunks: Word[][] = [];
  for (let i = 0; i < words.length; i += cfg.chunkSize) {
    chunks.push(words.slice(i, i + cfg.chunkSize));
  }

  let assContent = buildAssHeader(cfg);

  for (const chunk of chunks) {
    for (let j = 0; j < chunk.length; j++) {
      const word = chunk[j];

      assContent += buildHighlightLine(chunk, j, word, cfg.highlightColor);

      const next = chunk[j + 1];
      if (next && next.start - word.end > cfg.silenceThresholdSec) {
        assContent += buildSilenceLine(chunk, word.end, next.start);
      }
    }
  }

  fs.writeFileSync(outputPath, assContent, "utf8");
};

const burnSubtitles = (
  videoPath: string,
  assPath: string,
  outputPath: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const relativeAssPath = path
      .relative(process.cwd(), assPath)
      .replace(/\\/g, "/");

    ffmpeg(videoPath)
      .outputOptions([`-vf ass='${relativeAssPath}'`])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
};

const cleanupFiles = (filePaths: string[]): void => {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.warn(`Failed to delete temp file: ${filePath}`, err);
    }
  }
};

export async function POST(request: Request) {
  let tempFiles: string[] = [];

  try {
    const body = await request.json();
    const { fileKey, words } = body;

    if (!fileKey || typeof fileKey !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid fileKey" },
        { status: 400 }
      );
    }

    if (!words) {
      return NextResponse.json(
        { error: "Missing words data" },
        { status: 400 }
      );
    }

    const tempDir = path.join(process.cwd(), "tmp");

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const safeBaseName = path.basename(fileKey, path.extname(fileKey));
    const inputVideo = path.join(tempDir, fileKey);
    const assFile = path.join(tempDir, `${safeBaseName}.ass`);
    const outputVideo = path.join(tempDir, `${safeBaseName}-final.mp4`);

    tempFiles = [inputVideo, assFile, outputVideo];

    console.log("Downloading source video...");

    const getCommand = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: `raw-uploads/${fileKey}`,
    });

    const { Body } = await s3Client.send(getCommand);

    if (!Body) {
      throw new Error("S3 returned an empty body for the source video");
    }

    await pipeline(
      Body as NodeJS.ReadableStream,
      fs.createWriteStream(inputVideo)
    );

    console.log("Generating .ass subtitle file...");
    generateAssFile(words, assFile);

    console.log("Burning subtitles into video...");
    await burnSubtitles(inputVideo, assFile, outputVideo);

    console.log("Uploading rendered video to S3...");

    const finalKey = `rendered/${safeBaseName}-final.mp4`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME!,
        Key: finalKey,
        ContentType: "video/mp4",
        Body: fs.createReadStream(outputVideo),
      })
    );

    const finalUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME!,
        Key: finalKey,
      }),
      { expiresIn: 3600 }
    );

    return NextResponse.json({
      success: true,
      finalUrl,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    console.error("Render failed:", message);

    return NextResponse.json(
      {
        error: "Failed to render video",
        detail: message,
      },
      { status: 500 }
    );
  } finally {
    cleanupFiles(tempFiles);
  }
}