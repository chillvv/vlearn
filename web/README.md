
  # Vlearn - AI 智能错题复习 Web App

This is a code bundle for Vlearn (AI 智能错题复习 Web App). The original project is available at https://www.figma.com/design/lWKY8g3a3rRdcC0nFP5dVc/AI-%E9%94%99%E9%A2%98%E5%AD%A6%E4%B9%A0-Web-App.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.
  
## Vercel 自动部署与 Supabase 连接

1. 在 Vercel 导入此仓库，并将 `Production Branch` 设置为 `main`。
2. 在 Vercel 项目 `Settings -> Environment Variables` 配置：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_AI_PROXY_URL`
   - `VITE_QWEN_MODEL`
3. 保存后执行一次 `Redeploy`。
4. 之后每次向 GitHub `main` push，Vercel 会自动部署最新代码。

本地开发可复制 `.env.example` 为 `.env` 后填写真实值。
  
