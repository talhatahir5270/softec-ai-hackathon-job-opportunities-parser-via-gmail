"use client";

import React from "react";
import Link from "next/link";
import { Mail, Zap, Inbox, Sparkles, ChevronRight, ArrowUpRight } from "lucide-react";
// Ensure this hook exists in your project directory
import { useAnimeAnimation } from "./use-anime-animation";

function cn(...classes: (string | undefined | boolean)[]) {
  return classes.filter(Boolean).join(" ");
}

const FloatingBadge = ({ 
  icon: Icon, 
  text, 
  subtext, 
  delay = 0, 
  className 
}: { 
  icon: any, 
  text: string, 
  subtext?: string, 
  delay?: number, 
  className?: string 
}) => (
  <div 
    className={cn(
      "absolute flex items-center gap-3 p-3 rounded-2xl border border-zinc-200 bg-white/90 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-float z-20",
      className
    )}
    style={{ animationDelay: `${delay}s` }}
  >
    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-50 shadow-inner">
      <Icon className="w-5 h-5 text-zinc-800" />
    </div>
    <div className="flex flex-col">
      <span className="text-sm font-bold tracking-tight text-zinc-900">{text}</span>
      {subtext && (
        <span className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-widest font-bold">
          {subtext}
        </span>
      )}
    </div>
  </div>
);

export default function HeroSection() {
  const heroContentRef = useAnimeAnimation({
    onview: -100,
    targets: ">*",
    translateY: [30, 0],
    opacity: [0, 1],
    easing: "easeOutExpo",
    duration: 600,
    delay: (el: HTMLElement, i: number) => 100 + i * 80,
  });

  const heroDashboardRef = useAnimeAnimation({
    onview: -100,
    targets: ">*",
    scale: [0.95, 1],
    opacity: [0, 1],
    easing: "easeOutExpo",
    duration: 800,
    delay: 400,
  });

  return (
    <div className="relative pt-[120px] pb-20 px-4 overflow-hidden bg-white min-h-screen flex flex-col justify-center font-sans">
      
      <style jsx global>{`
        @keyframes soundwave {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-15px); }
        }
        .animate-soundwave {
          background-size: 200% auto;
          animation: soundwave 5s linear infinite;
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        /* The "Gmail AI" Multi-color Gradient */
        .gmail-gradient {
          background: linear-gradient(
            90deg, 
            #4285F4 0%, 
            #34A853 25%, 
            #FBBC05 50%, 
            #EA4335 75%, 
            #4285F4 100%
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
      `}</style>

      {/* Decorative background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      <div className="container max-w-6xl mx-auto relative z-10">
        <div ref={heroContentRef} className="text-center max-w-4xl mx-auto">
          
          <div className="mb-6 flex justify-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-100 bg-zinc-50/50 hover:bg-zinc-50 transition-colors cursor-default">
              <div className="flex -space-x-1">
                <div className="w-2 h-2 rounded-full bg-[#4285F4]" />
                <div className="w-2 h-2 rounded-full bg-[#EA4335]" />
                <div className="w-2 h-2 rounded-full bg-[#FBBC05]" />
              </div>
              <span className="text-[11px] font-bold tracking-tighter uppercase text-zinc-500">
                Next-Gen Inbox Intelligence
              </span>
            </div>
          </div>

          <h1 className="text-6xl md:text-[84px] font-extrabold tracking-[-0.04em] text-[#202124] mb-8 leading-[0.95]">
            Stop searching.<br />
            <span className="animate-soundwave gmail-gradient">
                Start discovering.
            </span>
          </h1>

          <p className="text-xl md:text-2xl leading-snug text-zinc-500 max-w-2xl mx-auto mb-12 font-medium tracking-tight">
            KhushPush404 is the industry-grade copilot that scores your Gmail inbox to surface 
            high-fit opportunities before they go cold.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center mb-20">
            <Link
              href="/profile"
              className="group h-14 px-10 flex items-center justify-center bg-[#0b57d0] hover:bg-[#0842a8] text-white font-bold rounded-full transition-all duration-300 shadow-xl shadow-blue-500/10 active:scale-95"
            >
              Configure AI Profile
              <ArrowUpRight className="ml-2 w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </Link>
            <Link
              href="/inbox"
              className="h-14 px-10 flex items-center justify-center bg-white border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-900 font-bold rounded-full transition-all duration-300 active:scale-95"
            >
              View My Inbox
            </Link>
          </div>
        </div>

        <div ref={heroDashboardRef} className="relative max-w-5xl mx-auto">
          {/* Floating Badges */}
          <FloatingBadge 
            icon={Sparkles} 
            text="High Relevancy" 
            subtext="9.8/10 Score" 
            delay={0}
            className="-left-12 top-0 hidden lg:flex"
          />
          <FloatingBadge 
            icon={Zap} 
            text="Live Extraction" 
            subtext="Real-time Sync" 
            delay={1.5}
            className="-right-12 top-24 hidden lg:flex"
          />
          <FloatingBadge 
            icon={Inbox} 
            text="Clean Workflow" 
            subtext="No more spam" 
            delay={3}
            className="-left-6 bottom-12 hidden lg:flex"
          />

          {/* Premium UI Mockup */}
          <div className="relative rounded-[32px] border border-zinc-200 bg-white p-4 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] overflow-hidden">
            <div className="rounded-[20px] border border-zinc-100 bg-zinc-50/30 h-[450px] w-full relative overflow-hidden">
              
              {/* Internal Mock content */}
              <div className="absolute inset-0 p-8">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                    <Mail className="text-white w-6 h-6" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-4 w-32 bg-zinc-200 rounded-full" />
                    <div className="h-3 w-20 bg-zinc-100 rounded-full" />
                  </div>
                </div>

                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="p-4 rounded-xl bg-white border border-zinc-100 flex items-center justify-between">
                      <div className="flex items-center gap-4 w-2/3">
                        <div className="w-8 h-8 rounded-full bg-zinc-50" />
                        <div className="h-3 w-full bg-zinc-100 rounded-full" />
                      </div>
                      <div className="h-3 w-12 bg-blue-50 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Gradient overlay for depth */}
              <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-blue-50/50 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}