import type { Metadata } from "next";
import { Inter, Newsreader, JetBrains_Mono } from "next/font/google";
import { PostHogProvider } from "@/components/PostHogProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  style: ["normal", "italic"],
});

// Monospace for data, labels, and metrics — the brutalist "instrument panel"
// register that separates machine-read numbers from prose.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Zybit — Clarity over intuition",
  description:
    "Zybit turns real user behavior into ranked product and UX changes aimed at actual pain—stalls, confusion, drop-offs—not generic redesigns. Behavior-first decisions your team can explain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <PostHogProvider>
          {children}
        </PostHogProvider>
      </body>
    </html>
  );
}
