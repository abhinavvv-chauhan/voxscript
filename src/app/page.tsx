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
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
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
        const highlightText = chunk
          .map((cw, idx) =>
            idx === j ? `{\\c&H00E9A50E&}${cw.word}{\\c&HFFFFFF&}` : cw.word
          )
          .join(" ");
        assContent += `Dialogue: 0,${formatTime(w.start)},${formatTime(w.end)},TikTok,,0,0,0,,${highlightText}\n`;
        if (j < chunk.length - 1) {
          const nextWord = chunk[j + 1];
          if (nextWord.start - w.end > 0.05) {
            const whiteText = chunk.map((cw) => cw.word).join(" ");
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
      if (!ffmpegRef.current) ffmpegRef.current = new FFmpeg();
      const ffmpeg = ffmpegRef.current;
      ffmpeg.on("progress", ({ progress }) => {
        console.log(`FFmpeg Progress: ${Math.round(progress * 100)}%`);
      });
      const baseURL = "/ffmpeg";
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        });
      }
      await ffmpeg.writeFile("input.mp4", await fetchFile(file));
      const CHUNK_DURATION = 50;
      await ffmpeg.exec([
        "-i", "input.mp4", "-vn", "-acodec", "pcm_s16le",
        "-ar", "16000", "-ac", "1", "-f", "segment",
        "-segment_time", `${CHUNK_DURATION}`, "chunk_%03d.wav",
      ]);
      const files = await ffmpeg.listDir("/");
      const chunkFiles = files
        .filter((f) => f.name.startsWith("chunk_") && f.name.endsWith(".wav"))
        .map((f) => f.name)
        .sort();
      setIsUploading(false);
      setIsProcessing(true);
      const transcriptPromises = chunkFiles.map(async (chunkName, index) => {
        const audioData = await ffmpeg.readFile(chunkName);
        const audioBlob = new Blob([audioData as any], { type: "audio/wav" });
        const formData = new FormData();
        formData.append("audio", audioBlob, chunkName);
        const res = await fetch("/api/process", { method: "POST", body: formData });
        if (!res.ok) throw new Error(`AI Processing failed for ${chunkName}`);
        const { words } = await res.json();
        const timeOffset = index * CHUNK_DURATION;
        return words.map((w: any) => ({ ...w, start: w.start + timeOffset, end: w.end + timeOffset }));
      });
      const resolvedChunks = await Promise.all(transcriptPromises);
      setTranscript(resolvedChunks.flat());
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
      const fontURL = "https://raw.githubusercontent.com/ffmpegwasm/testdata/master/arial.ttf";
      await ffmpeg.writeFile("arial.ttf", await fetchFile(fontURL));
      const assString = generateAssString(transcript);
      await ffmpeg.writeFile("subs.ass", new TextEncoder().encode(assString));
      await ffmpeg.exec(["-i", "input.mp4", "-vf", "ass=subs.ass:fontsdir=/", "-preset", "ultrafast", "output.mp4"]);
      const data = await ffmpeg.readFile("output.mp4");
      const finalBlob = new Blob([data as any], { type: "video/mp4" });
      setFinalVideo(URL.createObjectURL(finalBlob));
    } catch (error) {
      console.error("Render crashed:", error);
      alert("Failed to render final video.");
    } finally {
      setIsRendering(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreviewUrl(null);
    setTranscript(null);
    setFinalVideo(null);
    setIsEditing(false);
  };

  const isBusy = isUploading || isProcessing || isRendering;

  return (
    <>
      <style>{`
        /* ── Word chip ── */
        .word-chip { transition: background 0.15s, border-color 0.15s, box-shadow 0.15s; }
        .word-chip:focus {
          outline: none;
          border-color: rgb(6 182 212);
          box-shadow: 0 0 0 3px rgba(6,182,212,0.15);
          background: #000;
        }

        /* ── Transcript editor slide-in ── */
        .editor-panel {
          overflow: hidden;
          max-height: 0;
          opacity: 0;
          transition: max-height 0.55s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease 0.15s;
        }
        .editor-panel.visible { max-height: 1100px; opacity: 1; }

        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .editor-header { animation: fadeSlideUp 0.4s ease 0.3s both; }

        /* ── Spinner ── */
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(6,182,212,0.3);
          border-top-color: rgb(6 182 212);
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
          flex-shrink: 0;
        }

        /* ══════════════════════════════════════════
           MOBILE  (< 1024 px) — single column
        ══════════════════════════════════════════ */
        .page-layout {
          display: flex;
          flex-direction: column;
          width: 100%;
          gap: 1.25rem;
          padding: 1.25rem 0 2.5rem;
        }

        /* Hero collapses once a file is picked on mobile */
        .hero-col {
          overflow: hidden;
          transition: max-height 0.45s cubic-bezier(0.4,0,0.2,1),
                      opacity 0.35s ease,
                      margin-bottom 0.35s ease;
          max-height: 600px;
          opacity: 1;
        }
        .hero-col.collapsed {
          max-height: 0;
          opacity: 0;
          margin-bottom: -1.25rem; /* absorb the gap */
          pointer-events: none;
        }

        /* Video preview */
        .video-preview {
          width: 100%;
          border-radius: 0.75rem;
          overflow: hidden;
          background: #000;
          border: 1px solid #27272a;
          aspect-ratio: 16/9;
        }
        .video-preview video { width: 100%; height: 100%; object-fit: contain; display: block; }

        /* Buttons — stacked on mobile */
        .btn-row { display: flex; flex-direction: column; gap: 0.625rem; width: 100%; margin-top: 0.875rem; }

        .btn {
          width: 100%; padding: 0.9rem 1rem; border-radius: 0.75rem;
          font-size: 0.9375rem; font-weight: 700; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          transition: background 0.18s, opacity 0.18s;
        }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary  { background: rgb(8 145 178); color: #fff; box-shadow: 0 0 18px rgba(14,165,233,0.3); }
        .btn-primary:not(:disabled):hover  { background: rgb(6 182 212); }
        .btn-success  { background: rgb(5 150 105); color: #fff; box-shadow: 0 0 18px rgba(16,185,129,0.25); }
        .btn-success:hover  { background: rgb(16 185 129); }
        .btn-ghost    { background: #18181b; border: 1px solid #27272a; color: #d4d4d8; }
        .btn-ghost:not(:disabled):hover { color: #fff; background: #27272a; }

        /* Progress badge */
        .progress-badge {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.625rem 1rem; margin-top: 0.75rem;
          background: rgba(6,182,212,0.08); border: 1px solid rgba(6,182,212,0.2);
          border-radius: 0.625rem; color: rgb(103 232 249);
          font-size: 0.875rem; font-weight: 600;
        }

        /* ══════════════════════════════════════════
           DESKTOP  (≥ 1024 px) — two columns
           Normal state  : hero | card+editor
           Editing state : hero fades, card+editor expand to full width
        ══════════════════════════════════════════ */
        @media (min-width: 1024px) {
          .page-layout {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 3rem;
            align-items: start;
            padding: 2rem 0;
          }

          /* In editing mode: collapse hero column, right col spans full width */
          .page-layout.editing-mode {
            grid-template-columns: 1fr;   /* one column — right col only */
          }
          .page-layout.editing-mode .hero-col {
            display: none;               /* remove from flow entirely */
          }

          /* Hero never collapses on desktop (the .collapsed class is mobile-only) */
          .hero-col { max-height: none !important; opacity: 1 !important; }
          .hero-col.collapsed { max-height: none !important; opacity: 1 !important; pointer-events: auto !important; }

          /* Video: fixed height on desktop, no aspect-ratio constraint */
          .video-preview { aspect-ratio: unset; height: 240px; }

          /* Buttons side-by-side on desktop */
          .btn-row { flex-direction: row; }
          .btn-row .btn-ghost   { flex: 0 0 auto; width: auto; padding: 0.875rem 1.5rem; }
          .btn-row .btn-primary { flex: 2; }
          .btn-row .btn-success { flex: 1; }
          .btn-row .btn-ghost.full { flex: 1; } /* "Process Another" full width equivalent */
        }
      `}</style>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 w-full flex-1 flex flex-col justify-center">
        <div className={`page-layout${isEditing ? " editing-mode" : ""}`}>

          <div className={`hero-col space-y-4 lg:space-y-6 text-left${file ? " collapsed" : ""}`}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-widest">
              <Sparkles size={14} /> AI Video Captioning
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black tracking-tighter leading-[1.05] text-white">
              Captions that{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                demand attention.
              </span>
            </h1>

            <p className="text-zinc-400 text-sm sm:text-base lg:text-lg max-w-md font-medium leading-relaxed">
              VoxScript turns silent scrolls into active viewers. Upload your footage and let our AI craft
              pixel-perfect, word-level subtitles instantly.
            </p>

            <div className="flex flex-wrap gap-5 pt-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <div className="flex items-center gap-1.5"><Zap size={13} className="text-cyan-400" /> Lightning Fast</div>
              <div className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-emerald-500" /> Secure Pipeline</div>
            </div>
          </div>

          <div className="flex flex-col gap-4 min-w-0">

            <div className="relative group w-full">
              <div className="absolute -inset-0.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl blur-md opacity-20 group-hover:opacity-40 transition duration-500 pointer-events-none" />

              <div className="relative flex flex-col w-full bg-zinc-950 border border-zinc-900 rounded-2xl p-4 sm:p-6 overflow-hidden">

                {!previewUrl ? (
                  <div className="flex flex-col items-center w-full py-8 text-center">
                    <div className="mb-4 p-4 rounded-full bg-cyan-500/5 border border-cyan-500/10 text-cyan-400">
                      <Upload size={28} />
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold mb-1 text-zinc-100">Drop your footage</h2>
                    <p className="text-zinc-500 text-xs mb-6 leading-relaxed">
                      MP4, MOV or WebM · Optimal for 9:16 vertical · Max 50 MB
                    </p>
                    <label className="px-8 py-3.5 bg-zinc-100 text-black hover:bg-white font-bold text-sm rounded-xl cursor-pointer transition-all active:scale-95 shadow-lg select-none">
                      Select Video
                      <input type="file" className="hidden" accept="video/mp4,video/quicktime,video/webm" onChange={handleFileSelect} />
                    </label>
                  </div>
                ) : (
                  <>
                    <div className="video-preview mb-1">
                      <video src={previewUrl} controls playsInline />
                    </div>

                    {isBusy && (
                      <div className="progress-badge">
                        <span className="spinner" />
                        {isUploading  && "Step 1 / 3 · Extracting audio…"}
                        {isProcessing && "Step 2 / 3 · Generating transcript…"}
                        {isRendering  && "Step 3 / 3 · Burning subtitles…"}
                      </div>
                    )}

                    {finalVideo && (
                      <div className="w-full bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 text-center mt-3">
                        <p className="text-cyan-400 font-bold mb-3 text-sm">✓ Render complete!</p>
                        <a
                          href={finalVideo}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="block w-full px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-lg transition-colors text-sm text-center"
                        >
                          Download Finished Video
                        </a>
                      </div>
                    )}

                    <div className="btn-row">
                      {!finalVideo && !isEditing && (
                        <>
                          <button onClick={() => { setFile(null); setPreviewUrl(null); }} disabled={isBusy} className="btn btn-ghost">
                            Cancel
                          </button>
                          <button onClick={handleGenerateTranscript} disabled={isBusy} className="btn btn-primary">
                            {isBusy ? "Processing…" : "Generate Captions"}
                          </button>
                        </>
                      )}

                      {isEditing && (
                        <button onClick={handleBurnVideo} className="btn btn-success">
                          ✓ Approve &amp; Burn Video
                        </button>
                      )}

                      {finalVideo && (
                        <button onClick={handleReset} className="btn btn-ghost full">
                          Process Another Video
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className={`editor-panel${isEditing && transcript ? " visible" : ""}`}>
              <div className="relative group w-full">
                <div className="absolute -inset-0.5 bg-gradient-to-br from-cyan-500/50 to-blue-600/50 rounded-2xl blur-md opacity-10 pointer-events-none" />
                <div className="relative bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="editor-header flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-900/60">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)] flex-shrink-0" />
                      <span className="text-zinc-100 font-bold text-sm tracking-wide truncate">Transcript Editor</span>
                      {transcript && (
                        <span className="text-zinc-500 text-xs font-medium flex-shrink-0">{transcript.length} words</span>
                      )}
                    </div>
                    <span className="text-zinc-600 text-xs flex-shrink-0 ml-2">Tap any word to edit</span>
                  </div>

                  <div className="h-64 sm:h-72 lg:h-96 overflow-y-auto p-4 sm:p-5">
                    {transcript && (
                      <div className="flex flex-wrap content-start gap-x-1.5 gap-y-2 sm:gap-x-2 sm:gap-y-3">
                        {transcript.map((w, i) => (
                          <input
                            key={i}
                            type="text"
                            value={w.word}
                            onChange={(e) => handleWordChange(i, e.target.value)}
                            className="word-chip bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-100 px-2.5 py-2 rounded-lg text-sm outline-none text-center"
                            style={{ width: `calc(${Math.max(w.word.length, 2)}ch + 2rem)` }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}