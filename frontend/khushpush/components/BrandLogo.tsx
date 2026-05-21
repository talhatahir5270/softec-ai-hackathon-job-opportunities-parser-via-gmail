"use client";

import Image from "next/image";

const LOGO_SRC = "/khushPush_logo.png";

export type BrandLogoVariant = "nav" | "header" | "hero" | "compact";

const VARIANT_DIMS: Record<BrandLogoVariant, { width: number; height: number }> = {
  compact: { width: 112, height: 28 },
  nav: { width: 150, height: 36 },
  header: { width: 168, height: 40 },
  hero: { width: 240, height: 60 },
};

type BrandLogoProps = {
  variant?: BrandLogoVariant;
  className?: string;
  priority?: boolean;
};

/** KhushPush404 wordmark — `public/khushPush_logo.png` */
export function BrandLogo({ variant = "nav", className = "", priority }: BrandLogoProps) {
  const { width, height } = VARIANT_DIMS[variant];
  return (
    <Image
      src={LOGO_SRC}
      alt="KhushPush404"
      width={width}
      height={height}
      className={`max-w-full object-contain object-left ${className}`.trim()}
      style={{ width: "auto", height: "auto" }}
      priority={priority}
      sizes={`(max-width: 640px) 140px, ${width}px`}
    />
  );
}
