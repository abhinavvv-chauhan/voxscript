import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import fs from "fs";
import path from "path";
import os from "os";

export async function POST(request: Request) {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    
    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const tempFilePath = path.join(os.tmpdir(), `${Date.now()}-audio.mp3`);
    fs.writeFileSync(tempFilePath, buffer);

    console.log("Sending audio to Groq...");
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    }) as any;

    fs.unlinkSync(tempFilePath);

    return NextResponse.json({ 
      success: true, 
      words: transcription.words 
    });

  } catch (error: any) {
    console.error("Groq processing error:", error);
    return NextResponse.json({ error: "Failed to process audio" }, { status: 500 });
  }
}