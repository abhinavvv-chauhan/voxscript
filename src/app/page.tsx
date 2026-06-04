"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { useRef, useState } from "react";
import { Upload, Sparkles, Zap, ShieldCheck } from "lucide-react";

export default function Home() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [finalVideo, setFinalVideo] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState<any[] | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
    }
  };

  const generateAssString = (words: any[]) => {
    const formatTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const cs = Math.floor((seconds % 1) * 100);
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
    };

    let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,Arial,85,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,0,2,20,20,280,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

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
    return assContent;
  };

  const handleWordChange = (index: number, newWord: string) => {
    if (!transcript) return;
    const newTranscript = [...transcript];
    newTranscript[index].word = newWord;
    setTranscript(newTranscript);
  };

  const handleGenerateTranscript = async () => {
    if (!file) return;

    try {
      setIsUploading(true); 
      
      if (!ffmpegRef.current) {
        ffmpegRef.current = new FFmpeg();
      }
      const ffmpeg = ffmpegRef.current;
      
      ffmpeg.on('progress', ({ progress }) => {
         const percentage = Math.round(progress * 100);
         console.log(`FFmpeg Progress: ${percentage}%`);
      });

      const baseURL = '/ffmpeg';
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
      }

      console.log("Extracting and chunking audio locally...");
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));
      
      const CHUNK_DURATION = 50; 
      
      await ffmpeg.exec([
        '-i', 'input.mp4', 
        '-vn', 
        '-acodec', 'pcm_s16le', 
        '-ar', '16000', 
        '-ac', '1', 
        '-f', 'segment', 
        '-segment_time', `${CHUNK_DURATION}`, 
        'chunk_%03d.wav'
      ]); 
      
      const files = await ffmpeg.listDir('/');
      const chunkFiles = files
        .filter((f) => f.name.startsWith('chunk_') && f.name.endsWith('.wav'))
        .map((f) => f.name)
        .sort(); 

      setIsUploading(false);
      setIsProcessing(true);
      console.log(`Processing ${chunkFiles.length} chunks via Groq Whisper...`);

      const transcriptPromises = chunkFiles.map(async (chunkName, index) => {
        const audioData = await ffmpeg.readFile(chunkName);
        const audioBlob = new Blob([audioData as any], { type: 'audio/wav' });

        const formData = new FormData();
        formData.append("audio", audioBlob, chunkName);

        const res = await fetch("/api/process", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) throw new Error(`AI Processing failed for ${chunkName}`);
        const { words } = await res.json();

        const timeOffset = index * CHUNK_DURATION;
        return words.map((w: any) => ({
          ...w,
          start: w.start + timeOffset,
          end: w.end + timeOffset
        }));
      });

      const resolvedChunks = await Promise.all(transcriptPromises);
      const allWords = resolvedChunks.flat();
      
      setTranscript(allWords);
      setIsEditing(true);
      setIsProcessing(false);

    } catch (error) {
      console.error("Pipeline crashed:", error);
      alert("An error occurred during video processing. Check the console for details.");
      setIsUploading(false);
      setIsProcessing(false);
    }
  };

  const handleBurnVideo = async () => {
    if (!transcript) return;
    
    try {
      setIsRendering(true);
      setIsEditing(false);
      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg) throw new Error("FFmpeg not initialized");

      const fontURL = 'https://raw.githubusercontent.com/ffmpegwasm/testdata/master/arial.ttf';
      await ffmpeg.writeFile('arial.ttf', await fetchFile(fontURL));

      const assString = generateAssString(transcript);
      await ffmpeg.writeFile('subs.ass', new TextEncoder().encode(assString));

      console.log("Burning pixels...");
      
      await ffmpeg.exec([
        '-i', 'input.mp4', 
        '-vf', 'ass=subs.ass:fontsdir=/', 
        '-preset', 'ultrafast', 
        'output.mp4'
      ]);

      const data = await ffmpeg.readFile('output.mp4');
      const finalBlob = new Blob([data as any], { type: 'video/mp4' });
      const finalUrl = URL.createObjectURL(finalBlob);
      
      setFinalVideo(finalUrl);

    } catch (error) {
      console.error("Render crashed:", error);
      alert("Failed to render final video.");
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 w-full flex-1 flex flex-col justify-center">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center min-h-[75vh] py-6">
        
        <div className="space-y-6 text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-widest">
            <Sparkles size={14} /> AI Video Captioning
          </div>
          
          <h1 className="text-5xl lg:text-7xl font-black tracking-tighter leading-[1.05] text-white">
            Captions that <br />
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              demand attention.
            </span>
          </h1>
          
          <p className="text-zinc-400 text-base lg:text-lg max-w-md font-medium leading-relaxed">
            VoxScript turns silent scrolls into active viewers. 
            Upload your footage and let our AI craft pixel-perfect, word-level subtitles instantly.
          </p>

          <div className="flex gap-5 pt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <div className="flex items-center gap-1.5"><Zap size={14} className="text-cyan-400"/> Lightning Fast</div>
            <div className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-500"/> Secure Pipeline</div>
          </div>
        </div>

        <div className="relative group w-full max-w-md mx-auto lg:ml-auto">
          <div className="absolute -inset-0.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl blur-md opacity-20 group-hover:opacity-45 transition duration-500"></div>
          
          <div className="relative flex flex-col items-center justify-center w-full aspect-square bg-zinc-950 border border-zinc-900 rounded-2xl p-6 text-center overflow-hidden">
            
            {!previewUrl ? (
              <div className="flex flex-col items-center w-full mt-4">
                <div className="mb-5 p-4 rounded-full bg-cyan-500/5 border border-cyan-500/10 text-cyan-400 shadow-inner">
                  <Upload size={28} />
                </div>
                <h2 className="text-xl font-bold mb-1 text-zinc-100">Drop your footage</h2>
                <p className="text-zinc-500 text-xs mb-8 leading-relaxed">
                  MP4, MOV or WebM. <br /> Optimal for 9:16 vertical videos. Max 50MB.
                </p>
                <label className="px-6 py-3 bg-zinc-100 text-black hover:bg-white font-bold text-sm rounded-lg cursor-pointer transition-all active:scale-95 shadow-lg">
                  Select Video
                  <input type="file" className="hidden" accept="video/mp4,video/quicktime,video/webm" onChange={handleFileSelect} />
                </label>
              </div>
            ) : (
              <div className="flex flex-col items-center w-full h-full justify-between">
                <div className="w-full relative rounded-xl overflow-hidden bg-black border border-zinc-800" style={{ height: '75%' }}>
                   <video src={previewUrl} className="w-full h-full object-contain" controls />
                </div>
                
                <div className="flex flex-col gap-3 w-full mt-4">
                  
                  {finalVideo && (
                    <div className="w-full bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 text-center mb-2">
                       <h4 className="text-cyan-400 font-bold mb-3">Render Complete!</h4>
                       <a href={finalVideo} target="_blank" rel="noreferrer" download className="inline-block px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded shadow-lg transition-colors">
                         Download Finished Video
                       </a>
                    </div>
                  )}

                  {isEditing && transcript && (
                    <div className="w-full h-48 overflow-y-auto bg-black border border-zinc-800 rounded-lg p-4 mb-2 flex flex-wrap gap-2 content-start">
                      {transcript.map((w, i) => (
                        <input
                          key={i}
                          type="text"
                          value={w.word}
                          onChange={(e) => handleWordChange(i, e.target.value)}
                          className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-2 py-1 rounded text-sm w-auto focus:border-cyan-500 focus:outline-none"
                          style={{ width: `${Math.max(w.word.length + 1, 3)}ch` }}
                        />
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3 w-full">
                    {!finalVideo && !isEditing && (
                      <button 
                        onClick={() => { setFile(null); setPreviewUrl(null); }}
                        disabled={isUploading || isProcessing || isRendering}
                        className="px-4 py-3 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white font-semibold text-sm rounded-lg flex-1 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                    
                    {!finalVideo && !isEditing && (
                      <button 
                        onClick={handleGenerateTranscript}
                        disabled={isUploading || isProcessing || isRendering}
                        className="px-4 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm rounded-lg flex-[2] flex justify-center items-center gap-2 transition-colors disabled:opacity-50 shadow-[0_0_15px_rgba(14,165,233,0.3)] cursor-pointer"
                      >
                        {isUploading && "1/3: Extracting Audio..."}
                        {isProcessing && "2/3: AI Generating Transcript..."}
                        {isRendering && "3/3: Burning Pixels..."}
                        {!isUploading && !isProcessing && !isRendering && "Generate Captions"}
                      </button>
                    )}

                    {isEditing && (
                      <button 
                        onClick={handleBurnVideo}
                        className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-lg w-full transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer"
                      >
                        Approve & Burn Video
                      </button>
                    )}

                    {finalVideo && (
                      <button 
                        onClick={() => { setFile(null); setPreviewUrl(null); setTranscript(null); setFinalVideo(null); setIsEditing(false); }}
                        className="px-4 py-3 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white font-semibold text-sm rounded-lg w-full transition-colors cursor-pointer"
                      >
                        Process Another Video
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            
          </div>
        </div>
      </div>
    </div>
  );
}