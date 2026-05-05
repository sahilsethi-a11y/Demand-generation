"use client";

import { usePathname } from "next/navigation";
import AppNav from "./AppNav";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <AppNav />
      <main className="flex-1 ml-56 overflow-auto">{children}</main>
    </div>
  );
}
