import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/app/providers";
import { TopBar } from "@/app/_components/TopBar";

export const metadata: Metadata = {
  title: "Bstand",
  description: "Schnelle mobile Inventory-App.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--background)] text-black">
        <AuthProvider>
          <TopBar />
          <div className="flex-1 flex flex-col pt-[76px]">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
