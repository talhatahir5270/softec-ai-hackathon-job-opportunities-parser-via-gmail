import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ClientShell } from "@/components/ClientShell";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KhushPush404 — Opportunity Inbox Copilot",
  description: "Student profile, demo inbox, Gmail, and AI categorization",
  icons: {
    icon: "/khushPush_logo.png",
    apple: "/khushPush_logo.png",
  },
  openGraph: {
    title: "KhushPush404",
    images: [{ url: "/khushPush_logo.png", width: 1200, height: 630, alt: "KhushPush404" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/khushPush_logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
