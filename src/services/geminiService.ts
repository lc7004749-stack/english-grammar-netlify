// src/services/geminiService.ts
import { SavedProblem } from "../types";

interface SolveOptions {
  image?: {
    base64: string;
    mimeType: string;
  };
  text?: string;
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

// =============== 工具函数 ===============

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetry = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= maxRetry; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(2000, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function toDataUrl(base64: string, mime: string) {
  const clean = base64.includes(",") ? base64.split(",")[1] : base64;
  return `data:${mime};base64,${clean}`;
}

function buildUserMessage(prompt: string, options: SolveOptions) {
  const parts: ChatContentPart[] = [{ type: "text", text: prompt }];

  if (options.image?.base64 && options.image?.mimeType) {
    parts.push({
      type: "image_url",
      image_url: { url: toDataUrl(options.image.base64, options.image.mimeType) },
    });
  }

  if (options.text?.trim()) {
    parts.push({ type: "text", text: `\n\n【题目文本】\n${options.text.trim()}` });
  }

  return [{ role: "user", content: parts }];
}

function pickContent(json: any): string {
  return json?.choices?.[0]?.message?.content ?? "";
}

// 去掉模型偶尔输出的 ```html ... ``` 包裹
function stripCodeFences(s: string): string {
  return (s || "")
    .replace(/```html\s*/gi, "")
    .replace(/```/g, "")
    .replace(/~~~html\s*/gi, "")
    .replace(/~~~/g, "")
    .trim();
}

// 简单判定：是否含 Markdown 迹象（用于兜底二次纠偏）
function looksLikeMarkdown(s: string): boolean {
  const t = s || "";
  if (t.includes("```") || t.includes("~~~")) return true;
  if (/\*\*.+\*\*/.test(t)) return true; // **bold**
  if (/^#{1,6}\s/m.test(t)) return true; // # title
  if (/^\s*[-*+]\s+/m.test(t)) return true; // - list
  return false;
}

// =============== LLM 调用（对接 Netlify Functions） ===============
// 这里假设你的 /.netlify/functions/llm 已经做了 “转发到 /chat/completions”
// 因为你现在站点能生成内容，说明这个接口是通的。
async function callLLMChatCompletions(payload: any): Promise<any> {
  const res = await fetch("/.netlify/functions/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `LLM HTTP ${res.status}`);
  }
  return await res.json();
}

// =============== 1）题干核对/纠错（纯文本） ===============

export const verifyProblem = async (options: SolveOptions): Promise<string> => {
  const prompt = `你是“小学英语题干质检老师”。请完成题干核对/纠错：
1) 如果有乱码、缺字、重复、分页断句，请自动修复成“可做题的完整题目”。
2) 只输出【修复后的题目正文】（不要解释、不要标题、不要编号）。
3) 英语大小写、标点、换行尽量保留题目原样。
`;

  return await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: buildUserMessage(prompt, options),
      temperature: 0.2,
    };
    const json = await callLLMChatCompletions(payload);
    return pickContent(json).trim();
  });
};

// =============== 2）解析（必须返回：纯 HTML 片段） ===============

export const solveProblem = async (options: SolveOptions): Promise<string> => {
  const basePrompt = `你现在的身份是“资深英语私教”，面向小学高年级孩子讲解。

【最重要的硬规则】
- 你只能输出“可直接渲染的 HTML 片段”，必须以 <div 开头，以 </div> 结尾。
- 严禁输出 Markdown：不允许出现 **、#、-、>、\`\`\`、~~~ 等任何 Markdown 符号。
- 如需强调请用 <strong>，标题用 <h3>，列表用 <ul><li>。
- 不要输出解释文字，不要输出“下面是…”，不要输出代码块围栏。
- 只输出 HTML，不要输出 JSON。

【输出要求】
- 直接从 <div> 开始写，不要写 <!doctype>、<html>、<head>。
- 必须使用这些 class 名（用于套用我现有页面样式）：
  tags-container / level-tag grammar
  highlight-legend / legend-item / legend-dot subject|verb|tense|object|keyword
  original-problem
  reading-tips
  grammar-analysis
  final-answer
  subject-highlight / verb-highlight / tense-highlight / object-highlight / keyword-highlight

【必须包含结构（照着写）】

<div class="tags-container">
  <span class="level-tag grammar">考点1</span>
  <span class="level-tag grammar">考点2</span>
</div>

<div class="highlight-legend">
  <div class="legend-item"><span class="legend-dot subject"></span>主语</div>
  <div class="legend-item"><span class="legend-dot verb"></span>谓语/动词</div>
  <div class="legend-item"><span class="legend-dot tense"></span>时态/时间</div>
  <div class="legend-item"><span class="legend-dot object"></span>宾语/名词</div>
  <div class="legend-item"><span class="legend-dot keyword"></span>关键词/介词</div>
</div>

<div class="original-problem">
  <!-- 把题目复述出来，并用高亮 span 包住关键成分 -->
</div>

高亮规则：
- 主语：<span class="subject-highlight">...</span>
- 动词/谓语：<span class="verb-highlight">...</span>
- 时态/时间/频率：<span class="tense-highlight">...</span>
- 宾语/名词：<span class="object-highlight">...</span>
- 介词/助动词/固定搭配：<span class="keyword-highlight">...</span>

<div class="reading-tips">
  <h3>🕵️ 资深私教·破题眼</h3>
  <ul class="list-none pl-0 mt-3 space-y-4">
    <li class="flex items-start gap-3">
      <span class="flex-shrink-0 font-bold text-orange-700 bg-orange-50 px-2 py-1 rounded border border-orange-200 text-sm mt-0.5">👀 1. 盯住信号</span>
      <div class="text-slate-700 leading-relaxed">...</div>
    </li>
    <li class="flex items-start gap-3">
      <span class="flex-shrink-0 font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded border border-indigo-200 text-sm mt-0.5">🧠 2. 规则变形</span>
      <div class="text-slate-700 leading-relaxed">...</div>
    </li>
  </ul>
</div>

<div class="grammar-analysis">
  <h3>📚 核心语法·讲给孩子听</h3>
  <p class="mb-2">用孩子能懂的比喻讲清楚规则。</p>
  <div class="bg-white/60 p-3 rounded-lg border border-purple-100 mt-2">
    <p class="text-sm font-bold text-purple-700">🌰 举个栗子：</p>
    <p class="text-slate-600 text-sm">给一个类似句子：原句 → 疑问句/答案。</p>
  </div>
</div>

<div class="final-answer">✅ 正确答案：...</div>

【题目】（有图片以图片为准；有文字以文字为准）：`;

  const firstTry = await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: buildUserMessage(basePrompt, options),
      temperature: 0.25,
    };
    const json = await callLLMChatCompletions(payload);
    return stripCodeFences(pickContent(json));
  });

  // 兜底纠偏：如果仍像 Markdown，则强制改写为 HTML
  if (!looksLikeMarkdown(firstTry)) return firstTry;

  const repairPrompt = `你刚才的输出含有 Markdown 痕迹（例如 **、#、-、\`\`\` 等）。
请你把“刚才的内容”改写为【纯 HTML 片段】：
- 必须以 <div 开头，以 </div> 结尾
- 严禁出现任何 Markdown 符号
- 语义保持一致
- 继续使用我要求的 class 结构（tags-container、highlight-legend、original-problem、reading-tips、grammar-analysis、final-answer 等）

【刚才的内容】：
${firstTry}`;

  return await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: repairPrompt }],
      temperature: 0.1,
    };
    const json = await callLLMChatCompletions(payload);
    return stripCodeFences(pickContent(json));
  });
};

// =============== 3）错题本诊断（HTML 片段） ===============

export const analyzeProblemHistory = async (problems: SavedProblem[]): Promise<string> => {
  const prompt = `你是教研员。基于“题库记录”输出一份【学习诊断报告】的纯 HTML 片段（严禁 Markdown）。
要求：适合家长阅读；包含：常错点、建议练法、下次复习重点。
只输出 HTML，不要输出解释，不要输出 Markdown。
题库JSON：\n${JSON.stringify(problems).slice(0, 120000)}`;

  return await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    };
    const json = await callLLMChatCompletions(payload);
    const html = stripCodeFences(pickContent(json));
    return looksLikeMarkdown(html) ? stripCodeFences(html) : html;
  });
};

// =============== 4）变式训练（HTML 片段：题目 + details 答案解析） ===============

export const generateDrills = async (
  originalProblem: string,
  solutionContextHtml: string
): Promise<string> => {
  const prompt = `你是一位小学英语语法老师。围绕“原题”生成【6道同型变式训练】并给出答案解析。
必须输出【纯 HTML 片段】，严禁 Markdown，严禁 \`\`\`、~~~。
结构要求：
- 外层不要写 <html><head>，只输出内容片段
- 用 <div class="drill-item"> 包每一题
- 题干放 <div class="drill-question">
- 答案解析放 <div class="drill-answer"><details>...</details></div>
- 每题给 4 个选项（A/B/C/D）或按原题题型组织
- 语言适合小学高年级，解析简洁但讲清规则
原题：\n${originalProblem}\n\n参考解答（HTML）：\n${solutionContextHtml}`;

  const first = await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
    };
    const json = await callLLMChatCompletions(payload);
    return stripCodeFences(pickContent(json));
  });

  if (!looksLikeMarkdown(first)) return first;

  const fixPrompt = `你的输出含 Markdown 痕迹。请将其改写成【纯 HTML 片段】并保持结构不变：
- 严禁出现 **、#、-、\`\`\`、~~~ 等 Markdown 符号
- 只输出 HTML
【待改写内容】：
${first}`;

  return await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: fixPrompt }],
      temperature: 0.1,
    };
    const json = await callLLMChatCompletions(payload);
    return stripCodeFences(pickContent(json));
  });
};

// =============== 5）语音（可选：如果你的中转支持 TTS） ===============

export const generateSpeech = async (solutionHtml: string): Promise<string> => {
  // 把 HTML 变成简短可读文本
  const text = (solutionHtml || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);

  return await withRetry(async () => {
    const res = await fetch("/.netlify/functions/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `我来讲解：${text}` }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `TTS HTTP ${res.status}`);
    }
    const json = await res.json();
    return json?.audio_base64 || "";
  });
};
// ================== 兼容 App.tsx 的补齐导出 ==================

// base64 解码（给 TTS / 音频用）
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// PCM → AudioBuffer（如果 UI 里用到了）
export function decodePcmAudio(
  pcmData: Uint8Array,
  sampleRate = 24000
): AudioBuffer {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = audioCtx.createBuffer(1, pcmData.length, sampleRate);
  const channelData = buffer.getChannelData(0);

  for (let i = 0; i < pcmData.length; i++) {
    channelData[i] = (pcmData[i] - 128) / 128;
  }
  return buffer;
}
