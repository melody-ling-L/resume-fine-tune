/**
 * server.js — 简历优化后端服务
 *
 * 功能：
 *   - DeepSeek API 代理（Key 只在服务端，永不暴露给前端）
 *   - 积分系统（新用户免费 5 次，用完后需购买）
 *   - 流式响应转发 (SSE)
 *   - 管理员接口（手动增加积分，后续可接支付回调）
 *
 * 快速启动：
 *   1. npm install
 *   2. cp .env.example .env  （填写你的 DeepSeek API Key 和 ADMIN_KEY）
 *   3. node server.js
 *   4. 浏览器打开 http://localhost:3000
 *
 * Node.js 版本要求：>= 18（使用内置 fetch + crypto.randomUUID）
 */

'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_DEV = process.env.NODE_ENV !== 'production';
const FREE_CREDITS = 5;
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s && s !== 'https://yourdomain.com'); // 过滤掉占位符

app.use(
  cors({
    origin: (origin, cb) => {
      // 无 Origin 头：直接导航、curl 等，放行
      if (!origin) return cb(null, true);
      // 允许所有 localhost（开发环境）
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      // 白名单命中
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // 未配置白名单时放行所有（Railway 同域部署场景，前后端同一个域名）
      if (allowedOrigins.length === 0) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    exposedHeaders: ['X-Credits-Remaining'],
  })
);

app.use(express.json({ limit: '32kb' }));

// 静态文件服务：通过 http://localhost:3000 访问前端页面
app.use(express.static(__dirname));

// ─── 频率限制 ─────────────────────────────────────────────────────────────────
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: IS_DEV ? 30 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请1分钟后再试' },
});

// ─── 会话存储（内存版，生产环境请换成 Redis + 数据库）────────────────────────
/** @type {Map<string, {token:string, credits:number, totalUsed:number, createdAt:number, lastUsedAt:number|null}>} */
const sessions = new Map();

function createSession() {
  const token = randomUUID();
  const session = {
    token,
    credits: FREE_CREDITS,
    totalUsed: 0,
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  sessions.set(token, session);

  // 定期清理超过 7 天且从未使用的空闲会话，防止内存无限增长
  if (sessions.size > 10000) {
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [key, s] of sessions.entries()) {
      if (now - s.createdAt > WEEK && s.totalUsed === 0) {
        sessions.delete(key);
      }
    }
  }
  return session;
}

function requireSession(req, res) {
  const token = req.headers['x-session-token'];
  const session = token ? sessions.get(token) : null;
  if (!session) {
    res.status(401).json({ error: '会话无效，请刷新页面重试' });
    return null;
  }
  return session;
}

// ─── 路由 ─────────────────────────────────────────────────────────────────────

// 获取 / 创建会话（页面加载时调用）
app.get('/api/session', (req, res) => {
  const token = req.headers['x-session-token'];
  let session = token ? sessions.get(token) : null;
  if (!session) session = createSession();

  res.json({
    token: session.token,
    credits: session.credits,
    totalUsed: session.totalUsed,
    isNew: session.totalUsed === 0 && session.credits === FREE_CREDITS,
  });
});

// ─── AI 代理（核心接口）─────────────────────────────────────────────────────
app.post('/api/ai/optimize', aiLimiter, async (req, res) => {
  // 1. 验证会话
  const session = requireSession(req, res);
  if (!session) return;

  // 2. 检查积分
  if (session.credits <= 0) {
    return res.status(402).json({
      error: 'CREDITS_EXHAUSTED',
      message: '积分不足，请购买积分继续使用 AI 功能',
    });
  }

  // 3. 校验请求体
  const { messages, stream = false } = req.body;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 10) {
    return res.status(400).json({ error: '请求参数无效' });
  }
  for (const msg of messages) {
    if (
      !msg.role ||
      typeof msg.content !== 'string' ||
      msg.content.length === 0 ||
      msg.content.length > 8000
    ) {
      return res.status(400).json({ error: '消息格式无效' });
    }
  }

  // 4. 检查 API Key 是否已配置
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI 服务暂时维护中，请稍后再试' });
  }

  // 5. 先扣积分（若失败则退还）
  session.credits -= 1;
  session.totalUsed += 1;
  session.lastUsedAt = Date.now();

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 1500,
        stream: Boolean(stream),
      }),
    });

    if (!upstream.ok) {
      // 上游报错 → 退还积分
      session.credits += 1;
      session.totalUsed -= 1;
      let errMsg = `AI 服务响应异常 (${upstream.status})，积分已退还`;
      try {
        const errJson = await upstream.json();
        errMsg = errJson.error?.message || errMsg;
      } catch (_) {}
      return res.status(upstream.status).json({ error: errMsg });
    }

    // 告知前端最新积分余额
    res.setHeader('X-Credits-Remaining', String(session.credits));

    if (stream) {
      // 流式转发 SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no'); // 防止 Nginx 缓冲
      // 将 Web ReadableStream 转为 Node.js Readable 后 pipe 给 Express
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.pipe(res);
      // 客户端断连时清理
      req.on('close', () => nodeStream.destroy());
    } else {
      const data = await upstream.json();
      res.json(data);
    }
  } catch (err) {
    // 网络错误 → 退还积分
    session.credits += 1;
    session.totalUsed -= 1;
    console.error('[AI Proxy]', err.message);
    res.status(503).json({ error: '网络错误，积分已退还，请重试' });
  }
});

// ─── AI 简历解析（PDF/Word 上传后调用）──────────────────────────────────────
const PARSE_CREDIT_COST = 2;
app.post('/api/ai/parse-resume', aiLimiter, async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  if (session.credits < PARSE_CREDIT_COST) {
    return res.status(402).json({
      error: 'CREDITS_EXHAUSTED',
      message: `积分不足（解析需要 ${PARSE_CREDIT_COST} 积分），请购买积分后重试`,
    });
  }

  const { resumeText } = req.body;
  if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length < 20) {
    return res.status(400).json({ error: '简历文本内容过短，无法解析' });
  }
  if (resumeText.length > 20000) {
    return res.status(400).json({ error: '文件内容过长，请上传内容在10页以内的简历' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI 服务暂时维护中，请稍后再试' });
  }

  session.credits -= PARSE_CREDIT_COST;
  session.totalUsed += 1;
  session.lastUsedAt = Date.now();

  const systemPrompt = `你是专业的简历解析专家。将用户提供的简历文本精确解析为结构化 JSON 数据。严格按照以下 JSON Schema 输出，只输出纯 JSON，不要有任何说明文字：
{
  "personal": { "name":"", "title":"", "phone":"", "email":"", "location":"", "github":"", "summary":"" },
  "experience": [{ "id":1, "company":"", "position":"", "startDate":"YYYY-MM", "endDate":"YYYY-MM或空字符串", "current":false, "description":"每条职责以-开头用换行分隔" }],
  "education": [{ "id":1, "school":"", "degree":"本科", "major":"", "startDate":"YYYY-MM", "endDate":"YYYY-MM", "gpa":"", "courses":"" }],
  "skills": { "tech":"技术技能逗号分隔", "soft":"软技能逗号分隔", "lang":"语言能力" },
  "projects": [{ "id":1, "name":"", "role":"", "duration":"", "description":"每条以-开头用换行分隔", "link":"" }],
  "awards": [{ "id":1, "year":"", "award":"" }]
}
注意：字段无内容留空字符串；数组无内容留 []；id从1递增；startDate/endDate格式YYYY-MM；只输出JSON。`;

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请解析以下简历文本：\n\n${resumeText}` },
        ],
        temperature: 0.1,
        max_tokens: 4000,
        stream: false,
      }),
    });

    if (!upstream.ok) {
      session.credits += PARSE_CREDIT_COST;
      session.totalUsed -= 1;
      return res.status(upstream.status).json({ error: `AI 服务异常 (${upstream.status})，积分已退还` });
    }

    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      const match = content.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/) || content.match(/(\{[\s\S]+\})/);
      const jsonStr = match ? match[1] : content;
      parsed = JSON.parse(jsonStr.trim());
    } catch (_) {
      session.credits += PARSE_CREDIT_COST;
      session.totalUsed -= 1;
      return res.status(500).json({ error: 'AI 解析结果格式异常，积分已退还，请重试' });
    }

    res.setHeader('X-Credits-Remaining', String(session.credits));
    res.json({ success: true, data: parsed, creditsRemaining: session.credits });
  } catch (err) {
    session.credits += PARSE_CREDIT_COST;
    session.totalUsed -= 1;
    console.error('[Parse Resume]', err.message);
    res.status(503).json({ error: '网络错误，积分已退还，请重试' });
  }
});

// ─── 价格方案 ─────────────────────────────────────────────────────────────────
app.get('/api/pricing', (req, res) => {
  res.json({
    freeCredits: FREE_CREDITS,
    plans: [
      { id: 'starter',   name: '体验版', price: 9.9,  credits: 20,  tag: '' },
      { id: 'pro',       name: '专业版', price: 29.9, credits: 100, tag: '热门' },
      { id: 'unlimited', name: '无限版', price: 99,   credits: 999, tag: '超值' },
    ],
    creditUsage: {
      optimize_summary: 1,
      optimize_exp: 1,
      optimize_proj: 1,
      optimize_all: 3,
      ats_ai: 1,
      prompt_template: 1,
    },
  });
});

// ─── 管理员：手动增加积分（付款确认后调用，后续可改为支付回调自动触发）──────
app.post('/api/admin/add-credits', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { token, credits, note } = req.body;
  if (!token || typeof credits !== 'number' || credits <= 0 || credits > 99999) {
    return res.status(400).json({ error: 'Invalid params' });
  }
  const session = sessions.get(token);
  if (!session) {
    return res.status(404).json({ error: 'Session not found; ask user to reopen site' });
  }
  session.credits += credits;
  console.log(`[Admin] +${credits} credits → ${token.slice(0, 8)}... (note: ${note || '-'}). Balance: ${session.credits}`);
  res.json({ token, credits: session.credits, added: credits });
});

// 管理员：查看所有会话统计
app.get('/api/admin/sessions', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const list = [...sessions.values()].map((s) => ({
    token: s.token.slice(0, 8) + '...',
    credits: s.credits,
    totalUsed: s.totalUsed,
    createdAt: new Date(s.createdAt).toISOString(),
    lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt).toISOString() : null,
  }));
  res.json({ count: list.length, totalUsed: list.reduce((a, s) => a + s.totalUsed, 0), sessions: list });
});

// ─── 全局错误处理 ─────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

// ─── 启动 ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  服务启动成功`);
  console.log(`   前端访问：http://localhost:${PORT}`);
  console.log(`   编辑器：  http://localhost:${PORT}/editor.html`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('\n⚠️  警告：DEEPSEEK_API_KEY 未配置，AI 功能将返回 503\n');
  } else {
    console.log(`   AI 服务：已配置 ✓\n`);
  }
});
