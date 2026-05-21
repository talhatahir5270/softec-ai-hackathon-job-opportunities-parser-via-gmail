"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function UxoraButton({ 
  href, 
  isDark, 
  whiteBtn = false, 
  children 
}: { 
  href: string; 
  isDark: boolean; 
  whiteBtn?: boolean; 
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "uxora-default-btn px-8 py-[17px] rounded-[3px] font-bold text-base leading-[1.5em] transition-all duration-[0.4s] relative overflow-hidden whitespace-nowrap inline-flex items-center justify-center gap-2 group",
        whiteBtn
          ? isDark
            ? "bg-white text-black border border-white hover:text-white hover:border-zinc-300"
            : "bg-white text-black border border-white hover:text-white hover:border-zinc-300"
          : isDark
            ? "bg-white text-black border border-white hover:text-white hover:border-zinc-300"
            : "bg-black text-white border border-black hover:text-black hover:border-zinc-300"
      )}
    >
      <span className="relative z-10 flex items-center gap-2">
        {children}
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
      </span>
      {/* Hover effect circle */}
      <span className={cn(
        "absolute top-[1%] left-0 w-[200px] h-[300px] rounded-full opacity-0 scale-[0.1] transition-all duration-500 -translate-x-[10px] -translate-y-[70px] z-0",
        whiteBtn
          ? isDark ? "bg-black" : "bg-black"
          : isDark ? "bg-black" : "bg-white",
        "group-hover:opacity-100 group-hover:scale-[1.5]"
      )}></span>
    </Link>
  );
}
