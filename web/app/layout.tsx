import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import "./globals.css";

// Fonts come from the `geist` package, so they are bundled locally.
// No request to Google Fonts at build or run time, which matters on venue wifi.
// The wordmark font is a file in app/fonts/ for the same reason.
const goudy = localFont({
  src: "./fonts/GoudyBookletter1911.ttf",
  weight: "400",
  style: "normal",
  variable: "--font-goudy",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dosely",
  description: "Patient recall inside the prescribing workflow. Demo with synthetic data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${goudy.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
