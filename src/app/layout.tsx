import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "作文库管理系统",
  description: "学生作文批量OCR与题目匹配",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const menus = [
    { href: "/", label: "首页" },
    { href: "/students", label: "学生库" },
    { href: "/topics", label: "题目库" },
    { href: "/upload", label: "上传" },
    { href: "/quick-upload", label: "一键评分" },
    { href: "/gallery", label: "作文板块" },
    { href: "/essays", label: "作文管理" },
    { href: "/scoring", label: "评分" },
    { href: "/stats", label: "统计" },
    { href: "/settings", label: "模型配置" },
  ];

  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-white/70 bg-white/70 backdrop-blur-xl">
          <nav className="mx-auto flex w-full max-w-7xl flex-wrap gap-2 px-4 py-3 md:px-8">
            {menus.map((item) => (
              <Link key={item.href} href={item.href} className="nav-chip">
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </body>
    </html>
  );
}
