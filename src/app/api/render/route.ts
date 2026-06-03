import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
};

const generateAssFile = (words: any[], outputPath: string) => {
  let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,Arial,85,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,0,2,20,20,280,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const CHUNK_SIZE = 5; 

  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    const chunk = words.slice(i, i + CHUNK_SIZE);

    for (let j = 0; j < chunk.length; j++) {
      const w = chunk[j];

      const highlightText = chunk.map((cw, idx) => 
        idx === j ? `{\\c&H00E9A50E&}${cw.word}{\\c&HFFFFFF&}` : cw.word
      ).join(" ");
      
      assContent += `Dialogue: 0,${formatTime(w.start)},${formatTime(w.end)},TikTok,,0,0,0,,${highlightText}\n`;

      if (j < chunk.length - 1) {
        const nextWord = chunk[j + 1];
        if (nextWord.start - w.end > 0.05) { 
           const whiteText = chunk.map(cw => cw.word).join(" ");
           assContent += `Dialogue: 0,${formatTime(w.end)},${formatTime(nextWord.start)},TikTok,,0,0,0,,${whiteText}\n`;
        }
      }
    }
  }

  fs.writeFileSync(outputPath, assContent);
};

const burnSubtitles = (videoPath: string, assPath: string, outputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const relativeAssPath = path.relative(process.cwd(), assPath).replace(/\\/g, "/"); 
    
    ffmpeg(videoPath)
      .outputOptions([
        `-vf ass='${relativeAssPath}'`,
        `-preset ultrafast`, 
        `-threads 1`         
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: any) => reject(err))
      .run();
  });
};

export async function POST(request: Request) {
  try {
    const s3Client = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    const { fileKey, words } = await request.json();
    if (!fileKey || !words) return NextResponse.json({ error: "Missing data" }, { status: 400 });

    const tempDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const safeBaseName = fileKey.split('.').slice(0, -1).join('.');
    const inputVideo = path.join(tempDir, fileKey);
    const assFile = path.join(tempDir, `${safeBaseName}.ass`);
    const outputVideo = path.join(tempDir, `${safeBaseName}-final.mp4`);

    console.log("Downloading source video...");
    const getCommand = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: `raw-uploads/${fileKey}`,
    });
    const { Body } = await s3Client.send(getCommand);
    // @ts-ignore
    await pipeline(Body, fs.createWriteStream(inputVideo));

    console.log("Generating .ass subtitle file...");
    generateAssFile(words, assFile);

    console.log("Burning subtitles into video...");
    await burnSubtitles(inputVideo, assFile, outputVideo);

    console.log("Uploading rendered video to S3...");
    const finalKey = `rendered/${safeBaseName}-final.mp4`;
    const uploadStream = fs.createReadStream(outputVideo);
    
    const putCommand = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: finalKey,
      ContentType: "video/mp4",
      Body: uploadStream,
    });
    await s3Client.send(putCommand);

    const getFinalCommand = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: finalKey,
    });
    const finalUrl = await getSignedUrl(s3Client, getFinalCommand, { expiresIn: 3600 }); 

    fs.unlinkSync(inputVideo);
    fs.unlinkSync(assFile);
    fs.unlinkSync(outputVideo);

    return NextResponse.json({ success: true, finalUrl });

  } catch (error: any) {
    console.error("Render failed:", error);
    return NextResponse.json({ error: "Failed to render video" }, { status: 500 });
  }
}