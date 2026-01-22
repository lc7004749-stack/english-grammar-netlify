<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1BzfPyWiPjWxdneCzrkEtIYUcN0d2nqdx

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## 部署到 Netlify（带中转 LLM / 不暴露 Key）

### 1) 在 Netlify 新建站点（Import from Git 或手动上传仓库）
- Build command: `npm run build`
- Publish directory: `dist`

### 2) 在 Netlify 设置环境变量
Site settings → Environment variables：
- `API_BASE`：你的 OpenAI 兼容中转地址（示例：`https://api.videocaptioner.cn/v1`）
- `API_KEY`：你的 Key（不会暴露给前端）
- （可选）`TTS_MODEL`、`TTS_VOICE`
- （可选）`VITE_LLM_MODEL`（前端选择模型，默认 gpt-4o-mini）

### 3) 功能说明
- 前端通过 `/.netlify/functions/llm` 同源调用 LLM，避免 CORS、避免 Key 泄露
- 语音讲解通过 `/.netlify/functions/tts` 生成 base64 音频（需要中转支持 `/audio/speech`）
