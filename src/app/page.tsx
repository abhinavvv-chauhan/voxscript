"use client";

import { useState } from "react";
import { Upload, Sparkles, Zap, ShieldCheck, PlayCircle, Loader2 } from "lucide-react";

export default function Home() {
  const [isRendering, setIsRendering] = useState(false);
  const [finalVideo, setFinalVideo] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileKey, setUploadedFileKey] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState<any[] | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
    }
  };

  // The Automated 1-Click Pipeline
  const handleMagicGenerate = async () => {
    if (!file) return;
    
    // Reset states for a fresh run
    setTranscript(null);
    setFinalVideo(null);
    
    try {
      // 1. Upload Phase
      setIsUploading(true);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!uploadRes.ok) throw new Error("Failed to get upload token");
      const { uploadUrl, fileKey } = await uploadRes.json();

      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setIsUploading(false);

      // 2. AI Processing Phase
      setIsProcessing(true);
      const processRes = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey }),
      });
      if (!processRes.ok) throw new Error("AI Processing failed");
      const { words } = await processRes.json();
      setTranscript(words);
      setIsProcessing(false);

      // 3. Rendering Phase
      setIsRendering(true);
      const renderRes = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey, words }), 
      });
      if (!renderRes.ok) throw new Error("Video Render failed");
      const { finalUrl } = await renderRes.json();
      
      // 4. Success!
      setFinalVideo(finalUrl);

    } catch (error) {
      console.error("Pipeline crashed:", error);
      alert("Something went wrong. Check the console.");
    } finally {
      setIsUploading(false);
      setIsProcessing(false);
      setIsRendering(false);
    }
  };

  const handleRender = async () => {
    if (!file || !transcript) return;
    setIsRendering(true);

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey: uploadedFileKey, words: transcript }), 
      });

      if (!response.ok) throw new Error("Render failed");
      
      const data = await response.json();
      setFinalVideo(data.finalUrl); 

    } catch (error) {
      console.error("Render error:", error);
      alert("Failed to render final video. Check console.");
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
                

                {/* Action Buttons & Status */}
                <div className="flex flex-col gap-3 w-full mt-4">
                  
                  {/* Final Download Box */}
                  {finalVideo && (
                    <div className="w-full bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 text-center mb-2">
                       <h4 className="text-cyan-400 font-bold mb-3">Render Complete!</h4>
                       <a href={finalVideo} target="_blank" rel="noreferrer" download className="inline-block px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded shadow-lg transition-colors">
                         Download Finished Video
                       </a>
                    </div>
                  )}

                  <div className="flex gap-3 w-full">
                    {!finalVideo && (
                      <button 
                        onClick={() => { setFile(null); setPreviewUrl(null); }}
                        disabled={isUploading || isProcessing || isRendering}
                        className="px-4 py-3 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white font-semibold text-sm rounded-lg flex-1 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                    
                    {/* The Single Magic Button */}
                    {!finalVideo && (
                      <button 
                        onClick={handleMagicGenerate}
                        disabled={isUploading || isProcessing || isRendering}
                        className="px-4 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm rounded-lg flex-[2] flex justify-center items-center gap-2 transition-colors disabled:opacity-50 shadow-[0_0_15px_rgba(14,165,233,0.3)] cursor-pointer"
                      >
                        {isUploading && "1/3: Uploading to Cloud..."}
                        {isProcessing && "2/3: AI Analyzing Audio..."}
                        {isRendering && "3/3: Burning Pixels..."}
                        {!isUploading && !isProcessing && !isRendering && "Generate Captions"}
                      </button>
                    )}

                    {finalVideo && (
                      <button 
                        onClick={() => { setFile(null); setPreviewUrl(null); setTranscript(null); setFinalVideo(null); }}
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