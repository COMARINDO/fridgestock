import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/app/providers";

export const metadata: Metadata = {
  title: "Fridge Stock",
  description: "Schnelle Bestandsverwaltung für Getränke.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
