import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ResearchHistoryProvider } from "@/hooks/ResearchHistoryContext";
import { AuthProvider } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
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
        <AuthProvider>
          <ResearchHistoryProvider>
            <ClientLayout>{children}</ClientLayout>
          </ResearchHistoryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
