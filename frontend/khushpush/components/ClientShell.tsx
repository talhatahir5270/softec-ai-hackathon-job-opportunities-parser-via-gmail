"use client";

import { usePathname } from "next/navigation";

import { AppNav } from "@/components/AppNav";
import { EmailChatDock } from "@/components/EmailChatDock";

export function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const inboxChrome = pathname === "/inbox" || pathname.startsWith("/inbox/");

  return (
    <>
      {!inboxChrome ? <AppNav /> : null}
      <main
        className={
          inboxChrome
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        {children}
      </main>
      <EmailChatDock />
    </>
  );
}
