const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

type ChatOptions = {
  model: string;
  messages: OpenRouterMessage[];
  responseFormatJson?: boolean;
  /** 当 HTTP 响应头到达时调用（意味着服务端已收到完整请求体，即上传完成） */
  onUploadComplete?: () => void;
};

export async function callOpenRouter({
  model,
  messages,
  responseFormatJson = false,
  onUploadComplete,
}: ChatOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OPENROUTER_API_KEY，请先在 .env 配置。");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_TITLE ?? "Essay Library",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(responseFormatJson
        ? { response_format: { type: "json_object" } }
        : undefined),
      temperature: 0.1,
    }),
  });

  // 响应头到达 = 服务端已收到完整请求体（上传完毕），之后是等待 LLM 生成
  onUploadComplete?.();

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter 请求失败: ${response.status} ${errText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter 未返回有效内容。");
  }
  return content;
}
