/* ===================================================
   ai.js — AI 功能模块（通过后端代理调用 DeepSeek）
   API Key 仅存在于服务端，前端永远不接触 Key
=================================================== */

// ───────────────────────────────────────────
// 1. 后端地址
// ───────────────────────────────────────────
// 通过 Node 服务器访问时（port=3000）用相对路径
// 使用 Live Server 等工具时指向后端地址
// 前后端同域部署（Railway/生产）时用相对路径；本地直接打开 HTML 文件时指向本地服务
const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? `http://localhost:${window.location.port || 3000}`
  : '';

const SESSION_KEY = 'jy_session_token';
let sessionToken = localStorage.getItem(SESSION_KEY) || '';
let currentCredits = null;

// ───────────────────────────────────────────
// 2. 会话初始化（页面加载时调用）
// ───────────────────────────────────────────
async function initSession() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/session`, {
      headers: sessionToken ? { 'X-Session-Token': sessionToken } : {},
    });
    if (!res.ok) throw new Error('session_failed');
    const data = await res.json();
    sessionToken = data.token;
    currentCredits = data.credits;
    localStorage.setItem(SESSION_KEY, sessionToken);
    updateCreditDisplay(data.credits, data.isNew, false);
  } catch (_) {
    updateCreditDisplay(null, false, true);
  }
}

function updateCreditDisplay(credits, isNew = false, offline = false) {
  const numEl = document.getElementById('creditNum');
  const statusEl = document.getElementById('creditStatus');
  const freeTipEl = document.getElementById('freeTierNote');
  if (!numEl) return;

  if (offline) {
    numEl.textContent = '离线';
    numEl.style.fontSize = '1.1rem';
    numEl.style.color = '#64748b';
    if (statusEl) statusEl.textContent = '⚠️ 请先运行 node server.js 启动后端';
    return;
  }

  currentCredits = credits;
  numEl.textContent = credits;
  numEl.style.fontSize = '';

  if (credits === 0) {
    numEl.style.color = '#ef4444';
    if (statusEl) statusEl.textContent = '积分已用完，请购买后继续使用';
  } else if (credits <= 2) {
    numEl.style.color = '#f59e0b';
    if (statusEl) statusEl.textContent = `仅剩 ${credits} 次，建议及时充值`;
  } else {
    numEl.style.color = '#a855f7';
    if (statusEl) statusEl.textContent = '全文优化 3 积分 · 其余 1 积分/次';
  }

  if (freeTipEl) freeTipEl.hidden = !isNew;
}

// ───────────────────────────────────────────
// 3. 调用后端 AI 接口（支持流式输出）
// ───────────────────────────────────────────
async function callBackendAI(messages, onChunk) {
  if (!sessionToken) throw new Error('会话未初始化，请刷新页面');
  if (currentCredits !== null && currentCredits <= 0) {
    showPricingModal();
    throw new Error('CREDITS_EXHAUSTED');
  }

  const resp = await fetch(`${BACKEND_URL}/api/ai/optimize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': sessionToken,
    },
    body: JSON.stringify({ messages, stream: !!onChunk }),
  });

  const remaining = resp.headers.get('X-Credits-Remaining');
  if (remaining !== null) updateCreditDisplay(parseInt(remaining, 10));

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    if (resp.status === 402 || err.error === 'CREDITS_EXHAUSTED') {
      showPricingModal();
      throw new Error('积分不足，请购买积分');
    }
    throw new Error(err.message || err.error || `请求失败 (${resp.status})`);
  }

  if (onChunk) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n').filter((l) => l.startsWith('data: '));
      for (const line of lines) {
        const raw = line.slice(6);
        if (raw === '[DONE]') break;
        try {
          const chunk = JSON.parse(raw);
          const text = chunk.choices?.[0]?.delta?.content || '';
          if (text) { full += text; onChunk(text); }
        } catch (_) {}
      }
    }
    return full;
  } else {
    const json = await resp.json();
    return json.choices?.[0]?.message?.content || '';
  }
}

// ───────────────────────────────────────────
// 4. 初始化所有 UI 事件
// ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSession();
  initAIActionButtons();
  initPromptTemplates();
  initPricingModal();
  document.getElementById('btnBuyCredits')?.addEventListener('click', showPricingModal);
});

// ───────────────────────────────────────────
// 5. AI 操作按钮
// ───────────────────────────────────────────
function initAIActionButtons() {
  document.querySelectorAll('.ai-action-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleAIOptimize(btn.dataset.action));
  });
}

async function handleAIOptimize(action, idx) {
  const data = window.resumeData;
  if (!data) return;

  const outputArea = document.getElementById('aiOutputArea');
  const loadingEl = document.getElementById('aiLoading');
  outputArea.innerHTML = '';
  loadingEl.hidden = false;

  const systemPrompt =
    '你是一位专业的简历优化专家，擅长帮助求职者用精炼、有力的语言表达自己的经历和成就。请用中文回复，输出时使用清晰的格式，避免空泛的表述，多用动词开头描述成就，善用量化数据。';

  let prompt = '';
  switch (action) {
    case 'optimize-summary': prompt = buildSummaryPrompt(data); break;
    case 'optimize-exp':     prompt = buildExpPrompt(data, idx); break;
    case 'optimize-proj':    prompt = buildProjPrompt(data, idx); break;
    default:                 prompt = buildFullOptimizePrompt(data); break;
  }

  try {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'ai-output-content';
    outputArea.appendChild(msgDiv);

    let fullText = '';
    await callBackendAI(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      (chunk) => {
        fullText += chunk;
        msgDiv.textContent = fullText;
        outputArea.scrollTop = outputArea.scrollHeight;
      }
    );

    if (action === 'optimize-summary' && fullText) {
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-primary w100 mt-12 modal-apply-btn';
      applyBtn.textContent = '✅ 应用到个人简介';
      applyBtn.addEventListener('click', () => {
        const clean = fullText.replace(/^(优化后的简介[:：]\s*|个人简介[:：]\s*)/i, '').trim();
        data.personal.summary = clean;
        const el = document.getElementById('f-summary');
        if (el) el.value = clean;
        window.renderPreview();
        window.saveData();
        window.showToast('✅ 已应用到个人简介', 'success');
      });
      outputArea.appendChild(applyBtn);
    }

    window.showToast('✅ AI 优化完成', 'success');
  } catch (err) {
    if (err.message === 'CREDITS_EXHAUSTED') {
      outputArea.innerHTML = `
        <div style="text-align:center;padding:24px 12px;color:#94a3b8">
          <div style="font-size:2.5rem;margin-bottom:10px">💳</div>
          <p style="margin-bottom:16px">积分已用完</p>
          <button class="btn btn-primary w100" onclick="showPricingModal()">购买积分继续使用</button>
        </div>`;
    } else {
      outputArea.innerHTML = `<div style="color:#f87171;font-size:0.82rem;padding:8px">❌ ${err.message}</div>`;
      window.showToast(`❌ ${err.message}`, 'error');
    }
  } finally {
    loadingEl.hidden = true;
  }
}

window.handleAIOptimize = handleAIOptimize;

// ───────────────────────────────────────────
// 6. Prompt 构建函数
// ───────────────────────────────────────────
function buildSummaryPrompt(data) {
  const p = data.personal;
  const expStr = data.experience.filter((e) => e.company).map((e) => `${e.company} · ${e.position}`).join('；');
  return `请为以下求职者撰写一段精炼有力的个人简介（3-4句话，不超过120字），突出核心竞争力和求职意向：

姓名：${p.name || '未填'}
求职意向：${p.title || '未填'}
工作经历：${expStr || '暂无'}
当前简介：${p.summary || '（未填写，请根据上述信息生成）'}

要求：
1. 以主动语气开头，突出核心技能和经验年限
2. 结合具体的求职意向
3. 语言简洁专业，避免空泛词汇
4. 直接输出简介内容，不需要任何前缀说明`;
}

function buildExpPrompt(data, idx) {
  const exps = data.experience.filter((e) => e.company);
  const expStr = exps.map((e, i) => {
    const mark = idx !== undefined && i === idx ? '【重点优化这条】' : '';
    return `${mark}${e.company} · ${e.position}\n${e.description || '（暂无描述）'}`;
  }).join('\n\n---\n');
  return `请为以下工作经历提供优化建议和改写版本：

${expStr}

优化要求：
1. 每条描述用动词开头（如：主导、优化、构建、设计等）
2. 添加量化数据（如：提升X%、缩短Y天、减少Z个bug）
3. 使用 STAR 法则（情境-任务-行动-结果）
4. 突出技术难点和个人贡献，不仅仅是「负责了什么」

请直接输出优化后的描述内容（用 - 开头的列表格式）。`;
}

function buildProjPrompt(data, idx) {
  const projs = data.projects.filter((p) => p.name);
  const projStr = projs.map((p, i) => {
    const mark = idx !== undefined && i === idx ? '【重点优化这条】' : '';
    return `${mark}项目：${p.name}（${p.role || '开发者'}） ${p.duration || ''}\n${p.description || '（暂无描述）'}`;
  }).join('\n\n---\n');
  return `请为以下项目经历提供优化建议和改写：

${projStr}

优化要求：
1. 突出技术选型和解决的核心问题
2. 量化关键成果（性能提升、用户增长、效率改善等）
3. 体现个人在团队中的具体贡献和技术深度
4. 用动词开头，语言简洁有力

请直接输出优化后的项目描述（用 - 开头的列表格式）。`;
}

function buildFullOptimizePrompt(data) {
  const p = data.personal;
  const expStr = data.experience.filter((e) => e.company)
    .map((e) => `【${e.position} @ ${e.company}】\n${e.description || '无描述'}`).join('\n\n');
  const projStr = data.projects.filter((pr) => pr.name)
    .map((pr) => `【${pr.name}】${pr.role}\n${pr.description || '无描述'}`).join('\n\n');
  return `请对以下简历进行全面分析和优化建议：

== 基本信息 ==
姓名：${p.name}，求职意向：${p.title}
技能：${data.skills.tech}

== 工作经历 ==
${expStr || '暂无'}

== 项目经历 ==
${projStr || '暂无'}

== 个人简介 ==
${p.summary || '暂无'}

请按以下结构输出：
1. **整体评估**（2-3句简评）
2. **工作经历优化**（针对每段经历给出改进建议）
3. **项目描述改进**（给出1-2条关键改进点）
4. **个人简介修改建议**（提供改写版本）
5. **其他建议**（如技能展示、关键词补充等）`;
}

// ───────────────────────────────────────────
// 7. 收费/定价弹窗
// ───────────────────────────────────────────
let pricingCache = null;

async function loadPricing() {
  if (pricingCache) return pricingCache;
  try {
    const res = await fetch(`${BACKEND_URL}/api/pricing`);
    pricingCache = await res.json();
  } catch (_) {
    pricingCache = {
      freeCredits: 5,
      plans: [
        { id: 'starter',   name: '体验版', price: 9.9,  credits: 20,  tag: '' },
        { id: 'pro',       name: '专业版', price: 29.9, credits: 100, tag: '热门' },
        { id: 'unlimited', name: '无限版', price: 99,   credits: 999, tag: '超值' },
      ],
    };
  }
  return pricingCache;
}

async function showPricingModal() {
  const modal = document.getElementById('pricingModal');
  if (!modal) return;

  const pricing = await loadPricing();
  const gridEl = document.getElementById('pricingGrid');
  if (gridEl) {
    gridEl.innerHTML = pricing.plans.map((plan) => `
      <div class="price-card ${plan.tag === '热门' ? 'price-card-featured' : ''}">
        ${plan.tag ? `<div class="price-tag">${plan.tag}</div>` : ''}
        <div class="price-name">${plan.name}</div>
        <div class="price-amount">¥${plan.price}</div>
        <div class="price-credits">${plan.credits === 999 ? '无限' : plan.credits} 积分</div>
        <div class="price-per">≈ ¥${(plan.price / plan.credits).toFixed(2)} / 次</div>
        <button class="btn btn-primary w100 price-buy-btn"
          data-plan="${plan.id}" data-price="${plan.price}"
          data-credits="${plan.credits}" data-name="${plan.name}">
          立即购买
        </button>
      </div>`).join('');

    gridEl.querySelectorAll('.price-buy-btn').forEach((btn) => {
      btn.addEventListener('click', () => handlePurchase(btn.dataset));
    });
  }

  const contactEl = document.getElementById('paymentContact');
  if (contactEl) contactEl.hidden = true;
  modal.hidden = false;
}

function handlePurchase(plan) {
  const contactEl = document.getElementById('paymentContact');
  if (!contactEl) return;
  // ── 后续可接入 Stripe / 微信支付 / 支付宝 ──
  // 目前采用"人工确认"流程：用户出示 sessionToken，管理员调用 /api/admin/add-credits
  contactEl.hidden = false;
  contactEl.innerHTML = `
    <div class="payment-contact-card">
      <p style="font-weight:700;margin-bottom:8px">🛒 订单：${plan.name} — ¥${plan.price}</p>
      <p style="margin-bottom:6px">付款后将以下 <strong>用户 Token</strong> 发给客服完成充值：</p>
      <div class="token-box">${sessionToken}</div>
      <button class="btn btn-ghost btn-sm copy-token-btn" style="margin-top:8px;width:100%">📋 复制 Token</button>
      <p class="payment-tip">支持微信支付 · 支付宝 · 银行卡转账</p>
      <p class="payment-tip">客服联系方式：请在此处填写你的联系方式</p>
    </div>`;

  contactEl.querySelector('.copy-token-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(sessionToken)
      .then(() => window.showToast('✅ Token 已复制', 'success'));
  });
}

function initPricingModal() {
  const modal = document.getElementById('pricingModal');
  if (!modal) return;
  document.getElementById('pricingModalClose')?.addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
}

window.handleAIOptimize = handleAIOptimize;
window.showPricingModal = showPricingModal;
window.updateCreditDisplay = updateCreditDisplay;

// ───────────────────────────────────────────
// 8. 提示词模板弹窗
// ───────────────────────────────────────────
const PROMPT_TEMPLATES = {
  'work-exp': {
    title: '💼 工作经历描述生成',
    fields: [
      { key: 'company',          label: '公司名称',              placeholder: '字节跳动' },
      { key: 'position',         label: '职位名称',              placeholder: '高级前端工程师' },
      { key: 'duration',         label: '在职时间',              placeholder: '2022.06 - 2024.03（约2年）' },
      { key: 'responsibilities', label: '主要职责（简要列举）',   type: 'textarea', placeholder: '负责PC端和移动端业务开发\n参与架构设计和性能优化' },
      { key: 'achievements',     label: '核心成就/亮点（可选）',  type: 'textarea', placeholder: '将首屏加载时间从4s降至1.5s\n独立完成XXX功能模块开发' },
      { key: 'tech',             label: '主要使用技术栈',        placeholder: 'React, TypeScript, GraphQL, Node.js' },
    ],
    buildPrompt: (v) => `请为以下工作经历生成专业的简历描述（3-5条要点，每条用 - 开头）：
公司：${v.company}；职位：${v.position}；时间：${v.duration}
主要职责：${v.responsibilities}
核心成就：${v.achievements || '无'}；技术栈：${v.tech}
要求：动词开头、至少2条含量化数据、体现技术深度。直接输出，无需前缀。`,
  },
  'self-intro': {
    title: '👤 个人简介撰写',
    fields: [
      { key: 'title',       label: '求职意向',              placeholder: '全栈工程师 / 产品经理' },
      { key: 'years',       label: '工作年限',              placeholder: '5年' },
      { key: 'core_skills', label: '核心技能（3-5个）',     placeholder: 'React, Node.js, 系统架构设计' },
      { key: 'highlights',  label: '最大亮点/成就',         placeholder: '带领10人团队完成百万级流量系统重构' },
      { key: 'target',      label: '目标公司/行业（可选）', placeholder: '互联网大厂 / AI产品公司' },
    ],
    buildPrompt: (v) => `生成简历个人简介（3-4句，≤120字）：
求职：${v.title}；年限：${v.years}；技能：${v.core_skills}；亮点：${v.highlights}；目标：${v.target || '互联网行业'}
要求：以经验/技能开头，突出竞争力，避免空话。直接输出内容，无需前缀。`,
  },
  'project-desc': {
    title: '🚀 项目经历描述生成',
    fields: [
      { key: 'name',    label: '项目名称',           placeholder: '电商平台前端重构' },
      { key: 'role',    label: '你在项目中的角色',   placeholder: '前端技术负责人' },
      { key: 'tech',    label: '技术栈',             placeholder: 'Vue 3 + TypeScript + Pinia + Vite' },
      { key: 'problem', label: '项目解决的核心问题', placeholder: '原有代码性能差、可维护性低' },
      { key: 'result',  label: '项目成果/收益',      placeholder: '页面加载速度提升60%，代码量减少40%' },
      { key: 'team',    label: '团队规模（可选）',   placeholder: '5人前端团队' },
    ],
    buildPrompt: (v) => `为以下项目生成简历描述（3-4条，- 开头）：
项目：${v.name}；角色：${v.role}；技术：${v.tech}
解决的问题：${v.problem}；成果：${v.result}；团队：${v.team || '未知'}
要求：第1条背景+技术，第2-3条核心挑战，最后1条量化成果。直接输出，无需前缀。`,
  },
  'skill-summary': {
    title: '⚡ 技能亮点提炼',
    fields: [
      { key: 'title',  label: '求职职位',                 placeholder: '后端开发工程师' },
      { key: 'skills', label: '你的技能清单（尽量详细）', type: 'textarea', placeholder: 'Java, Spring Boot, MySQL, Redis, Kafka, Docker, K8s...' },
      { key: 'years',  label: '主要技能使用年限',         placeholder: 'Java 5年，Spring Boot 4年' },
    ],
    buildPrompt: (v) => `将以下技能整理成简历技能展示：
职位：${v.title}；技能：${v.skills}；年限：${v.years}
请：1)按模块分类整理；2)给出30字技能概述；3)指出哪些关键词在JD中频率高，建议重点展示。`,
  },
};

function initPromptTemplates() {
  document.querySelectorAll('.prompt-use-btn').forEach((btn) => {
    btn.addEventListener('click', () => openPromptModal(btn.closest('.prompt-card').dataset.prompt));
  });
  document.getElementById('modalClose')?.addEventListener('click', closeModal);
  document.getElementById('modalCancel')?.addEventListener('click', closeModal);
  document.getElementById('modalGenerate')?.addEventListener('click', runPromptTemplate);
  document.getElementById('promptModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('promptModal')) closeModal();
  });
}

function openPromptModal(key) {
  const tpl = PROMPT_TEMPLATES[key];
  if (!tpl) return;
  document.getElementById('modalTitle').textContent = tpl.title;
  document.getElementById('modalBody').innerHTML = tpl.fields.map((f) => `
    <div class="form-group">
      <label>${f.label}</label>
      ${f.type === 'textarea'
        ? `<textarea id="pm-${f.key}" placeholder="${f.placeholder}" rows="3"></textarea>`
        : `<input type="text" id="pm-${f.key}" placeholder="${f.placeholder}" />`}
    </div>`).join('');
  document.getElementById('promptModal').dataset.currentKey = key;
  document.getElementById('promptModal').hidden = false;
}

function closeModal() { document.getElementById('promptModal').hidden = true; }

async function runPromptTemplate() {
  const key = document.getElementById('promptModal').dataset.currentKey;
  const tpl = PROMPT_TEMPLATES[key];
  if (!tpl) return;

  const vals = {};
  tpl.fields.forEach((f) => {
    const el = document.getElementById(`pm-${f.key}`);
    vals[f.key] = el ? el.value.trim() : '';
  });

  const genBtn = document.getElementById('modalGenerate');
  genBtn.disabled = true;
  genBtn.textContent = '⏳ AI 生成中...';

  const body = document.getElementById('modalBody');
  let resultDiv = body.querySelector('.modal-result');
  if (!resultDiv) {
    resultDiv = document.createElement('div');
    resultDiv.className = 'modal-result';
    body.appendChild(resultDiv);
  }
  resultDiv.textContent = '';

  try {
    let full = '';
    await callBackendAI(
      [
        { role: 'system', content: '你是专业的中文简历写作专家，善于用精炼有力的语言帮助求职者展示自身价值。' },
        { role: 'user', content: tpl.buildPrompt(vals) },
      ],
      (chunk) => {
        full += chunk;
        resultDiv.textContent = full;
        body.scrollTop = body.scrollHeight;
      }
    );

    let applyBtn = body.querySelector('.modal-apply-btn');
    if (!applyBtn) {
      applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-primary modal-apply-btn w100';
      applyBtn.textContent = '✅ 复制到剪贴板（手动粘贴到对应字段）';
      applyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(full)
          .then(() => { window.showToast('✅ 已复制，请粘贴到对应字段', 'success'); closeModal(); })
          .catch(() => window.showToast('请手动复制上方内容', 'info'));
      });
      body.appendChild(applyBtn);
    }
    genBtn.textContent = '✨ 重新生成';
    genBtn.disabled = false;
  } catch (err) {
    resultDiv.textContent = `❌ ${err.message}`;
    genBtn.textContent = '✨ AI 生成内容';
    genBtn.disabled = false;
  }
}
