import Link from "next/link";

const cards = [
  {
    href: "/students",
    title: "学生库",
    desc: "新增学生并查看所有学生。",
  },
  {
    href: "/topics",
    title: "题目库",
    desc: "维护作文题目与写作要求。",
  },
  {
    href: "/upload",
    title: "上传页面",
    desc: "上传扫描图，支持多页合并为一篇。",
  },
  {
    href: "/essays",
    title: "作文管理",
    desc: "执行 OCR、自动匹配与人工确认绑定。",
  },
  {
    href: "/scoring",
    title: "作文评分",
    desc: "AI 四维度评分：论点立意、论据素材、逻辑结构、语言表达。",
  },
  {
    href: "/stats",
    title: "统计",
    desc: "按学生与题目查看矩阵统计，可打开查看扫描图。",
  },
  {
    href: "/settings",
    title: "模型配置",
    desc: "配置 OpenRouter 模型和 Prompt。",
  },
];

export default function HomePage() {
  return (
    <main className="page-wrap space-y-6">
      <h1 className="title-xl">作文库管理系统</h1>
      <p className="subtle">系统已改为多页面，点击下方模块进入。</p>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="glass-card p-5 transition hover:-translate-y-0.5">
            <h2 className="text-lg font-semibold tracking-tight">{card.title}</h2>
            <p className="mt-2 text-sm subtle">{card.desc}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
