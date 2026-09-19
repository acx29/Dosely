import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Fonts come from the `geist` package, so they are bundled locally.
// No request to Google Fonts at build or run time, which matters on venue wifi.

export const metadata: Metadata = {
  title: "Dosely",
  description: "Patient recall inside the prescribing workflow. Demo with synthetic data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
