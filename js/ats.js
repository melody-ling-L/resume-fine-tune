/* ===================================================
   ats.js — ATS 关键词匹配分析
   功能：提取 JD 关键词、与简历内容匹配、
         计算匹配度、AI 补充建议
=================================================== */

// ───────────────────────────────────────────
// 1. 技术关键词词库（常见互联网岗位）
// ───────────────────────────────────────────
const TECH_KEYWORDS = new Set([
  // 前端
  'javascript','typescript','react','vue','angular','next.js','nuxt','svelte',
  'webpack','vite','rollup','babel','eslint','tailwindcss','sass','less',
  'html','css','dom','spa','pwa','ssr','seo','responsive','mobile-first',
  'jest','cypress','vitest','storybook','graphql','restful','axios',
  // 后端
  'node.js','python','java','go','rust','php','ruby','scala',
  'spring','spring boot','django','flask','fastapi','express','koa','nest.js',
  'mysql','postgresql','mongodb','redis','elasticsearch','kafka','rabbitmq',
  'docker','kubernetes','k8s','ci/cd','jenkins','github actions','nginx',
  'microservices','微服务','serverless','grpc','websocket',
  // 通用
  'git','agile','scrum','敏捷','tdd','设计模式','系统设计','高并发','分布式',
  'linux','shell','sql','nosql','cache','缓存','性能优化','代码重构',
  // 软技能（中文）
  '团队协作','沟通能力','项目管理','快速学习','责任心','主动性',
  '领导力','创造力','解决问题','独立思考','跨团队','多任务',
  // 业务
  'b端','c端','toB','toC','电商','金融','教育','医疗','游戏',
  '产品思维','用户体验','数据分析','ab测试','灰度发布',
]);

// ───────────────────────────────────────────
// 2. 从 JD 文本中提取关键词
// ───────────────────────────────────────────
function extractKeywordsFromJD(jdText) {
  const text = jdText.toLowerCase();
  const found = new Set();

  // 词库匹配
  TECH_KEYWORDS.forEach(kw => {
    if (text.includes(kw.toLowerCase())) found.add(kw);
  });

  // 提取中文技术词汇（2-10个字的技术名词）
  const cnRegex = /[\u4e00-\u9fa5]{2,10}/g;
  const cnWords = text.match(cnRegex) || [];
  cnWords.forEach(w => {
    if (w.length >= 2 && w.length <= 8) {
      // 过滤常见助词、停用词
      if (!/^(具有|拥有|负责|参与|熟悉|了解|能够|可以|以及|包括|同时|并且|需要|要求|工作|经验|年以上|年以下|优先|加分)/.test(w)) {
        found.add(w);
      }
    }
  });

  // 提取英文技术词（过滤常用英文单词）
  const enRegex = /\b[a-z][a-z0-9.+#\-]{1,20}\b/g;
  const STOP_WORDS = new Set(['the','and','or','for','with','our','you','have','will','can','are','all','any','not','that','this','from','your','has','its','been','were','into','than','which','about']);
  const enWords = text.match(enRegex) || [];
  enWords.forEach(w => {
    if (!STOP_WORDS.has(w) && w.length >= 2 && TECH_KEYWORDS.has(w)) {
      found.add(w);
    }
  });

  return [...found];
}

// ───────────────────────────────────────────
// 3. 从简历数据中提取所有文本
// ───────────────────────────────────────────
function getResumeText() {
  const data = window.resumeData;
  if (!data) return '';
  const parts = [
    data.personal.summary || '',
    data.skills.tech || '',
    data.skills.soft || '',
    data.skills.lang || '',
    ...data.experience.map(e => `${e.position} ${e.description || ''}`),
    ...data.projects.map(p => `${p.name} ${p.role} ${p.description || ''}`),
    ...data.education.map(e => `${e.major} ${e.courses || ''}`),
  ];
  return parts.join(' ').toLowerCase();
}

// ───────────────────────────────────────────
// 4. 计算匹配度
// ───────────────────────────────────────────
function analyzeATSMatch(jdText) {
  const jdKeywords = extractKeywordsFromJD(jdText);
  const resumeText = getResumeText();

  const matched = [];
  const missing = [];

  jdKeywords.forEach(kw => {
    if (resumeText.includes(kw.toLowerCase())) {
      matched.push(kw);
    } else {
      missing.push(kw);
    }
  });

  const total = jdKeywords.length || 1;
  const score = Math.round((matched.length / total) * 100);

  return { matched, missing, score, total };
}

// ───────────────────────────────────────────
// 5. 初始化 ATS UI 事件
// ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const analyzeBtn = document.getElementById('btnAnalyzeATS');
  if (!analyzeBtn) return;

  analyzeBtn.addEventListener('click', () => {
    const jdText = document.getElementById('jdInput').value.trim();
    if (!jdText || jdText.length < 20) {
      window.showToast('⚠️ 请粘贴目标岗位的职位描述（JD）', 'error');
      return;
    }

    const result = analyzeATSMatch(jdText);
    renderATSResult(result);
    window.showToast(`分析完成：匹配度 ${result.score}%`, result.score >= 70 ? 'success' : 'info');
  });

  // AI 补充缺失关键词
  const atsOptBtn = document.getElementById('btnAtsOptimize');
  if (atsOptBtn) {
    atsOptBtn.addEventListener('click', () => {
      const jdText = document.getElementById('jdInput').value.trim();
      const result = analyzeATSMatch(jdText);
      if (result.missing.length === 0) {
        window.showToast('✅ 所有关键词均已覆盖！', 'success');
        return;
      }
      window.switchAITab('ai');
      // 调用 AI 优化，告知缺失关键词
      buildATSOptimizeRequest(result.missing);
    });
  }
});

function renderATSResult(result) {
  const resultEl = document.getElementById('atsResult');
  const scoreNumEl = document.getElementById('atsScoreNum');
  const barFillEl = document.getElementById('atsBarFill');
  const matchedEl = document.getElementById('kwMatched');
  const missingEl = document.getElementById('kwMissing');

  scoreNumEl.textContent = `${result.score}%`;
  barFillEl.style.width = '0%';
  setTimeout(() => { barFillEl.style.width = `${result.score}%`; }, 50);

  // 颜色反馈
  const color = result.score >= 70 ? '#4ade80' : result.score >= 40 ? '#fbbf24' : '#f87171';
  scoreNumEl.style.color = color;

  matchedEl.innerHTML = result.matched.map(kw =>
    `<span class="kw-tag matched">${kw}</span>`
  ).join('') || '<span style="font-size:0.75rem;color:#475569">暂无匹配</span>';

  missingEl.innerHTML = result.missing.slice(0, 20).map(kw =>
    `<span class="kw-tag missing">${kw}</span>`
  ).join('') || '<span style="font-size:0.75rem;color:#475569">全部覆盖 ✅</span>';

  resultEl.hidden = false;
}

async function buildATSOptimizeRequest(missingKeywords) {
  const outputArea = document.getElementById('aiOutputArea');
  const loadingEl = document.getElementById('aiLoading');
  outputArea.innerHTML = '';
  loadingEl.hidden = false;

  const data = window.resumeData;
  const apiKey = localStorage.getItem('deepseek_api_key');

  if (!apiKey) {
    window.showToast('⚠️ 请先配置 API Key', 'error');
    loadingEl.hidden = true;
    return;
  }

  const prompt = `我的简历中缺少以下关键词，这些关键词出现在目标岗位的 JD 中：
${missingKeywords.join('、')}

求职者背景：
- 求职意向：${data.personal.title || '未填'}
- 技能：${data.skills.tech || '未填'}
- 工作经历：${data.experience.filter(e => e.company).map(e => `${e.company} - ${e.position}`).join('；') || '未填'}

请根据求职者的实际背景，建议如何自然地将上述缺失关键词融入简历（技能区/工作描述/项目描述），
要求真实合理，不要虚构不具备的技能，优先建议在现有描述中添加相关关键词的上下文。`;

  try {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'ai-output-content';
    outputArea.appendChild(msgDiv);
    let full = '';

    await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是专业的简历优化专家。' },
          { role: 'user', content: prompt },
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    }).then(async resp => {
      if (!resp.ok) throw new Error(`API 错误 ${resp.status}`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const chunk = JSON.parse(data);
            const text = chunk.choices?.[0]?.delta?.content || '';
            full += text;
            msgDiv.textContent = full;
            outputArea.scrollTop = outputArea.scrollHeight;
          } catch (_) { /* 忽略 */ }
        }
      }
    });

    window.showToast('✅ ATS 优化建议已生成', 'success');
  } catch (err) {
    outputArea.innerHTML = `<div style="color:#f87171;font-size:0.82rem">❌ ${err.message}</div>`;
    window.showToast(`❌ ${err.message}`, 'error');
  } finally {
    loadingEl.hidden = true;
  }
}
