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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetry = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= maxRetry; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      // 对 502/504 这种网关/超时，等一等再试最有效
      await sleep(Math.min(4000, 600 * Math.pow(2, i)));
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

function stripCodeFences(s: string): string {
  return (s || "")
    .replace(/```html\s*/gi, "")
    .replace(/```/g, "")
    .replace(/~~~html\s*/gi, "")
    .replace(/~~~/g, "")
    .trim();
}

function looksLikeMarkdown(s: string): boolean {
  const t = s || "";
  if (t.includes("```") || t.includes("~~~")) return true;
  if (/\*\*.+\*\*/.test(t)) return true;
  if (/^#{1,6}\s/m.test(t)) return true;
  if (/^\s*[-*+]\s+/m.test(t)) return true;
  return false;
}

// —— 这里是和 Netlify Function 的对接：直接把 OpenAI payload 发过去 ——
// 你的 llm function 只要能转发到 API_BASE/chat/completions 即可。
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

/** 题干核对/纠错（纯文本） */
export const verifyProblem = async (options: SolveOptions): Promise<string> => {
  const prompt = `你是“小学英语题干质检老师”。请核对/修复题干：
1) 若有乱码、缺字、重复、分页断句，请修复为一份“可做题的完整题目”。
2) 只输出【修复后的题目正文】，不要解释、不要标题、不要编号。
3) 尽量保留原题大小写、标点、换行。`;

  return await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: buildUserMessage(prompt, options),
      temperature: 0.2,
      max_tokens: 600,
    };
    const json = await callLLMChatCompletions(payload);
    return pickContent(json).trim();
  });
};

/** 深度解析（输出 HTML 片段，且不要高亮空） */
export const solveProblem = async (options: SolveOptions): Promise<string> => {
  const basePrompt = `你是“资深英语私教”，面向五六年级学生讲解。

【最重要硬规则】
- 只输出“可直接渲染的 HTML 片段”，必须以 <div 开头，以 </div> 结尾。
- 严禁输出 Markdown：不允许出现 **、#、-、>、\`\`\`、~~~ 等符号。
- 需要强调用 <strong>；标题用 <h3>；列表用 <ul><li>。
- 不要输出解释性前缀（如“下面是…”），不要输出代码块围栏。

【样式 class 必须使用】
tags-container / level-tag grammar
highlight-legend / legend-item / legend-dot subject|verb|tense|object|keyword
original-problem / reading-tips / grammar-analysis / final-answer
subject-highlight / verb-highlight / tense-highlight / object-highlight / keyword-highlight

【关键修正：填空/选择的“空位”不要高亮】
- 题目中的空（如 ______ 或 ____ 或 ( )）必须保持为纯下划线/括号，不要用任何 <span class="..."> 包裹。
- 选项 A/B/C/D 的字母、以及空格占位不要高亮。
- 只高亮“题面里真实出现的词”（如 It / rains / often / in / summer / Does 等）。

【输出结构必须包含】
1) 右上角考点标签
2) 图例（legend）
3) original-problem：原句+题目要求+填空处（空不高亮）
4) reading-tips：2-3 条，表达更像五六年级（少幼稚比喻，多规则+例子）
5) grammar-analysis：语气不幼稚，讲“规则→例句→常见坑”
6) final-answer：简洁答案

【五六年级口吻要求】
- 避免“举个栗子/小怪兽/糖果”这类过幼稚比喻
- 用“规则/信号词/动词原形/三单/助动词”这类更自然的讲法
- 例句保留，但更像课堂讲解

【题目】（图片优先，其次文字）：`;

  const firstTry = await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: buildUserMessage(basePrompt, options),
      temperature: 0.25,
      max_tokens: 1600,
    };
    const json = await callLLMChatCompletions(payload);
    return stripCodeFences(pickContent(json));
  });

  if (!looksLikeMarkdown(firstTry)) return firstTry;

  // 兜底纠偏：如果仍像 Markdown，则强制改写为 HTML
  const repairPrompt = `你的输出含 Markdown 痕迹（如 **、#、-、\`\`\` 等）。请改写成【纯 HTML 片段】：
- 必须 <div 开头 </div> 结尾
- 严禁任何 Markdown 符号
- 保持原结构（tags-container、highlight-legend、original-problem、reading-tips、grammar-analysis、final-answer）
- “空位”不要高亮（下划线保持纯文本）
【待改写内容】：
${firstTry}`;

  return await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: repairPrompt }],
      temperature: 0.1,
      max_tokens: 1600,
    };
    const json = await callLLMChatCompletions(payload);
    return stripCodeFences(pickContent(json));
  });
};

/** 错题本报告（HTML 片段） */
export const analyzeProblemHistory = async (problems: SavedProblem[]): Promise<string> => {
  const prompt = `你是教研员。输出一份【学习诊断报告】纯 HTML 片段（严禁 Markdown）。
包含：常错点、原因推断、建议练法、下次复习重点。适合家长阅读。
只输出 HTML。
题库JSON：\n${JSON.stringify(problems).slice(0, 120000)}`;

  return await withRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 1400,
    };
    const json = await callLLMChatCompletions(payload);
    return stripCodeFences(pickContent(json));
  });
};

// —— 把 HTML 压缩成更短的“语义上下文”，避免变式训练超时 ——
// 只提取核心信息，避免把整页 HTML 扔给模型
function summarizeContextForDrills(solutionHtml: string) {
  const txt = (solutionHtml || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return txt.slice(0, 900); // 关键：缩短上下文，减少超时概率
}

/** 变式训练（更稳：6题拆成两次各3题） */
export const generateDrills = async (
  originalProblem: string,
  solutionContextHtml: string
): Promise<string> => {
  const shortCtx = summarizeContextForDrills(solutionContextHtml);

  // 生成 3 题的 prompt（减少一次请求耗时）
  const prompt3 = (batchIndex: 1 | 2) => `你是一位小学英语语法老师，面向五六年级。
围绕“原题”生成【3道同型变式训练】并给出答案解析（本批次：第${batchIndex}批，共2批）。
必须输出【纯 HTML 片段】，严禁 Markdown（**、#、-、\`\`\`、~~~ 都不许出现）。
结构要求：
- 每题用 <div class="drill-item"> 包裹
- 题干放 <div class="drill-question">
- 答案解析放 <div class="drill-answer"><details>...</details></div>
- 每题给 4 个选项（A/B/C/D），题型尽量贴近原题
- 解析语气不要幼稚，用“规则→依据→易错点”表达
原题：\n${originalProblem}\n\n参考要点（已压缩）：\n${shortCtx}`;

  const callBatch = async (batch: 1 | 2) => {
    const first = await withRetry(async () => {
      const payload = {
        model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt3(batch) }],
        temperature: 0.55,
        max_tokens: 1500,
      };
      const json = await callLLMChatCompletions(payload);
      return stripCodeFences(pickContent(json));
    }, 3);

    if (!looksLikeMarkdown(first)) return first;

    const fixPrompt = `你的输出含 Markdown 痕迹。请改写成【纯 HTML 片段】并保持结构：
- 严禁 **、#、-、\`\`\`、~~~ 等
- 只输出 HTML
【待改写内容】：
${first}`;

    return await withRetry(async () => {
      const payload = {
        model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: fixPrompt }],
        temperature: 0.1,
        max_tokens: 1500,
      };
      const json = await callLLMChatCompletions(payload);
      return stripCodeFences(pickContent(json));
    }, 2);
  };

  // 两批拼接（这样即使第二批偶尔超时，第一批也更容易成功）
  const part1 = await callBatch(1);
  const part2 = await callBatch(2);
  return `${part1}\n${part2}`;
};

/** TTS（可选） */
export const generateSpeech = async (solutionHtml: string): Promise<string> => {
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
  }, 2);
};

// ===== App.tsx 兼容导出：避免 build missing export =====
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function decodePcmAudio(pcmData: Uint8Array, sampleRate = 24000): AudioBuffer {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = audioCtx.createBuffer(1, pcmData.length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcmData.length; i++) {
    channel[i] = (pcmData[i] - 128) / 128;
  }
  return buffer;
}
