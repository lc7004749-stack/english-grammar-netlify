import { SavedProblem } from "../types";

interface SolveOptions {
  image?: {
    base64: string;
    mimeType: string;
  };
  text?: string;
}

// Helper for exponential backoff
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const wait = Math.min(8000, 500 * Math.pow(2, attempt));
      await delay(wait);
    }
  }
  throw lastError;
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildMessages(prompt: string, options: SolveOptions) {
  const parts: ChatContentPart[] = [{ type: "text", text: prompt }];

  if (options.image?.base64 && options.image?.mimeType) {
    const cleanBase64 = options.image.base64.split(",")[1] || options.image.base64;
    const dataUrl = `data:${options.image.mimeType};base64,${cleanBase64}`;
    parts.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  if (options.text) {
    parts.push({ type: "text", text: `\n\n【题目文本】\n${options.text}` });
  }

  return [{ role: "user", content: parts }];
}

async function callChatCompletions(payload: any): Promise<any> {
  const res = await fetch("/.netlify/functions/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "chat/completions", payload }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return await res.json();
}

function pickText(result: any): string {
  return result?.choices?.[0]?.message?.content ?? "";
}

// 去掉模型偶尔输出的 ```html ``` 包裹
function stripCodeFences(s: string): string {
  return (s || "")
    .replace(/```html\s*/gi, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * Step 1：题目核对/纠错（输出纯文本题干）
 */
export const verifyProblem = async (options: SolveOptions): Promise<string> => {
  const prompt = `你是一个小学英语题目的“题干质检老师”。请做题目核对/纠错：
1) 如果图片/文字里有乱码、缺字、重复、分页断句，请自动修复为一份“可做题的完整题目”。
2) 只输出【修复后的题目正文】（不要解释、不要标题、不要多余话）。
3) 英语大小写、标点、换行尽量保持题目原样。`;

  return await callWithRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: buildMessages(prompt, options),
      temperature: 0.2,
    };
    const json = await callChatCompletions(payload);
    return pickText(json).trim();
  });
};

/**
 * Step 2：深度解析（必须输出：纯 HTML，且使用固定 class 名）
 * 说明：SolutionViewer 用 dangerouslySetInnerHTML，所以这里必须返回 HTML 片段。
 */
export const solveProblem = async (options: SolveOptions): Promise<string> => {
  const prompt = `你现在的身份是“资深英语私教”，面向小学高年级孩子讲解。
请解析题目，并输出一段【纯 HTML 代码片段】——注意：严禁输出 Markdown（例如 **、###、-、\`\`\` 等都不要出现）。

【输出要求】
- 直接从 <div> 开始写，不要写 <!doctype>、<html>、<head>。
- 必须使用下面这些 class 名（用于套用我现有页面样式）：
  tags-container / level-tag grammar
  highlight-legend / legend-item / legend-dot subject|verb|tense|object|keyword
  original-problem
  reading-tips
  grammar-analysis
  final-answer
  subject-highlight / verb-highlight / tense-highlight / object-highlight / keyword-highlight

【必须包含的结构（照着写）】

1) 右上角考点标签：
<div class="tags-container">
  <span class="level-tag grammar">考点1</span>
  <span class="level-tag grammar">考点2</span>
</div>

2) 图例：
<div class="highlight-legend">
  <div class="legend-item"><span class="legend-dot subject"></span>主语</div>
  <div class="legend-item"><span class="legend-dot verb"></span>谓语/动词</div>
  <div class="legend-item"><span class="legend-dot tense"></span>时态/时间</div>
  <div class="legend-item"><span class="legend-dot object"></span>宾语/名词</div>
  <div class="legend-item"><span class="legend-dot keyword"></span>关键词/介词</div>
</div>

3) 原题复述（必须做成分高亮）：
<div class="original-problem">
  <!-- 把题目复述出来，并用高亮 span 包住关键成分 -->
</div>

高亮规则：
- 主语：<span class="subject-highlight">...</span>
- 动词/谓语：<span class="verb-highlight">...</span>
- 时态信号词/频率词：<span class="tense-highlight">...</span>
- 宾语/名词：<span class="object-highlight">...</span>
- 介词/关键固定搭配/助动词：<span class="keyword-highlight">...</span>

4) 破题眼（2-3条，口吻要像讲给孩子听）：
<div class="reading-tips">
  <h3>🕵️ 资深私教·破题眼</h3>
  <ul class="list-none pl-0 mt-3 space-y-4">
    <li class="flex items-start gap-3">
      <span class="flex-shrink-0 font-bold text-orange-700 bg-orange-50 px-2 py-1 rounded border border-orange-200 text-sm mt-0.5">👀 1. 盯住信号</span>
      <div class="text-slate-700 leading-relaxed">...</div>
    </li>
    <li class="flex items-start gap-3">
      <span class="flex-shrink-0 font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded border border-indigo-200 text-sm mt-0.5">🧠 2. 逻辑分析</span>
      <div class="text-slate-700 leading-relaxed">...</div>
    </li>
  </ul>
</div>

5) 核心语法（必须举例子，用类比，小学生能听懂）：
<div class="grammar-analysis">
  <h3>📚 核心语法·讲给孩子听</h3>
  <p class="mb-2">...</p>
  <div class="bg-white/60 p-3 rounded-lg border border-purple-100 mt-2">
    <p class="text-sm font-bold text-purple-700">🌰 举个栗子：</p>
    <p class="text-slate-600 text-sm">...</p>
  </div>
</div>

6) 最终答案（简洁）：
<div class="final-answer">✅ 正确答案：...</div>

【题目】：
（如果有图片，以图片为准；如果有文字，以文字为准。）
`;

  return await callWithRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: buildMessages(prompt, options),
      temperature: 0.25,
    };
    const json = await callChatCompletions(payload);
    return stripCodeFences(pickText(json));
  });
};

/**
 * Step 3：错题本报告（返回 HTML）
 */
export const analyzeProblemHistory = async (problems: SavedProblem[]): Promise<string> => {
  const prompt = `你是教研员。请基于“题库记录”输出一份【学习诊断报告】的纯 HTML 片段（严禁 Markdown）。
要求：用小标题/要点列表，适合家长阅读。
题库JSON：\n${JSON.stringify(problems).slice(0, 120000)}`;

  return await callWithRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    };
    const json = await callChatCompletions(payload);
    return stripCodeFences(pickText(json));
  });
};

/**
 * Step 4：变式训练（返回 HTML，配合打印模式 details）
 */
export const generateDrills = async (originalProblem: string, solutionContext: string): Promise<string> => {
  const prompt = `你是一位小学英语语法老师。请围绕“原题”生成【6道同型变式训练】并给出答案。
必须输出【纯 HTML 片段】，严禁 Markdown，严禁 \`\`\`。
结构要求：
- 外层不要写 <html><head>，只输出内容片段
- 用 <div class="drill-item"> 包每一题
- 题干放 <div class="drill-question">
- 答案解析放 <div class="drill-answer"><details>...</details></div>
- 每题给 4 个选项（A/B/C/D）或按原题题型组织
原题：\n${originalProblem}\n\n参考解答：\n${solutionContext}`;

  return await callWithRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
    };
    const json = await callChatCompletions(payload);
    return stripCodeFences(pickText(json));
  });
};

export const generateSpeech = async (solutionHtml: string): Promise<string> => {
  const text = solutionHtml.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim().slice(0, 1200);

  return await callWithRetry(async () => {
    const res = await fetch("/.netlify/functions/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `我来为你讲解：${text}` }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json?.audio_base64 || "";
  });
};
