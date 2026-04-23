/* ===================================================
   editor.js — 简历编辑器核心逻辑
   功能：数据模型、表单绑定、实时预览渲染、
         模板切换、PDF 导出、localStorage 存储
=================================================== */

// ───────────────────────────────────────────
// 1. 数据模型（以 reactive 方式维护）
// ───────────────────────────────────────────
let resumeData = {
  personal: {
    name: '',
    title: '',
    phone: '',
    email: '',
    location: '',
    github: '',
    summary: '',
  },
  experience: [],
  education: [],
  skills: { tech: '', soft: '', lang: '' },
  projects: [],
  awards: [],
};

let currentTemplate = localStorage.getItem('selectedTemplate') || '经典商务';
let zoomLevel = 85;

// ───────────────────────────────────────────
// 2. 初始化：从 localStorage 还原数据
// ───────────────────────────────────────────
function init() {
  const saved = localStorage.getItem('resumeData');
  if (saved) {
    try { resumeData = JSON.parse(saved); } catch (e) { /* 忽略损坏数据 */ }
  }

  // 确保动态数组有至少 1 项（初次使用体验）
  if (!resumeData.experience.length) addItem('experience');
  if (!resumeData.education.length) addItem('education');
  if (!resumeData.projects.length) addItem('projects');
  if (!resumeData.awards.length) addItem('awards');

  // 同步模板选择
  const tplMap = { '经典商务': 'classic', '现代分栏': 'modern', '简约清晰': 'minimal' };
  const tplKey = tplMap[currentTemplate] || 'classic';
  document.querySelectorAll('.tpl-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tpl === tplKey);
  });

  bindFormEvents();
  renderDynamicLists();
  syncFormValues();
  renderPreview();
  setupAITabs();
  setupZoom();
  setupSectionToggles();
  initTemplatePicker();
  initUpload();
}

// ───────────────────────────────────────────
// 3. 表单事件绑定（input 双向绑定）
// ───────────────────────────────────────────
function bindFormEvents() {
  // 静态字段：个人信息 & 技能
  document.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      const path = el.dataset.field.split('.');
      if (path.length === 2) resumeData[path[0]][path[1]] = el.value;
      debouncedSave();
      debouncedRender();
    });
  });

  // 模板切换
  document.querySelectorAll('.tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tplNameMap = { classic: '经典商务', modern: '现代分栏', minimal: '简约清晰' };
      currentTemplate = tplNameMap[btn.dataset.tpl] || '经典商务';
      localStorage.setItem('selectedTemplate', currentTemplate);
      renderPreview();
    });
  });

  // 保存按钮
  document.getElementById('btnSave').addEventListener('click', () => {
    saveData();
    showToast('✅ 已保存到本地', 'success');
  });

  // 清空按钮
  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (!confirm('确定要清空所有内容吗？此操作不可撤销。')) return;
    localStorage.removeItem('resumeData');
    location.reload();
  });

  // PDF 导出
  document.getElementById('btnExportPDF').addEventListener('click', exportPDF);

  // 动态列表 "添加" 按钮
  document.querySelectorAll('.add-item-btn').forEach(btn => {
    btn.addEventListener('click', () => addItem(btn.dataset.target));
  });

  // 评分按钮
  document.getElementById('btnCalcScore').addEventListener('click', calcScore);

  // AI 字段优化按钮
  document.querySelectorAll('.ai-field-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchAITab('ai');
      if (typeof window.handleAIOptimize === 'function') {
        window.handleAIOptimize('optimize-summary');
      }
    });
  });
}

// ───────────────────────────────────────────
// 4. 动态列表管理（工作经历、项目等）
// ───────────────────────────────────────────
function addItem(type) {
  const defaults = {
    experience: { id: Date.now(), company: '', position: '', startDate: '', endDate: '', current: false, description: '' },
    education: { id: Date.now(), school: '', degree: '本科', major: '', startDate: '', endDate: '', gpa: '', courses: '' },
    projects: { id: Date.now(), name: '', role: '', duration: '', description: '', link: '' },
    awards: { id: Date.now(), year: '', award: '' },
  };
  resumeData[type].push({ ...defaults[type] });
  renderDynamicLists();
  debouncedRender();
}

function removeItem(type, id) {
  resumeData[type] = resumeData[type].filter(item => item.id !== id);
  renderDynamicLists();
  debouncedRender();
}

function renderDynamicLists() {
  renderExpList();
  renderEduList();
  renderProjList();
  renderAwardList();
}

function renderExpList() {
  const container = document.getElementById('exp-list');
  container.innerHTML = '';
  resumeData.experience.forEach((exp, idx) => {
    const div = document.createElement('div');
    div.className = 'dynamic-item';
    div.innerHTML = `
      <div class="dynamic-item-header">
        <span class="dynamic-item-title">经历 ${idx + 1}</span>
        <div class="item-actions">
          <button class="ai-field-btn" data-action="optimize-exp-single" data-idx="${idx}" style="font-size:0.72rem;padding:2px 8px">✨ AI</button>
          <button class="item-del-btn" title="删除">🗑</button>
        </div>
      </div>
      <div class="form-row two-col">
        <div class="form-group">
          <label>公司名称</label>
          <input type="text" value="${esc(exp.company)}" placeholder="字节跳动" data-key="company" />
        </div>
        <div class="form-group">
          <label>职位名称</label>
          <input type="text" value="${esc(exp.position)}" placeholder="前端开发工程师" data-key="position" />
        </div>
      </div>
      <div class="form-row two-col">
        <div class="form-group">
          <label>开始时间</label>
          <input type="month" value="${esc(exp.startDate)}" data-key="startDate" />
        </div>
        <div class="form-group">
          <label>结束时间</label>
          <input type="month" value="${esc(exp.endDate)}" data-key="endDate" placeholder="至今填空" />
        </div>
      </div>
      <div class="form-group">
        <label>工作内容 <span style="color:#475569;font-weight:400">（每行一条，以 - 开头）</span></label>
        <textarea rows="4" placeholder="- 负责公司核心业务前端开发，使用 React 技术栈&#10;- 将页面加载性能提升 40%，LCP 从 3.5s 降至 2.1s" data-key="description">${esc(exp.description)}</textarea>
      </div>
    `;

    // 绑定输入事件
    div.querySelectorAll('input, textarea').forEach(el => {
      el.addEventListener('input', () => {
        exp[el.dataset.key] = el.value;
        debouncedSave();
        debouncedRender();
      });
    });

    // AI 优化按钮
    div.querySelector('[data-action="optimize-exp-single"]').addEventListener('click', () => {
      switchAITab('ai');
      if (typeof window.handleAIOptimize === 'function') {
        window.handleAIOptimize('optimize-exp', idx);
      }
    });

    // 删除按钮
    div.querySelector('.item-del-btn').addEventListener('click', () => removeItem('experience', exp.id));

    container.appendChild(div);
  });
}

function renderEduList() {
  const container = document.getElementById('edu-list');
  container.innerHTML = '';
  resumeData.education.forEach((edu, idx) => {
    const div = document.createElement('div');
    div.className = 'dynamic-item';
    div.innerHTML = `
      <div class="dynamic-item-header">
        <span class="dynamic-item-title">学历 ${idx + 1}</span>
        <button class="item-del-btn" title="删除">🗑</button>
      </div>
      <div class="form-row two-col">
        <div class="form-group">
          <label>学校名称</label>
          <input type="text" value="${esc(edu.school)}" placeholder="北京大学" data-key="school" />
        </div>
        <div class="form-group">
          <label>学历</label>
          <select data-key="degree">
            ${['专科','本科','硕士','博士','其他'].map(d =>
              `<option value="${d}" ${edu.degree === d ? 'selected' : ''}>${d}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>专业</label>
        <input type="text" value="${esc(edu.major)}" placeholder="计算机科学与技术" data-key="major" />
      </div>
      <div class="form-row two-col">
        <div class="form-group">
          <label>入学时间</label>
          <input type="month" value="${esc(edu.startDate)}" data-key="startDate" />
        </div>
        <div class="form-group">
          <label>毕业时间</label>
          <input type="month" value="${esc(edu.endDate)}" data-key="endDate" />
        </div>
      </div>
      <div class="form-group">
        <label>GPA / 主修课程（选填）</label>
        <input type="text" value="${esc(edu.courses)}" placeholder="GPA 3.8/4.0 · 数据结构、算法设计、操作系统" data-key="courses" />
      </div>
    `;
    div.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', () => { edu[el.dataset.key] = el.value; debouncedSave(); debouncedRender(); });
      el.addEventListener('change', () => { edu[el.dataset.key] = el.value; debouncedSave(); debouncedRender(); });
    });
    div.querySelector('textarea') && div.querySelector('textarea').addEventListener('input', (e) => {
      edu[e.target.dataset.key] = e.target.value; debouncedSave(); debouncedRender();
    });
    div.querySelector('.item-del-btn').addEventListener('click', () => removeItem('education', edu.id));
    container.appendChild(div);
  });
}

function renderProjList() {
  const container = document.getElementById('proj-list');
  container.innerHTML = '';
  resumeData.projects.forEach((proj, idx) => {
    const div = document.createElement('div');
    div.className = 'dynamic-item';
    div.innerHTML = `
      <div class="dynamic-item-header">
        <span class="dynamic-item-title">项目 ${idx + 1}</span>
        <div class="item-actions">
          <button class="ai-field-btn" data-action="optimize-proj-single" data-idx="${idx}" style="font-size:0.72rem;padding:2px 8px">✨ AI</button>
          <button class="item-del-btn" title="删除">🗑</button>
        </div>
      </div>
      <div class="form-row two-col">
        <div class="form-group">
          <label>项目名称</label>
          <input type="text" value="${esc(proj.name)}" placeholder="企业官网重构" data-key="name" />
        </div>
        <div class="form-group">
          <label>担任角色</label>
          <input type="text" value="${esc(proj.role)}" placeholder="前端负责人" data-key="role" />
        </div>
      </div>
      <div class="form-row two-col">
        <div class="form-group">
          <label>时间段</label>
          <input type="text" value="${esc(proj.duration)}" placeholder="2024.03 - 2024.09" data-key="duration" />
        </div>
        <div class="form-group">
          <label>项目链接（选填）</label>
          <input type="text" value="${esc(proj.link)}" placeholder="github.com/xxx" data-key="link" />
        </div>
      </div>
      <div class="form-group">
        <label>项目描述 / 核心贡献</label>
        <textarea rows="4" placeholder="- 使用 Vue 3 + TypeScript 从零搭建项目&#10;- 实现接口缓存策略，API 调用减少 50%" data-key="description">${esc(proj.description)}</textarea>
      </div>
    `;
    div.querySelectorAll('input, textarea').forEach(el => {
      el.addEventListener('input', () => { proj[el.dataset.key] = el.value; debouncedSave(); debouncedRender(); });
    });
    div.querySelector('[data-action="optimize-proj-single"]').addEventListener('click', () => {
      switchAITab('ai');
      if (typeof window.handleAIOptimize === 'function') window.handleAIOptimize('optimize-proj', idx);
    });
    div.querySelector('.item-del-btn').addEventListener('click', () => removeItem('projects', proj.id));
    container.appendChild(div);
  });
}

function renderAwardList() {
  const container = document.getElementById('award-list');
  container.innerHTML = '';
  resumeData.awards.forEach((award, idx) => {
    const div = document.createElement('div');
    div.className = 'dynamic-item';
    div.innerHTML = `
      <div class="dynamic-item-header">
        <span class="dynamic-item-title">奖项 ${idx + 1}</span>
        <button class="item-del-btn" title="删除">🗑</button>
      </div>
      <div class="form-row two-col">
        <div class="form-group">
          <label>年份</label>
          <input type="text" value="${esc(award.year)}" placeholder="2023" data-key="year" style="width:80px" />
        </div>
        <div class="form-group" style="flex:2">
          <label>奖项名称</label>
          <input type="text" value="${esc(award.award)}" placeholder="ACM大学生程序设计竞赛 金奖" data-key="award" />
        </div>
      </div>
    `;
    div.querySelectorAll('input').forEach(el => {
      el.addEventListener('input', () => { award[el.dataset.key] = el.value; debouncedSave(); debouncedRender(); });
    });
    div.querySelector('.item-del-btn').addEventListener('click', () => removeItem('awards', award.id));
    container.appendChild(div);
  });
}

// 将已保存数据同步回静态字段（初始化时用）
function syncFormValues() {
  const p = resumeData.personal;
  const s = resumeData.skills;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('f-name', p.name); setVal('f-title', p.title);
  setVal('f-phone', p.phone); setVal('f-email', p.email);
  setVal('f-location', p.location); setVal('f-github', p.github);
  setVal('f-summary', p.summary);
  setVal('f-skills-tech', s.tech); setVal('f-skills-soft', s.soft); setVal('f-skills-lang', s.lang);
}

// ───────────────────────────────────────────
// 5. 实时预览渲染
// ───────────────────────────────────────────
function renderPreview() {
  const el = document.getElementById('resumePreview');
  const tplMap = { '经典商务': 'classic', '现代分栏': 'modern', '简约清晰': 'minimal' };
  const tpl = tplMap[currentTemplate] || 'classic';
  el.className = `resume-tpl tpl-${tpl}-view`;

  const { personal: p, experience, education, skills, projects, awards } = resumeData;
  const isEmpty = !p.name && !p.title;

  if (isEmpty) {
    el.innerHTML = `<div class="resume-empty"><span>📄</span><p>在左侧填写简历信息<br/>预览将实时更新</p></div>`;
    return;
  }

  if (tpl === 'classic') el.innerHTML = renderClassic();
  else if (tpl === 'modern') el.innerHTML = renderModern();
  else el.innerHTML = renderMinimal();
}

// 将描述文本（每行 - 开头）转为 <ul>
function descToList(text) {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const hasPrefix = lines.some(l => l.startsWith('-') || l.startsWith('·') || l.startsWith('•'));
  if (hasPrefix) {
    return `<ul class="exp-desc-list">${lines.map(l => `<li>${esc(l.replace(/^[-·•]\s*/, ''))}</li>`).join('')}</ul>`;
  }
  return `<p class="exp-desc">${esc(text)}</p>`;
}

function skillTags(str) {
  if (!str) return '';
  return str.split(/[,，/\n]+/).map(s => s.trim()).filter(Boolean)
    .map(s => `<span class="skill-tag">${esc(s)}</span>`).join('');
}

function formatDate(d) {
  if (!d) return '至今';
  const [y, m] = d.split('-');
  return m ? `${y}.${m}` : y;
}

// ── 模板 1：经典商务
function renderClassic() {
  const { personal: p, experience, education, skills, projects, awards } = resumeData;
  return `
    <div class="classic-header">
      <div>
        <div class="ch-name">${esc(p.name) || '姓名'}</div>
        <div class="ch-title">${esc(p.title) || '求职意向'}</div>
        <div class="ch-contacts">
          ${p.phone ? `<span>📱 ${esc(p.phone)}</span>` : ''}
          ${p.email ? `<span>✉️ ${esc(p.email)}</span>` : ''}
          ${p.location ? `<span>📍 ${esc(p.location)}</span>` : ''}
          ${p.github ? `<span>🔗 ${esc(p.github)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="classic-body">
      ${p.summary ? `<div class="resume-section">
        <div class="section-heading">个人简介</div>
        <p style="font-size:12.5px;color:#374151;line-height:1.7">${esc(p.summary)}</p>
      </div>` : ''}

      ${experience.some(e => e.company) ? `<div class="resume-section">
        <div class="section-heading">工作经历</div>
        ${experience.filter(e => e.company).map(exp => `
          <div class="exp-item">
            <div class="exp-header">
              <span class="exp-company">${esc(exp.company)}</span>
              <span class="exp-date">${formatDate(exp.startDate)} — ${formatDate(exp.endDate)}</span>
            </div>
            <div class="exp-position">${esc(exp.position)}</div>
            ${descToList(exp.description)}
          </div>
        `).join('')}
      </div>` : ''}

      ${projects.some(p => p.name) ? `<div class="resume-section">
        <div class="section-heading">项目经历</div>
        ${projects.filter(p => p.name).map(proj => `
          <div class="proj-item">
            <div class="exp-header">
              <span class="exp-company">${esc(proj.name)}</span>
              <span class="exp-date">${esc(proj.duration || '')}</span>
            </div>
            ${proj.role ? `<div class="exp-position">${esc(proj.role)}</div>` : ''}
            ${descToList(proj.description)}
          </div>
        `).join('')}
      </div>` : ''}

      ${education.some(e => e.school) ? `<div class="resume-section">
        <div class="section-heading">教育背景</div>
        ${education.filter(e => e.school).map(edu => `
          <div class="edu-item">
            <div class="exp-header">
              <span class="exp-company">${esc(edu.school)}</span>
              <span class="exp-date">${formatDate(edu.startDate)} — ${formatDate(edu.endDate)}</span>
            </div>
            <div class="exp-position">${esc(edu.degree)} · ${esc(edu.major)}</div>
            ${edu.courses ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${esc(edu.courses)}</div>` : ''}
          </div>
        `).join('')}
      </div>` : ''}

      ${skills.tech || skills.soft ? `<div class="resume-section">
        <div class="section-heading">技能特长</div>
        ${skills.tech ? `<div style="margin-bottom:8px"><div class="skills-wrap">${skillTags(skills.tech)}</div></div>` : ''}
        ${skills.soft ? `<div><div class="skills-wrap">${skillTags(skills.soft)}</div></div>` : ''}
        ${skills.lang ? `<div style="font-size:12px;color:#64748b;margin-top:6px">🌐 ${esc(skills.lang)}</div>` : ''}
      </div>` : ''}

      ${awards.some(a => a.award) ? `<div class="resume-section">
        <div class="section-heading">荣誉奖项</div>
        <ul class="exp-desc-list">
          ${awards.filter(a => a.award).map(a =>
            `<li>${a.year ? `<strong>${esc(a.year)}</strong> ` : ''}${esc(a.award)}</li>`
          ).join('')}
        </ul>
      </div>` : ''}
    </div>
  `;
}

// ── 模板 2：现代分栏
function renderModern() {
  const { personal: p, experience, education, skills, projects, awards } = resumeData;
  return `
    <div class="modern-sidebar">
      <div class="ms-avatar">👤</div>
      <div class="ms-name">${esc(p.name) || '姓名'}</div>
      <div class="ms-title">${esc(p.title) || '求职意向'}</div>

      <div>
        <div class="ms-section-title">联系方式</div>
        ${p.phone ? `<div class="ms-contact-item">📱 ${esc(p.phone)}</div>` : ''}
        ${p.email ? `<div class="ms-contact-item">✉️ ${esc(p.email)}</div>` : ''}
        ${p.location ? `<div class="ms-contact-item">📍 ${esc(p.location)}</div>` : ''}
        ${p.github ? `<div class="ms-contact-item">🔗 ${esc(p.github)}</div>` : ''}
      </div>

      ${skills.tech ? `<div>
        <div class="ms-section-title">专业技能</div>
        <div>${skills.tech.split(/[,，/\n]+/).map(s => s.trim()).filter(Boolean)
          .map(s => `<span class="ms-skill-tag">${esc(s)}</span>`).join('')}</div>
      </div>` : ''}
      ${skills.soft ? `<div>
        <div class="ms-section-title">软技能</div>
        <div>${skills.soft.split(/[,，/\n]+/).map(s => s.trim()).filter(Boolean)
          .map(s => `<span class="ms-skill-tag">${esc(s)}</span>`).join('')}</div>
      </div>` : ''}
      ${skills.lang ? `<div>
        <div class="ms-section-title">语言能力</div>
        <div style="font-size:11.5px;opacity:0.85">${esc(skills.lang)}</div>
      </div>` : ''}
      ${education.some(e => e.school) ? `<div>
        <div class="ms-section-title">教育背景</div>
        ${education.filter(e => e.school).map(edu => `
          <div style="margin-bottom:8px">
            <div style="font-size:12px;font-weight:700">${esc(edu.school)}</div>
            <div style="font-size:11px;opacity:0.8">${esc(edu.degree)} · ${esc(edu.major)}</div>
            <div style="font-size:11px;opacity:0.65">${formatDate(edu.startDate)} — ${formatDate(edu.endDate)}</div>
          </div>
        `).join('')}
      </div>` : ''}
    </div>
    <div class="modern-main">
      ${p.summary ? `<div class="resume-section">
        <div class="section-heading">个人简介</div>
        <p style="font-size:12.5px;color:#374151;line-height:1.7">${esc(p.summary)}</p>
      </div>` : ''}
      ${experience.some(e => e.company) ? `<div class="resume-section">
        <div class="section-heading">工作经历</div>
        ${experience.filter(e => e.company).map(exp => `
          <div class="exp-item">
            <div class="exp-header">
              <span class="exp-company">${esc(exp.company)}</span>
              <span class="exp-date">${formatDate(exp.startDate)} — ${formatDate(exp.endDate)}</span>
            </div>
            <div class="exp-position" style="color:#312e81">${esc(exp.position)}</div>
            ${descToList(exp.description)}
          </div>
        `).join('')}
      </div>` : ''}
      ${projects.some(p => p.name) ? `<div class="resume-section">
        <div class="section-heading">项目经历</div>
        ${projects.filter(p => p.name).map(proj => `
          <div class="proj-item">
            <div class="exp-header">
              <span class="exp-company">${esc(proj.name)}</span>
              <span class="exp-date">${esc(proj.duration || '')}</span>
            </div>
            ${proj.role ? `<div class="exp-position" style="color:#312e81">${esc(proj.role)}</div>` : ''}
            ${descToList(proj.description)}
          </div>
        `).join('')}
      </div>` : ''}
      ${awards.some(a => a.award) ? `<div class="resume-section">
        <div class="section-heading">荣誉奖项</div>
        <ul class="exp-desc-list">
          ${awards.filter(a => a.award).map(a =>
            `<li>${a.year ? `<strong>${esc(a.year)}</strong> ` : ''}${esc(a.award)}</li>`
          ).join('')}
        </ul>
      </div>` : ''}
    </div>
  `;
}

// ── 模板 3：简约清晰
function renderMinimal() {
  const { personal: p, experience, education, skills, projects, awards } = resumeData;
  return `
    <div class="minimal-accent-bar"></div>
    <div class="minimal-header">
      <div class="mh-name">${esc(p.name) || '姓名'}</div>
      <div class="mh-title">${esc(p.title) || '求职意向'}</div>
      <div class="mh-contacts">
        ${p.phone ? `<span>📱 ${esc(p.phone)}</span>` : ''}
        ${p.email ? `<span>✉️ ${esc(p.email)}</span>` : ''}
        ${p.location ? `<span>📍 ${esc(p.location)}</span>` : ''}
        ${p.github ? `<span>🔗 ${esc(p.github)}</span>` : ''}
      </div>
      ${p.summary ? `<div class="mh-summary">${esc(p.summary)}</div>` : ''}
    </div>
    <div class="minimal-body">
      ${experience.some(e => e.company) ? `<div class="resume-section">
        <div class="section-heading">工作经历</div>
        ${experience.filter(e => e.company).map(exp => `
          <div class="exp-item">
            <div class="exp-header"><span class="exp-company">${esc(exp.company)}</span><span class="exp-date">${formatDate(exp.startDate)} — ${formatDate(exp.endDate)}</span></div>
            <div class="exp-position" style="color:#7c3aed">${esc(exp.position)}</div>
            ${descToList(exp.description)}
          </div>
        `).join('')}
      </div>` : ''}
      ${projects.some(p => p.name) ? `<div class="resume-section">
        <div class="section-heading">项目经历</div>
        ${projects.filter(p => p.name).map(proj => `
          <div class="proj-item">
            <div class="exp-header"><span class="exp-company">${esc(proj.name)}</span><span class="exp-date">${esc(proj.duration || '')}</span></div>
            ${proj.role ? `<div class="exp-position" style="color:#7c3aed">${esc(proj.role)}</div>` : ''}
            ${descToList(proj.description)}
          </div>
        `).join('')}
      </div>` : ''}
      ${education.some(e => e.school) ? `<div class="resume-section">
        <div class="section-heading">教育背景</div>
        ${education.filter(e => e.school).map(edu => `
          <div class="edu-item">
            <div class="exp-header"><span class="exp-company">${esc(edu.school)}</span><span class="exp-date">${formatDate(edu.startDate)} — ${formatDate(edu.endDate)}</span></div>
            <div class="exp-position" style="color:#7c3aed">${esc(edu.degree)} · ${esc(edu.major)}</div>
            ${edu.courses ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${esc(edu.courses)}</div>` : ''}
          </div>
        `).join('')}
      </div>` : ''}
      ${skills.tech || skills.soft ? `<div class="resume-section">
        <div class="section-heading">技能特长</div>
        ${skills.tech ? `<div class="skills-wrap" style="margin-bottom:6px">${skillTags(skills.tech)}</div>` : ''}
        ${skills.soft ? `<div class="skills-wrap">${skillTags(skills.soft)}</div>` : ''}
        ${skills.lang ? `<div style="font-size:12px;color:#64748b;margin-top:6px">🌐 ${esc(skills.lang)}</div>` : ''}
      </div>` : ''}
      ${awards.some(a => a.award) ? `<div class="resume-section">
        <div class="section-heading">荣誉奖项</div>
        <ul class="exp-desc-list">
          ${awards.filter(a => a.award).map(a =>
            `<li>${a.year ? `<strong>${esc(a.year)}</strong> ` : ''}${esc(a.award)}</li>`
          ).join('')}
        </ul>
      </div>` : ''}
    </div>
  `;
}

// ───────────────────────────────────────────
// 6. PDF 导出
// ───────────────────────────────────────────
function exportPDF() {
  const el = document.getElementById('resumePreview');
  if (!el || !resumeData.personal.name) {
    showToast('⚠️ 请先填写姓名后再导出', 'error');
    return;
  }
  showToast('🖨️ 正在生成 PDF，请稍候...', 'info');

  const opt = {
    margin: 0,
    filename: `${resumeData.personal.name}_简历.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  // 临时脱离缩放
  el.style.transform = 'none';
  html2pdf().set(opt).from(el).save().then(() => {
    showToast('✅ PDF 已导出！', 'success');
  }).catch(() => {
    showToast('❌ 导出失败，请重试', 'error');
  });
}

// ───────────────────────────────────────────
// 7. 缩放控制
// ───────────────────────────────────────────
function setupZoom() {
  const wrapper = document.getElementById('previewScaleWrapper');
  const levelEl = document.getElementById('zoomLevel');
  const applyZoom = () => {
    wrapper.style.transform = `scale(${zoomLevel / 100})`;
    levelEl.textContent = `${zoomLevel}%`;
  };
  applyZoom();
  document.getElementById('zoomIn').addEventListener('click', () => {
    if (zoomLevel < 150) { zoomLevel += 5; applyZoom(); }
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    if (zoomLevel > 40) { zoomLevel -= 5; applyZoom(); }
  });
}

// ───────────────────────────────────────────
// 8. Tab 系统（AI 面板）
// ───────────────────────────────────────────
function setupAITabs() {
  document.querySelectorAll('.ai-tab').forEach(tab => {
    tab.addEventListener('click', () => switchAITab(tab.dataset.tab));
  });
}

function switchAITab(tabId) {
  document.querySelectorAll('.ai-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabId}`));
}

// ───────────────────────────────────────────
// 9. 折叠区块
// ───────────────────────────────────────────
function setupSectionToggles() {
  document.querySelectorAll('.section-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.parentElement.classList.toggle('collapsed');
    });
  });
}

// ───────────────────────────────────────────
// 10. 简历评分
// ───────────────────────────────────────────
function calcScore() {
  const { personal: p, experience, education, skills, projects } = resumeData;
  let completeness = 0, quantify = 0, keywords = 0, format = 0;

  // 完整性 (25分)
  if (p.name) completeness += 5;
  if (p.title) completeness += 5;
  if (p.phone || p.email) completeness += 5;
  if (experience.some(e => e.company)) completeness += 5;
  if (education.some(e => e.school)) completeness += 5;

  // 量化描述 (25分)
  const allDesc = [
    ...experience.map(e => e.description),
    ...projects.map(p => p.description)
  ].join(' ');
  const hasPercent = /\d+%/.test(allDesc);
  const hasNumber = /\d+/.test(allDesc);
  const hasTimes = /倍|翻|增|提升|降低|减少|优化/.test(allDesc);
  if (hasPercent) quantify += 15;
  if (hasNumber) quantify += 5;
  if (hasTimes) quantify += 5;

  // 关键词 (25分)
  const skillText = skills.tech + ' ' + skills.soft;
  if (skillText.length > 20) keywords += 10;
  if (skillText.length > 100) keywords += 10;
  if (skills.lang) keywords += 5;

  // 格式规范 (25分)
  if (p.summary) format += 8;
  if (p.summary && p.summary.length > 50) format += 7;
  if (experience.every(e => e.startDate)) format += 5;
  if (p.github || p.location) format += 5;

  const total = completeness + quantify + keywords + format;

  // 更新 UI
  document.getElementById('bigScore').textContent = total;
  const fills = document.querySelectorAll('.bd-fill');
  const vals = document.querySelectorAll('.bd-val');
  const scores = [completeness, quantify, keywords, format];
  scores.forEach((s, i) => {
    fills[i].style.width = `${s * 4}%`;
    vals[i].textContent = s;
  });

  // 建议文本
  const advices = [];
  if (completeness < 20) advices.push({ type: 'error', text: '⚠️ 简历信息不完整，请补充姓名、联系方式、工作经历等基本信息' });
  if (!hasPercent && !hasTimes) advices.push({ type: 'warn', text: '💡 工作/项目描述缺少量化数据，建议添加「提升 X%、节省 Y小时」等具体数字' });
  if (skills.tech.length < 20) advices.push({ type: 'warn', text: '💡 技能关键词较少，建议补充相关技术栈，提高 ATS 通过率' });
  if (!p.summary) advices.push({ type: 'warn', text: '💡 缺少个人简介，建议用 2-3 句话概括核心优势' });
  if (total >= 80) advices.push({ type: 'ok', text: '✅ 简历质量较好！建议继续用 AI 优化措辞表达' });

  const adviceEl = document.getElementById('scoreAdvice');
  adviceEl.innerHTML = advices.map(a =>
    `<div class="advice-item ${a.type}">${a.text}</div>`
  ).join('');

  showToast(`评分完成：${total} 分`, total >= 70 ? 'success' : 'info');
}

// ───────────────────────────────────────────
// 11. 存储 & 工具函数
// ───────────────────────────────────────────
function saveData() {
  localStorage.setItem('resumeData', JSON.stringify(resumeData));
}

let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveData, 800);
}

let renderTimer = null;
function debouncedRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 150);
}

// HTML 转义，防止 XSS
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Toast 通知
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 2800);
}

// 暴露给 ai.js 使用
window.resumeData = resumeData;
window.renderPreview = renderPreview;
window.showToast = showToast;
window.saveData = saveData;
window.switchAITab = switchAITab;
window.calcScore = calcScore;
window.applyResumeData = applyResumeData;

// ───────────────────────────────────────────
// 12. 示例模版数据
// ───────────────────────────────────────────
const SAMPLE_TEMPLATES = {
  engineer: {
    personal: {
      name: '张明远',
      title: 'Java 后端开发工程师',
      phone: '138-0000-0000',
      email: 'zhangy@example.com',
      location: '上海',
      github: 'github.com/zhangy-dev',
      summary: '3年Java后端研发经验，熟悉Spring Boot微服务、MySQL性能调优、Redis缓存设计与Kafka消息队列。曾主导高并发系统改造，QPS从5k提升至50k。热爱技术分享，善于解决复杂工程问题。',
    },
    experience: [
      {
        id: 1001,
        company: '网易互娱',
        position: '高级后端开发工程师',
        startDate: '2022-07',
        endDate: '',
        current: true,
        description: '- 主导游戏账号系统高并发架构改造，QPS从5k提升至50k，接口响应时间降低60%\n- 设计并落地用户行为分析平台，接入10+业务线，日均处理数据量超2亿条\n- 优化Kafka消费链路，通过批量消费+本地聚合策略，消息积压率降低95%\n- 引入分布式限流方案，有效保障大促期间系统稳定性达99.99%',
      },
      {
        id: 1002,
        company: '字节跳动',
        position: '后端开发工程师',
        startDate: '2021-07',
        endDate: '2022-06',
        current: false,
        description: '- 参与抖音直播礼物系统核心模块开发，支持峰值100万在线并发\n- 负责AB实验平台后端服务，累计承载实验超1000个，服务全量业务线\n- 设计分布式锁方案彻底解决礼物超卖问题，资损降低100%\n- 推动单元测试覆盖率从30%提升至75%，显著减少上线故障',
      },
    ],
    education: [
      {
        id: 2001,
        school: '同济大学',
        degree: '本科',
        major: '计算机科学与技术',
        startDate: '2017-09',
        endDate: '2021-06',
        gpa: '3.8/4.0',
        courses: 'Java程序设计、数据结构与算法、操作系统、计算机网络、数据库原理',
      },
    ],
    skills: {
      tech: 'Java, Spring Boot, Spring Cloud, MySQL, Redis, Kafka, Docker, Kubernetes, Git, MyBatis',
      soft: '系统架构设计, 技术方案评审, 代码Review, 跨团队协作',
      lang: '普通话（母语）、英语（CET-6，615分，可读写技术文档）',
    },
    projects: [
      {
        id: 3001,
        name: '高并发订单中台系统',
        role: '技术负责人',
        duration: '2023.03 — 2023.09',
        description: '- 设计分布式订单系统，支持多业务线接入，日均订单量300万+\n- 采用ShardingSphere分库分表+读写分离，单表数据量控制在100万以内\n- 引入本地消息表+事务消息保证最终一致性，订单成功率从99.5%提升至99.99%\n- 技术栈：Spring Boot, ShardingSphere, MySQL, Redis, RocketMQ',
        link: '',
      },
    ],
    awards: [
      { id: 4001, year: '2023', award: '网易互娱年度优秀员工' },
      { id: 4002, year: '2021', award: '同济大学优秀毕业生' },
    ],
  },
  pm: {
    personal: {
      name: '李晓雯',
      title: '高级产品经理 · B端SaaS方向',
      phone: '139-0000-0000',
      email: 'li.xiaowen@example.com',
      location: '北京',
      github: '',
      summary: '5年B端SaaS产品经验，主导过从0到1的企业服务产品落地。擅长用户调研、数据分析驱动产品决策，曾带领团队将客户留存率从60%提升至85%。具备扎实的项目管理能力和跨部门沟通协调经验。',
    },
    experience: [
      {
        id: 1001,
        company: '美团',
        position: '高级产品经理',
        startDate: '2022-03',
        endDate: '',
        current: true,
        description: '- 负责外卖B端商家运营平台核心模块，服务300万+商家，DAU超50万\n- 主导商家智能选品功能从0到1落地，上线3个月GMV提升12%\n- 建立竞品分析体系，输出季度竞品报告，为战略规划提供数据支撑\n- 通过用户访谈+数据分析优化核心操作路径，任务完成率提升35%',
      },
      {
        id: 1002,
        company: '滴滴出行',
        position: '产品经理',
        startDate: '2019-07',
        endDate: '2022-02',
        current: false,
        description: '- 负责司机端工具产品，覆盖500万+注册司机，NPS提升20分\n- 设计司机收入看板功能，帮助司机合理规划接单时间，人均收入提升8%\n- 推动司机端App改版，核心指标活跃率提升25%，卸载率降低18%\n- 协同技术、设计、运营团队完成年度迭代计划，按时交付率100%',
      },
    ],
    education: [
      {
        id: 2001,
        school: '北京大学',
        degree: '硕士',
        major: '信息管理与信息系统',
        startDate: '2016-09',
        endDate: '2019-06',
        gpa: '',
        courses: '信息系统分析与设计、数据库管理、用户体验设计、项目管理',
      },
    ],
    skills: {
      tech: 'Axure, Figma, SQL, Python基础, 神策数据, 灰度发布, A/B Testing, JIRA',
      soft: '用户调研, 数据分析, 需求文档撰写, 产品路线图规划, 跨部门协作',
      lang: '普通话（母语）、英语（CET-6、可独立开展英文商务沟通）',
    },
    projects: [
      {
        id: 3001,
        name: '商家智能选品推荐系统',
        role: '产品负责人',
        duration: '2022.09 — 2023.03',
        description: '- 挖掘商家选品痛点，设计基于历史销售数据+平台热销趋势的智能推荐产品\n- 输出PRD并推动技术落地，全流程周期缩短40%\n- A/B测试显示使用智能推荐的商家GMV比对照组高12%，全量推广后带来额外6亿GMV\n- 获得公司年度最具价值产品创新奖',
        link: '',
      },
    ],
    awards: [
      { id: 4001, year: '2023', award: '美团年度最具价值产品创新奖' },
      { id: 4002, year: '2017', award: '北京大学学业奖学金一等奖' },
    ],
  },
  graduate: {
    personal: {
      name: '陈志远',
      title: '前端开发工程师（应届）',
      phone: '135-0000-0000',
      email: 'chenzy@example.com',
      location: '深圳',
      github: 'github.com/chenzy-dev',
      summary: '华南理工大学软件工程本科应届生，熟练掌握Vue3、React、TypeScript等前端技术栈。在腾讯完成6个月实习，独立负责2个业务模块开发。热衷开源社区，GitHub项目累计Star 300+。',
    },
    experience: [
      {
        id: 1001,
        company: '腾讯',
        position: '前端开发实习生',
        startDate: '2024-07',
        endDate: '2025-01',
        current: false,
        description: '- 独立负责微信「搜一搜」结果页新版UI改造，使用Vue3+TypeScript开发，按时上线\n- 优化长列表虚拟滚动方案，页面帧率从35fps提升至60fps，内存占用降低40%\n- 参与组件库建设，贡献6个通用组件，被9个业务团队复用\n- 编写页面性能优化方案文档，在部门内分享推广',
      },
    ],
    education: [
      {
        id: 2001,
        school: '华南理工大学',
        degree: '本科',
        major: '软件工程',
        startDate: '2021-09',
        endDate: '2025-06',
        gpa: '3.7/4.0（专业前10%）',
        courses: 'Web前端开发、JavaScript高级程序设计、数据结构、算法设计、软件工程导论',
      },
    ],
    skills: {
      tech: 'Vue3, React, TypeScript, JavaScript, HTML/CSS, Webpack, Vite, Git, Node.js基础',
      soft: '自驱学习, 文档撰写, 代码规范, 问题分析定位',
      lang: '普通话（母语）、英语（CET-6，可流畅阅读英文技术文档）',
    },
    projects: [
      {
        id: 3001,
        name: '个人博客系统（开源）',
        role: '独立开发',
        duration: '2023.09 — 至今',
        description: '- 基于Vue3+Vite构建前台展示+后台管理系统，支持Markdown写作\n- 实现代码高亮、文章目录、全文搜索等核心功能\n- GitHub累计Star 300+，被收录至多个Vue3开源项目导航\n- 部署在Vercel，Lighthouse性能评分95+',
        link: 'github.com/chenzy-dev/blog',
      },
      {
        id: 3002,
        name: '校园二手物品交易平台',
        role: '前端负责人 / 4人团队',
        duration: '2023.03 — 2023.08',
        description: '- 负责全部前端模块开发，基于React+Ant Design实现\n- 设计并实现实时聊天功能（WebSocket），消息延迟≤200ms\n- 上线后覆盖全校2万+学生，月均交易额达15万元',
        link: '',
      },
    ],
    awards: [
      { id: 4001, year: '2024', award: '华南理工大学优秀学生奖学金' },
      { id: 4002, year: '2023', award: '全国大学生软件创新大赛三等奖' },
    ],
  },
};

// ───────────────────────────────────────────
// 13. 应用外部数据到编辑器（模版加载 / AI 解析）
// ───────────────────────────────────────────
function applyResumeData(incoming) {
  // 合并个人信息
  resumeData.personal = Object.assign(
    { name: '', title: '', phone: '', email: '', location: '', github: '', summary: '' },
    incoming.personal || {}
  );

  // 合并技能
  resumeData.skills = Object.assign(
    { tech: '', soft: '', lang: '' },
    incoming.skills || {}
  );

  // 替换动态数组（补全 id 字段）
  const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
  resumeData.experience = (incoming.experience || []).map(e => ({
    id: e.id || stamp(),
    company: e.company || '',
    position: e.position || '',
    startDate: e.startDate || '',
    endDate: e.endDate || '',
    current: !!e.current,
    description: e.description || '',
  }));
  resumeData.education = (incoming.education || []).map(e => ({
    id: e.id || stamp(),
    school: e.school || '',
    degree: e.degree || '本科',
    major: e.major || '',
    startDate: e.startDate || '',
    endDate: e.endDate || '',
    gpa: e.gpa || '',
    courses: e.courses || '',
  }));
  resumeData.projects = (incoming.projects || []).map(p => ({
    id: p.id || stamp(),
    name: p.name || '',
    role: p.role || '',
    duration: p.duration || '',
    description: p.description || '',
    link: p.link || '',
  }));
  resumeData.awards = (incoming.awards || []).map(a => ({
    id: a.id || stamp(),
    year: a.year || '',
    award: a.award || '',
  }));

  // 确保每个动态区至少有 1 行空白供用户填写
  if (!resumeData.experience.length) addItem('experience');
  if (!resumeData.education.length) addItem('education');
  if (!resumeData.projects.length) addItem('projects');
  if (!resumeData.awards.length) addItem('awards');

  syncFormValues();
  renderDynamicLists();
  renderPreview();
  saveData();
}

// ───────────────────────────────────────────
// 14. 模版选择弹窗
// ───────────────────────────────────────────
function initTemplatePicker() {
  const modal = document.getElementById('templatePickerModal');
  if (!modal) return;

  document.getElementById('btnLoadTemplate')?.addEventListener('click', () => {
    modal.hidden = false;
  });

  document.getElementById('templatePickerClose')?.addEventListener('click', () => {
    modal.hidden = true;
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  modal.querySelectorAll('.tpl-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.closest('[data-tpl]').dataset.tpl;
      const tpl = SAMPLE_TEMPLATES[key];
      if (!tpl) return;
      if (!confirm('加载模版将覆盖当前所有内容，是否继续？')) return;
      modal.hidden = true;
      applyResumeData(tpl);
      showToast('✅ 模版已加载，请在左侧修改为你的真实信息', 'success');
    });
  });
}

// ───────────────────────────────────────────
// 15. Word / PDF 上传解析
// ───────────────────────────────────────────
function initUpload() {
  const fileInput = document.getElementById('resumeFileInput');
  const dropZone = document.getElementById('dropZone');
  if (!fileInput || !dropZone) return;

  // 点击拖拽区 → 触发文件选择
  dropZone.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) handleFileUpload(file);
  });

  // 拖拽进入 — 高亮
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    // 只在真正离开区域时取消高亮
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('drag-over');
    }
  });

  // 拖拽放下 — 处理文件
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'doc', 'docx'].includes(ext)) {
      showToast('⚠️ 仅支持 PDF 或 Word 文件', 'error');
      return;
    }
    handleFileUpload(file);
  });

  // 全页面拖拽时只阻止默认行为（防止浏览器打开文件），但不阻断拖拽区自己的 drop
  document.addEventListener('dragover', (e) => {
    if (!e.target.closest('#dropZone')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (!e.target.closest('#dropZone')) e.preventDefault();
  });
}

async function handleFileUpload(file) {
  const backendUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `http://localhost:${window.location.port || 3000}`
    : '';
  const token = localStorage.getItem('jy_session_token') || '';
  const overlay = document.getElementById('uploadOverlay');
  const statusEl = document.getElementById('uploadStatus');

  overlay.hidden = false;

  try {
    let text = '';
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'pdf') {
      statusEl.textContent = '正在读取 PDF 文件...';
      text = await extractPdfText(file);
    } else if (ext === 'docx') {
      statusEl.textContent = '正在读取 Word 文档...';
      text = await extractDocxText(file);
    } else {
      throw new Error('不支持的格式，请上传 PDF 或 .docx 文件（不支持旧版 .doc）');
    }

    if (!text || text.trim().length < 20) {
      throw new Error('文件内容为空或无法读取。如是扫描版PDF，请先进行OCR转换再上传。');
    }

    statusEl.textContent = 'AI 正在解析简历结构... (消耗 2 积分)';

    const res = await fetch(`${backendUrl}/api/ai/parse-resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token,
      },
      body: JSON.stringify({ resumeText: text.slice(0, 15000) }),
    });

    const json = await res.json();

    if (!res.ok) {
      if (res.status === 402) {
        overlay.hidden = true;
        window.showPricingModal?.();
        return;
      }
      throw new Error(json.error || '解析失败，请重试');
    }

    // 更新积分显示
    const remaining = res.headers.get('X-Credits-Remaining');
    if (remaining !== null && window.updateCreditDisplay) {
      window.updateCreditDisplay(parseInt(remaining, 10));
    }

    applyResumeData(json.data);
    overlay.hidden = true;
    showToast('✅ 简历解析完成，请检查各字段并补充遗漏内容', 'success');

  } catch (err) {
    overlay.hidden = true;
    showToast(`❌ ${err.message}`, 'error');
  }
}

async function extractPdfText(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF 解析库未加载，请刷新页面后重试');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    text += pageText + '\n';
  }
  return text;
}

async function extractDocxText(file) {
  if (typeof mammoth === 'undefined') {
    throw new Error('Word 解析库未加载，请刷新页面后重试');
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// ───────────────────────────────────────────
// 启动
// ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
