import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "elowen-hormonal-health.ratarokhshad.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") || "https";
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "Elowen: Honest hormonal-health context",
    description: "A calm, transparent research tool for exploring menstrual-status patterns.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "Elowen", description: "Honest hormonal-health context from public research data.", images: [{ url: image, width: 1200, height: 630, alt: "Elowen, honest context for women’s hormonal health" }] },
    twitter: { card: "summary_large_image", title: "Elowen", description: "Honest hormonal-health context from public research data.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
