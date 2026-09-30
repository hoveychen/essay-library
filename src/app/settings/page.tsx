"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppConfig, getSettings } from "@/lib/client-api";

const defaultConfig: AppConfig = {
  ocrPrompt: "",
  matchPrompt: "",
  ocrModel: "deepseek-flash",
  matchModel: "deepseek-flash",
  scoringModel: "deepseek-flash",
  apiKey: "",
};

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [message, setMessage] = useState("就绪");

  useEffect(() => {
    getSettings()
      .then((data) => setConfig(data))
      .catch((e) => setMessage(`加载失败: ${String(e)}`));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "保存失败");
      return;
    }
    setConfig(data);
    setMessage("配置已保存");
  }

  return (
    <main className="page-wrap space-y-4">
      <h1 className="title-lg">模型配置</h1>
      <p className="status-bar">{message}</p>

      <form onSubmit={save} className="glass-card space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label>OCR 模型</label>
            <input
              value={config.ocrModel}
              onChange={(e) => setConfig((c) => ({ ...c, ocrModel: e.target.value }))}
              className="field"
            />
          </div>
          <div className="space-y-1">
            <label>匹配模型</label>
            <input
              value={config.matchModel}
              onChange={(e) => setConfig((c) => ({ ...c, matchModel: e.target.value }))}
              className="field"
            />
          </div>
          <div className="space-y-1">
            <label>评分模型</label>
            <input
              value={config.scoringModel}
              onChange={(e) => setConfig((c) => ({ ...c, scoringModel: e.target.value }))}
              className="field"
            />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <textarea
            value={config.ocrPrompt}
            onChange={(e) => setConfig((c) => ({ ...c, ocrPrompt: e.target.value }))}
            className="field h-56"
            placeholder="OCR Prompt"
          />
          <textarea
            value={config.matchPrompt}
            onChange={(e) => setConfig((c) => ({ ...c, matchPrompt: e.target.value }))}
            className="field h-56"
            placeholder="匹配 Prompt"
          />
        </div>

        <div className="space-y-1">
          <label>DeepSeek API Key</label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
            className="field"
            placeholder={config.apiKeyHint ? `已设置（${config.apiKeyHint}），留空不修改` : "sk-..."}
          />
          <p className="text-xs text-gray-500">用于 OCR、匹配和评分的 AI 接口密钥</p>
        </div>

        <button className="btn btn-primary" type="submit">
          保存配置
        </button>
      </form>
    </main>
  );
}
