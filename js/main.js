/* ===========================
   首页交互逻辑
=========================== */

// 导航栏滚动变色
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
});

// 汉堡菜单
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
});
// 点击链接关闭菜单
navLinks.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => navLinks.classList.remove('open'));
});

// ===========================
// 数字滚动动画
// ===========================
function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  const duration = 1800;
  const step = target / (duration / 16);
  let current = 0;
  const timer = setInterval(() => {
    current += step;
    if (current >= target) {
      current = target;
      clearInterval(timer);
    }
    el.textContent = Math.floor(current).toLocaleString('zh-CN');
  }, 16);
}

// 用 IntersectionObserver 在进入视口时启动
const counters = document.querySelectorAll('.stat-num[data-target]');
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });
counters.forEach(el => counterObserver.observe(el));

// ===========================
// 元素入场动画（渐入）
// ===========================
const animateEls = document.querySelectorAll(
  '.feature-card, .step-card, .template-card, .section-header'
);

const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.animationPlayState = 'running';
      entry.target.classList.add('visible');
      fadeObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

animateEls.forEach((el, i) => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = `opacity 0.5s ease ${i * 0.06}s, transform 0.5s ease ${i * 0.06}s`;
  fadeObserver.observe(el);
});

document.addEventListener('DOMContentLoaded', () => {
  // 确保 visible 类触发动画
  document.querySelectorAll('.visible').forEach(el => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });
});

// 用 MutationObserver 监听 visible 类变化（兼容异步）
const visibleObserver = new MutationObserver((mutations) => {
  mutations.forEach(mutation => {
    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      const el = mutation.target;
      if (el.classList.contains('visible')) {
        el.style.opacity = '1';
        el.style.transform = 'none';
      }
    }
  });
});
animateEls.forEach(el => visibleObserver.observe(el, { attributes: true }));

// ===========================
// 模板卡片点击 → 进入编辑器
// ===========================
document.querySelectorAll('.template-card').forEach(card => {
  card.addEventListener('click', () => {
    const tplName = card.dataset.name;
    // 将选中的模板存入 localStorage，编辑器页读取
    localStorage.setItem('selectedTemplate', tplName);
    window.location.href = 'editor.html';
  });
});

// ===========================
// 平滑返回顶部（点击 Logo）
// ===========================
document.querySelectorAll('a[href="index.html"]').forEach(a => {
  a.addEventListener('click', (e) => {
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
});
