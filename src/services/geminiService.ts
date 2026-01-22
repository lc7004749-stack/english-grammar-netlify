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
    parts.push({ type: "text", text: `\n\n【额外文本输入】\n${options.text}` });
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

export const verifyProblem = async (options: SolveOptions): Promise<string> => {
  const prompt = `你是一个小学英语语法题的质检老师。请做“题目核对/纠错”：
1) 如果图片/文字里有乱码、缺字、重复、分页断句，请你自动修复为一份“可做题的完整题目”。
2) 只输出【修复后的题目正文】（不要加解释、不要加多余标题）。
3) 如果题目本身就完整清晰，原样输出即可。`;

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

export const solveProblem = async (options: SolveOptions): Promise<string> => {
  const prompt = `你是一位面向小学高年级的英语老师。请根据题目输出【答案版】：
- 要求：答案清晰、步骤简短、语气适合学生理解。
- 如果有选择题/填空/改错/翻译等，请按题号逐条作答。
- 只输出答案与必要的简要解析（不要输出你看到的提示）。`;

  return await callWithRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: buildMessages(prompt, options),
      temperature: 0.3,
    };
    const json = await callChatCompletions(payload);
    return pickText(json).trim();
  });
};

export const analyzeProblemHistory = async (problems: SavedProblem[]): Promise<string> => {
  const prompt = `你是教研员。请基于“题库记录”输出一份【学习诊断报告 HTML】：
- 发现常见题型/错误点
- 给出下一步练习建议
- 风格：小标题清晰、要点列表、适合家长阅读
题库JSON：\n${JSON.stringify(problems).slice(0, 120000)}`;

  return await callWithRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    };
    const json = await callChatCompletions(payload);
    return pickText(json).trim();
  });
};

export const generateDrills = async (originalProblem: string, solutionContext: string): Promise<string> => {
  const prompt = `你是一位小学英语语法老师。请围绕“原题”生成【6道同型变式训练】并给出答案。
要求：
- 题型保持一致，难度略有梯度
- 每题包含题目+答案
- 输出为可直接放进网页的HTML片段（用 <h3>、<ol>、<li>、<details> 等）
原题：\n${originalProblem}\n\n参考解答：\n${solutionContext}`;

  return await callWithRetry(async () => {
    const payload = {
      model: (import.meta as any).env.VITE_LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
    };
    const json = await callChatCompletions(payload);
    return pickText(json).trim();
  });
};

export const generateSpeech = async (solutionHtml: string): Promise<string> => {
  // 将HTML转成短文本，交给 TTS 接口生成音频 base64
  const text = solutionHtml.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim().slice(0, 1200);

  return await callWithRetry(async () => {
    const res = await fetch("/.netlify/functions/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `我来为你讲解：${text}`,
        // 可在 Netlify 环境变量里配置 TTS_MODEL / TTS_VOICE
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json?.audio_base64 || "";
  });
};

export function decodeBase64(base64: string): Uint8Array {
  const binString = atob(base64);
  const len = binString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binString.charCodeAt(i);
  return bytes;
}

export async function decodePcmAudio(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  // If TTS returns mp3, this won't be used; App.tsx already handles decoded audio buffer for PCM.
  // Keep compatibility: try decodeAudioData for common formats.
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return await ctx.decodeAudioData(buf);
}
