import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoxScript | AI-Powered Video Captions",
  description: "Transform your short-form content with professional captions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="relative min-h-screen bg-black text-zinc-100 overflow-x-hidden">
        
        <div className="absolute top-[-10%] left-[-5%] w-[45vw] h-[45vw] rounded-full bg-cyan-500/10 blur-[140px] -z-10 pointer-events-none mix-blend-screen" />
        <div className="absolute bottom-[5%] right-[-5%] w-[35vw] h-[35vw] rounded-full bg-blue-600/10 blur-[140px] -z-10 pointer-events-none mix-blend-screen" />

        <nav className="fixed top-4 left-1/2 -translate-x-1/2 w-[95%] max-w-6xl z-50">
          <div className="flex justify-between items-center px-6 py-2.5 liquid-glass-nav">
            <div className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              VoxScript
            </div>
            
            <div className="flex gap-5 items-center">
              <button className="text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer">
                Pricing
              </button>

            </div>
          </div>
        </nav>

        <main className="pt-20 min-h-screen flex flex-col">{children}</main>
      </body>
    </html>
  );
}