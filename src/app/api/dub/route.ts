import { NextResponse } from "next/server";
import Groq from "groq-sdk";

export const runtime = 'edge';

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function chunkText(text: string, maxLength: number = 200): string[] {
  const chunks: string[] = [];
  const words = text.split(' ');
  let currentChunk = '';
  for (const word of words) {
    if ((currentChunk + word).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = word + ' ';
    } else {
      currentChunk += word + ' ';
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}

export async function POST(request: Request) {
  try {
    const { text, language } = await request.json();
    
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    
    const prompt = `Translate the following text to the language code '${language}'. Return ONLY the translated text, no quotes, no conversational filler. Text: ${text}`;
    
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant", 
    });
    
    const translatedText = chatCompletion.choices[0]?.message?.content?.trim() || "";
    if (!translatedText) throw new Error("Translation returned empty text");

    const chunks = chunkText(translatedText, 150);
    const audioBuffers: Uint8Array[] = [];

    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${language}&client=tw-ob`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        }
      });
      
      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
      
      const arrayBuffer = await res.arrayBuffer();
      audioBuffers.push(new Uint8Array(arrayBuffer));
    }

    const totalLength = audioBuffers.reduce((acc, b) => acc + b.length, 0);
    const mergedArray = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of audioBuffers) {
      mergedArray.set(b, offset);
      offset += b.length;
    }

    const mp3ArrayBuffer = mergedArray.buffer;
    
    const audioFile = new File([mp3ArrayBuffer], "dub.mp3", { type: "audio/mpeg" });
    
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      language: language,
    }) as any;

    // --------------------------------------------------------
    // SMART CAPTION ALIGNMENT FOR NON-SPACE LANGUAGES
    // --------------------------------------------------------
    const isLogographic = ["ja", "zh"].includes(language);
    
    const formattedTranscript = isLogographic && transcription.segments
      ? transcription.segments.map((seg: any) => ({
          word: seg.text.trim(),
          start: seg.start,
          end: seg.end
        }))
      : transcription.words;

    const audioBase64 = arrayBufferToBase64(mp3ArrayBuffer);

    return NextResponse.json({
      audioBase64,
      translatedTranscript: formattedTranscript
    });

  } catch (error: any) {
    console.error("Dubbing API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process dubbing" }, { status: 500 });
  }
}