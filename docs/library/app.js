import { searchArticles } from './search.js';

const byId = (id) => document.getElementById(id);
const pageSize = 12;
const state = { articles: [], meta: {}, query: '', year: 'all', sort: 'relevance', view: 'search', page: 1, loading: false, ready: false, searching: false };
const questionNeedsBoundary = /持仓|仓位|买入|卖出|买卖|操作|收益|赚|亏|明天|未来|预测|推荐|怎么办|能买|买哪|目标价|下周|本周|最近|现在|今天|涨到/;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function publicArticleUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com' || url.port || url.username || url.password) return null;
    if (url.pathname !== '/s' && !/^\/s\/[A-Za-z0-9_-]+$/.test(url.pathname)) return null;
    if ([...url.searchParams.keys()].some((key) => !['__biz', 'mid', 'idx', 'sn'].includes(key))) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function dateLabel(value) {
  return typeof value === 'string' && value ? value.slice(0, 10) : '发布时间待核实';
}

function originalityLabel(value) {
  if (value === true) return '已标注原创';
  if (value === false) return '未标注原创';
  if (typeof value !== 'string' || !value.trim()) return '原创状态未核实';
  const labels = { original: '已标注原创', non_original: '非原创', reprint: '转载', unknown: '原创状态未核实', unmarked: '未标注原创' };
  return labels[value] || value;
}

function dateCompare(a, b, direction = -1) {
  return String(a.date || '').localeCompare(String(b.date || '')) * direction || String(a.id).localeCompare(String(b.id));
}

function emptyMessage(title, message) {
  const box = element('div', 'no-results');
  box.append(element('h3', '', title), element('p', '', message));
  return box;
}

function fullText(article) {
  const details = element('details', 'full-text');
  const summary = element('summary', '', '展开阅读全文');
  details.append(summary);
  // Create the full text only on first expansion to keep mobile rendering light.
  details.addEventListener('toggle', () => {
    summary.textContent = details.open ? '收起全文' : '展开阅读全文';
    if (details.open && !details.querySelector('.article-body')) {
      const body = element('div', 'article-body', article.body || '正文暂缺。');
      body.tabIndex = 0;
      body.setAttribute('aria-label', `${article.title}的提取正文，可滚动阅读`);
      details.append(body);
      if (article.dateSource) details.append(element('p', 'article-provenance', `时间来源：${article.dateSource}。若为标题日期推断，则不等于精确发布时间。`));
      details.append(element('p', 'article-provenance', '正文为提取文本；少量链接经安全清理，图片与图表未转写。完整语境请核对公众号原文。'));
    }
  });
  return details;
}

function articleCard(article, excerpts = [], index = null) {
  const card = element('article', 'article-card');
  const topline = element('div', 'article-topline');
  const inferredDate = typeof article.dateSource === 'string' && /推断|标题/.test(article.dateSource);
  const date = element('time', 'article-date', `${dateLabel(article.date)}${inferredDate ? '（标题推断，非精确发布时间）' : ''}`);
  if (article.dateSource) date.title = `时间来源：${article.dateSource}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(article.date || '')) date.dateTime = article.date.slice(0, 10);
  topline.append(date, element('span', 'originality', originalityLabel(article.originality)));
  card.append(topline, element('h3', '', article.title || '无标题文章'));
  if (excerpts.length) {
    card.append(element('span', 'citation-label', index === null ? '连续原文片段' : `原文依据 ${String(index + 1).padStart(2, '0')}`));
    for (const excerpt of excerpts) {
      if (typeof excerpt?.text === 'string' && excerpt.text) card.append(element('blockquote', 'excerpt', excerpt.text));
    }
  }
  const actions = element('div', 'article-actions');
  const url = publicArticleUrl(article.url);
  if (url) {
    const link = element('a', 'source-link', '查看公众号原文 ↗');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `打开《${article.title}》的公众号原文，新窗口`);
    actions.append(link);
  } else {
    actions.append(element('span', 'source-unavailable', '原文链接待核实，仅展示已收集正文'));
  }
  card.append(actions, fullText(article));
  return card;
}

function matchingArticles() {
  if (state.query) return searchArticles(state.articles, state.query, { year: state.year, sort: state.sort, limit: state.articles.length });
  const filtered = state.articles.filter((article) => state.year === 'all' || String(article.date || '').slice(0, 4) === state.year);
  filtered.sort((a, b) => dateCompare(a, b, state.sort === 'dateAsc' ? 1 : -1));
  return filtered.map((article) => ({ article, excerpts: [], score: 0 }));
}

function renderSearch() {
  byId('search-empty').hidden = Boolean(state.query);
  byId('search-output').hidden = !state.query;
  if (!state.query) return;
  byId('query-display').textContent = state.query;
  byId('historical-warning').hidden = !questionNeedsBoundary.test(state.query);
  const matches = matchingArticles();
  const results = byId('search-results');
  results.replaceChildren();
  const dateScope = state.meta.lastDate ? `资料截至 ${dateLabel(state.meta.lastDate)}` : '资料时间范围见页面说明';
  const yearScope = state.year === 'all' ? '全部年份' : `${state.year} 年`;
  if (!matches.length) {
    byId('search-summary').textContent = `在${yearScope}已收集文章中，没有找到直接匹配。${dateScope}。`;
    results.append(emptyMessage('这次没有找到对应原文', '可以换成公司名、行业名或较短关键词，也可切换“全部年份”。未搜集到不代表作者没有写过，更不能据此生成他的态度。'));
    return;
  }
  const shown = matches.slice(0, 6);
  byId('search-summary').textContent = `找到 ${matches.length} 篇相关记录，先展示 ${shown.length} 篇。以下仅为原文引文，不是 AI 回答；${dateScope}。更多匹配可在“文章目录”查看。`;
  shown.forEach((result, index) => results.append(articleCard(result.article, result.excerpts, index)));
}

function renderDirectory() {
  const matches = matchingArticles();
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  state.page = Math.min(Math.max(1, state.page), pages);
  byId('directory-count').textContent = `${matches.length} 篇记录`;
  const list = byId('directory-results');
  list.replaceChildren();
  if (!matches.length) list.append(emptyMessage('当前条件下没有文章', '试试清空关键词或切换年份。未收集到不等于当时没有发文。'));
  for (const result of matches.slice((state.page - 1) * pageSize, state.page * pageSize)) list.append(articleCard(result.article));
  byId('pagination').hidden = matches.length <= pageSize;
  byId('previous-page').disabled = state.page <= 1;
  byId('next-page').disabled = state.page >= pages;
  byId('page-label').textContent = `${state.page} / ${pages} 页`;
}

function renderActive() {
  if (!state.ready) return;
  if (state.view === 'search') renderSearch();
  else renderDirectory();
}

function switchView(view, focus = false) {
  state.view = view;
  for (const name of ['search', 'directory']) {
    const selected = name === view;
    const tab = byId(`${name}-tab`);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    byId(`${name}-view`).hidden = !selected;
  }
  renderActive();
  if (focus) byId(`${view}-tab`).focus();
}

function setEnabled(enabled) {
  for (const id of ['search-button', 'year-filter', 'sort-order']) byId(id).disabled = !enabled;
  for (const button of document.querySelectorAll('.suggestion')) button.disabled = !enabled;
}

async function loadArticles() {
  if (state.loading) return;
  state.loading = true;
  state.ready = false;
  setEnabled(false);
  byId('loading-state').hidden = false;
  byId('error-state').hidden = true;
  byId('loaded-content').hidden = true;
  let timer;
  const controller = new AbortController();
  try {
    timer = setTimeout(() => controller.abort(), 25000);
    const response = await fetch(new URL('./data/articles.json', import.meta.url), { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error('archive_unavailable');
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.articles) || !data.articles.length) throw new Error('archive_invalid');
    state.articles = data.articles.filter((article) => article && typeof article.title === 'string' && typeof article.body === 'string' && article.body.trim());
    if (!state.articles.length) throw new Error('archive_empty');
    state.meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
    byId('article-count').textContent = state.articles.length;
    const first = state.meta.firstDate ? dateLabel(state.meta.firstDate) : '起始日期待核实';
    const last = state.meta.lastDate ? dateLabel(state.meta.lastDate) : '截止日期待核实';
    byId('date-range').textContent = `${first} — ${last}`;
    const countNote = Number.isFinite(state.meta.totalDiscovered) ? `已发现 ${state.meta.totalDiscovered} 条记录，其中 ${state.articles.length} 篇完整正文纳入本站。` : `本站纳入 ${state.articles.length} 篇完整正文。`;
    const notice = typeof state.meta.notice === 'string' ? state.meta.notice : '资料库不是完整发文档案；未收集到不代表当时没有发文。';
    byId('coverage-note').textContent = `${countNote}资料截至 ${last}。${notice}`;
    const select = byId('year-filter');
    select.replaceChildren();
    const all = element('option', '', '全部年份');
    all.value = 'all';
    select.append(all);
    const counts = new Map();
    for (const article of state.articles) {
      const year = String(article.date || '').slice(0, 4);
      if (/^\d{4}$/.test(year)) counts.set(year, (counts.get(year) || 0) + 1);
    }
    for (const year of [...counts.keys()].sort().reverse()) {
      const option = element('option', '', `${year}（${counts.get(year)}）`);
      option.value = year;
      select.append(option);
    }
    if (state.year !== 'all' && !counts.has(state.year)) state.year = 'all';
    select.value = state.year;
    state.ready = true;
    setEnabled(true);
    byId('loaded-content').hidden = false;
    renderActive();
  } catch {
    byId('error-state').hidden = false;
    byId('article-count').textContent = '—';
    byId('date-range').textContent = '文章库尚未加载，不能确认记录范围';
  } finally {
    clearTimeout(timer);
    state.loading = false;
    byId('loading-state').hidden = true;
  }
}

function submitQuery() {
  if (!state.ready || state.searching) return;
  state.searching = true;
  byId('search-button').disabled = true;
  try {
    state.query = byId('query').value.trim().slice(0, 120);
    byId('query').value = state.query;
    state.page = 1;
    byId('input-note').textContent = state.query ? '本次关键词仅用于页面内检索，不保存、不发送给模型。' : '关键词已清空。可以查找新内容，或在“文章目录”按年翻阅。';
    renderActive();
  } catch {
    byId('input-note').textContent = '检索暂时未完成，请换个关键词再试。没有生成任何回答。';
  } finally {
    state.searching = false;
    byId('search-button').disabled = false;
  }
}

byId('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitQuery();
});
byId('query').addEventListener('search', () => {
  if (!byId('query').value) submitQuery();
});
for (const button of document.querySelectorAll('.suggestion')) button.addEventListener('click', () => {
  byId('query').value = button.dataset.query;
  switchView('search');
  submitQuery();
});
byId('year-filter').addEventListener('change', (event) => {
  state.year = event.target.value;
  state.page = 1;
  renderActive();
});
byId('sort-order').addEventListener('change', (event) => {
  state.sort = event.target.value;
  state.page = 1;
  renderActive();
});
for (const view of ['search', 'directory']) {
  byId(`${view}-tab`).addEventListener('click', () => switchView(view));
  byId(`${view}-tab`).addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      switchView(event.key === 'Home' ? 'search' : event.key === 'End' ? 'directory' : view === 'search' ? 'directory' : 'search', true);
    }
  });
}
for (const [id, step] of [['previous-page', -1], ['next-page', 1]]) byId(id).addEventListener('click', () => {
  state.page += step;
  renderDirectory();
  byId('directory-view').focus({ preventScroll: true });
  byId('directory-view').scrollIntoView({ behavior: 'auto', block: 'start' });
});
byId('retry-button').addEventListener('click', loadArticles);
loadArticles();
