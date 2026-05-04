import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ResearchHistoryProvider } from "@/hooks/ResearchHistoryContext";
import AppNav from "@/components/AppNav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "EMB TalentOS — Demand Generation",
  description: "Automated pipeline: job signals → ICP enrichment → personalised outreach → Instantly.",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1E40AF",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-brand-surface text-brand-secondary min-h-screen`} suppressHydrationWarning>
        <ResearchHistoryProvider>
          <div className="flex min-h-screen">
            <AppNav />
            <main className="flex-1 ml-56 overflow-auto">{children}</main>
          </div>
        </ResearchHistoryProvider>
      </body>
    </html>
  );
}
