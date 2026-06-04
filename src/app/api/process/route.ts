import { NextResponse } from "next/server";
import Groq from "groq-sdk";

export const runtime = 'edge'; 

export async function POST(request: Request) {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    
    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    console.log("Sending audio to Groq via Edge...");
    
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile, 
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    }) as any;

    return NextResponse.json({ 
      success: true, 
      words: transcription.words 
    });

  } catch (error: any) {
    console.error("Groq processing error:", error);
    return NextResponse.json({ error: "Failed to process audio" }, { status: 500 });
  }
}