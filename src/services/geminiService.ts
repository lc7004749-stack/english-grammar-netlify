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
      // 对超时/网关类问题，稍等重试最有效
      await sleep(Math.min(4000, 600 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function env(name: string, fallback = ""): string {
  return ((import.meta as any).env?.[name] as string) || fallback;
}

function requiredEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing env: ${name}. 请在 Netlify 环境变量里配置它（VITE_ 前缀）。`);
  return v;
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

function normalizeBaseUrl(base: string) {
  return base.replace(/\/$/, "");
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => "");
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // data 维持 null
    }

    if (!res.ok) {
      // 把上游错误尽量说清楚
      const detail = data?.error || data || text || `HTTP ${res.status}`;
      throw new Error(`Upstream ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 1500)}`);
    }

    return data ?? text;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`请求超时（>${timeoutMs}ms）。建议：缩短输出/分批生成/检查中转响应速度。`);
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 直连你的 OpenAI 兼容中转：/chat/completions
 */
async function callChatCompletions(payload: any, timeoutMs = 30000): Promise<any> {
  const API_BASE = normalizeBaseUrl(requiredEnv("VITE_API_BASE"));
  const API_KEY = requiredEnv("VITE_API_KEY");

  const url = `${API_BASE}/chat/completions`;

  return await fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );
}

/** 题干核对/纠错（纯文本） */
export const verifyProblem = async (options: SolveOptions): Promise<string> => {
  const prompt = `你是“小学英语题干质检老师”。请核对/修复题干：
1) 若有乱码、缺字、重复、分页断句，请修复为一份“可做题的完整题目”。
2) 只输出【修复后的题目正文】，不要解释、不要标题、不要编号。
3) 尽量保留原题大小写、标点、换行。`;

  return await withRetry(async () => {
    const payload = {
      model: env("VITE_LLM_MODEL", "gpt-4o-mini"),
      messages: buildUserMessage(prompt, options),
      temperature: 0.2,
      max_tokens: 700,
    };
    const json = await callChatCompletions(payload, 25000);
    const out = (pickContent(json) || "").trim();
    if (!out) throw new Error("题干核对返回为空（content 为空）。");
    return out;
  });
};

/** 深度解析（HTML 片段，空位不高亮，口吻五六年级） */
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
- 题目中的空（如 ______ / ____ / ( ) ）必须保持为纯下划线/括号文本，不要用任何 <span class="..."> 包裹。
- 选项 A/B/C/D 的字母、以及空格占位不要高亮。
- 只高亮“题面里真实出现的词”（如 It / rains / often / in / summer / Does 等）。

【输出结构必须包含】
1) tags-container：考点标签（2-3个）
2) highlight-legend：图例
3) original-problem：原句+题目要求+填空（空不高亮）
4) reading-tips：2-3 条，表达更像五六年级（规则+依据+易错点）
5) grammar-analysis：语气不幼稚，讲“规则→例句→常见坑”
6) final-answer：简洁答案

【题目】（图片优先，其次文字）：`;

  const firstTry = await withRetry(async () => {
    const payload = {
      model: env("VITE_LLM_MODEL", "gpt-4o-mini"),
      messages: buildUserMessage(basePrompt, options),
      temperature: 0.25,
      max_tokens: 1700,
    };
    const json = await callChatCompletions(payload, 30000);
    const html = stripCodeFences(pickContent(json));
    if (!html || !html.trim()) throw new Error("深度解析返回为空（content 为空）。");
    return html;
  }, 2);

  if (!looksLikeMarkdown(firstTry)) return firstTry;

  const repairPrompt = `你的输出含 Markdown 痕迹（如 **、#、-、\`\`\` 等）。请改写成【纯 HTML 片段】：
- 必须 <div 开头 </div> 结尾
- 严禁任何 Markdown 符号
- 保持结构（tags-container、highlight-legend、original-problem、reading-tips、grammar-analysis、final-answer）
- “空位”不要高亮（下划线保持纯文本）
【待改写内容】：
${firstTry}`;

  return await withRetry(async () => {
    const payload = {
      model: env("VITE_LLM_MODEL", "gpt-4o-mini"),
      messages: [{ role: "user", content: repairPrompt }],
      temperature: 0.1,
      max_tokens: 1700,
    };
    const json = await callChatCompletions(payload, 25000);
    const html = stripCodeFences(pickContent(json));
    if (!html || !html.trim()) throw new Error("深度解析纠偏后仍为空（content 为空）。");
    return html;
  }, 1);
};

/** 错题本报告（HTML 片段） */
export const analyzeProblemHistory = async (problems: SavedProblem[]): Promise<string> => {
  const prompt = `你是教研员。输出一份【学习诊断报告】纯 HTML 片段（严禁 Markdown）。
包含：常错点、原因推断、建议练法、下次复习重点。适合家长阅读。只输出 HTML。
题库JSON：\n${JSON.stringify(problems).slice(0, 120000)}`;

  return await withRetry(async () => {
    const payload = {
      model: env("VITE_LLM_MODEL", "gpt-4o-mini"),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 1400,
    };
    const json = await callChatCompletions(payload, 30000);
    const html = stripCodeFences(pickContent(json));
    if (!html || !html.trim()) throw new Error("错题本报告返回为空（content 为空）。");
    return html;
  }, 2);
};

// —— 把 HTML 压缩成更短“要点”，避免变式训练慢 —— 
function summarizeContextForDrills(solutionHtml: string) {
  const txt = (solutionHtml || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return txt.slice(0, 900);
}

/** 变式训练：6题拆成两次各3题，显著降低超时概率 */
export const generateDrills = async (
  originalProblem: string,
  solutionContextHtml: string
): Promise<string> => {
  const shortCtx = summarizeContextForDrills(solutionContextHtml);

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
        model: env("VITE_LLM_MODEL", "gpt-4o-mini"),
        messages: [{ role: "user", content: prompt3(batch) }],
        temperature: 0.55,
        max_tokens: 1500,
      };
      const json = await callChatCompletions(payload, 35000);
      const html = stripCodeFences(pickContent(json));
      if (!html || !html.trim()) throw new Error(`变式训练第${batch}批返回为空（content 为空）。`);
      return html;
    }, 3);

    if (!looksLikeMarkdown(first)) return first;

    const fixPrompt = `你的输出含 Markdown 痕迹。请改写成【纯 HTML 片段】并保持结构：
- 严禁 **、#、-、\`\`\`、~~~ 等
- 只输出 HTML
【待改写内容】：
${first}`;

    return await withRetry(async () => {
      const payload = {
        model: env("VITE_LLM_MODEL", "gpt-4o-mini"),
        messages: [{ role: "user", content: fixPrompt }],
        temperature: 0.1,
        max_tokens: 1500,
      };
      const json = await callChatCompletions(payload, 25000);
      const html = stripCodeFences(pickContent(json));
      if (!html || !html.trim()) throw new Error(`变式训练第${batch}批纠偏后仍为空（content 为空）。`);
      return html;
    }, 2);
  };

  const part1 = await callBatch(1);
  const part2 = await callBatch(2);
  return `${part1}\n${part2}`;
};

/** TTS：浏览器直连中转 /audio/speech（你的中转若不支持会返回可读错误） */
export const generateSpeech = async (solutionHtml: string): Promise<string> => {
  const API_BASE = normalizeBaseUrl(requiredEnv("VITE_API_BASE"));
  const API_KEY = requiredEnv("VITE_API_KEY");

  const text = (solutionHtml || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);

  const url = `${API_BASE}/audio/speech`;

  const payload = {
    model: env("VITE_TTS_MODEL", "gpt-4o-mini-tts"),
    voice: env("VITE_TTS_VOICE", "alloy"),
    input: `我来讲解：${text}`,
    format: "mp3",
  };

  const res = await fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    },
    35000
  );

  // 有些中转返回 base64，有些返回二进制（此处按 JSON base64 处理）
  const b64 = (res as any)?.audio_base64;
  if (!b64) throw new Error("TTS 返回不包含 audio_base64（你的中转可能不支持 /audio/speech）。");
  return b64;
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

function normalizeBaseUrl(base: string) {
  return base.replace(/\/$/, "");
}
