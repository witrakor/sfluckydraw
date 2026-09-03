import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const notoSansThai = Noto_Sans_Thai({
  subsets: ["latin", "thai"],
  variable: "--font-modern-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SF Lucky Seat Randomizer",
  description: "Interactive cinema seat randomizer for prize drawing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={notoSansThai.variable} lang="th">
      <body>{children}</body>
    </html>
  );
}
