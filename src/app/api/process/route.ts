import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import Groq from "groq-sdk";
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

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

const extractAudio = (videoPath: string, audioPath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioChannels(1) 
      .audioFrequency(16000) 
      .on("end", () => resolve(audioPath))
      .on("error", (err: any) => {
        console.error("FFmpeg Error:", err.message);
        if (err.message.includes("Invalid argument") || err.message.includes("Output file is empty")) {
          reject(new Error("SILENT_VIDEO"));
        } else {
          reject(err);
        }
      })
      .run();
  });
};

export async function POST(request: Request) {
  try {
    const { fileKey } = await request.json();
    if (!fileKey) return NextResponse.json({ error: "No file key provided" }, { status: 400 });

    const tempDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    
    const safeBaseName = fileKey.split('.').slice(0, -1).join('.');
    const videoFilePath = path.join(tempDir, fileKey);
    const audioFilePath = path.join(tempDir, `${safeBaseName}-audio.mp3`);

    console.log(`Downloading ${fileKey} from S3...`);
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: `raw-uploads/${fileKey}`,
    });
    const { Body } = await s3Client.send(command);
    
    // @ts-ignore
    await pipeline(Body, fs.createWriteStream(videoFilePath));

    console.log("Extracting audio with FFmpeg...");
    await extractAudio(videoFilePath, audioFilePath);

    console.log("Sending to Groq Whisper API...");
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json", 
      timestamp_granularities: ["word"], 
    }) as any; 

    fs.unlinkSync(videoFilePath);
    fs.unlinkSync(audioFilePath);

    console.log("Groq Transcription complete!");

    return NextResponse.json({ 
      success: true,
      text: transcription.text,
      words: transcription.words 
    });

  } catch (error:any) {
    console.error("Engine failure:", error.message || error);
    if (error.message === "SILENT_VIDEO") {
      return NextResponse.json({ error: "No audio track found in this video. Please upload a video with spoken dialogue." }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to process video" }, { status: 500 });
  }
}