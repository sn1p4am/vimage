const byId = id => document.getElementById(id);
const defaults = { view: 'overview', type: 'image', q: '', range: 'all', status: 'all', source: 'all', sort: 'newest', page: 1, limit: 20 };
const choices = {
  view: ['overview', 'logs'], type: ['image', 'error'],
  range: ['all', '1h', '24h', '7d', '30d'], status: ['all', 'success', 'fallback'],
  source: ['all', 'cache', 'direct', 'rewritten', 'picsum'], sort: ['newest', 'oldest', 'slowest']
};
const filterControls = { q: 'searchInput', range: 'rangeFilter', status: 'statusFilter', source: 'sourceFilter', sort: 'sortFilter' };
const state = { ...defaults, total: 0, totalPages: 0, logs: [], loading: false, requestId: 0, controller: null, selectedLog: null, redirecting: false };

function readLocation() {
  const params = new URLSearchParams(window.location.search);
  Object.assign(state, defaults);
  for (const [name, allowed] of Object.entries(choices)) {
    if (allowed.includes(params.get(name))) state[name] = params.get(name);
  }
  state.q = (params.get('q') || '').slice(0, 200);
  const page = Number(params.get('page'));
  state.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const limit = Number(params.get('limit'));
  if ([20, 50, 100].includes(limit)) state.limit = limit;
  if (state.type === 'error') state.status = state.source = 'all';
}

function saveLocation(replace = false) {
  const params = new URLSearchParams();
  for (const name of Object.keys(defaults)) {
    if (state[name] !== defaults[name]) params.set(name, String(state[name]));
  }
  const url = window.location.pathname + (params.size ? '?' + params.toString() : '');
  if (url !== window.location.pathname + window.location.search) {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatNumber(value) { return Number(value || 0).toLocaleString('zh-CN'); }
function percent(value, total) { return total > 0 ? (value / total * 100).toFixed(1) + '%' : '—'; }
function duration(value) {
  if (value === null || value === undefined) return '—';
  return value >= 1000 ? (value / 1000).toFixed(2) + ' s' : formatNumber(value) + ' ms';
}
function timestamp(value) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}
function badge(text, variant) { return createElement('span', 'badge badge-' + variant, text); }
function sourceLabel(source) {
  if (source === 'cache') return '应用缓存';
  if (source === 'search-failed') return '搜索失败';
  if (source === 'unsplash') return 'Unsplash 原词';
  if (source?.startsWith('unsplash-retry-')) return '换词命中 · 第 ' + source.slice(-1) + ' 次';
  if (source?.startsWith('picsum')) return 'Picsum 兜底';
  return source || '—';
}
function resultBadge(log) {
  if (!log.query_term) return badge('格式拒绝', 'danger');
  if (log.success) return badge('匹配成功', 'success');
  return badge(log.source?.startsWith('picsum') ? '随机兜底' : '匹配失败', 'warning');
}
function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && ['images.unsplash.com', 'picsum.photos'].includes(url.hostname) ? url : null;
  } catch { return null; }
}
function imagePreview(log, large = false) {
  const url = safeImageUrl(log.final_url);
  if (!url) return createElement('span', 'muted', '无图片');
  const link = createElement('a', large ? 'detail-preview' : 'preview-link');
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', '在新标签页查看图片');
  if (!large) {
    if (url.hostname === 'images.unsplash.com') {
      url.searchParams.set('w', '160');
      url.searchParams.set('q', '40');
    } else url.pathname = '/160/112';
  }
  const image = createElement('img');
  image.alt = large ? log.query_term || '返回图片' : '';
  image.src = url.href;
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => {
    link.replaceChildren(createElement('span', 'muted', '预览不可用，点击打开原图'));
  }, { once: true });
  link.append(image);
  return link;
}

function drillInto(kind) {
  Object.assign(state, defaults, { view: 'logs' });
  if (kind === 'error') state.type = 'error';
  if (kind === 'success' || kind === 'fallback') state.status = kind;
  if (['cache', 'direct', 'rewritten', 'picsum'].includes(kind)) state.source = kind;
  if (kind === 'slowest') state.sort = 'slowest';
  syncControls();
  saveLocation();
  loadData();
}

function renderStats(data) {
  const count = Number(data.imageRequests || 0);
  const success = Number(data.successCount || 0);
  const cached = Number(data.cacheHitCount || 0);
  const direct = Number(data.directUnsplashCount || 0);
  const rewritten = Number(data.rewrittenUnsplashCount || 0);
  const fallback = Math.max(0, count - success);
  byId('imageRequests').textContent = formatNumber(count);
  byId('excludedErrors').textContent = '另有 ' + formatNumber(data.errorRequests) + ' 条格式错误';
  byId('successRate').textContent = percent(success, count);
  byId('successRatio').textContent = formatNumber(success) + ' / ' + formatNumber(count) + ' 次匹配成功';
  byId('cacheHitRate').textContent = percent(cached, count);
  byId('cacheRatio').textContent = formatNumber(cached) + ' 次缓存命中 · 无需外部搜索';
  byId('avgResponseTime').textContent = count ? duration(data.avgResponseTime) : '—';
  byId('fallbackCount').textContent = formatNumber(fallback);
  byId('formatErrorCount').textContent = formatNumber(data.errorRequests);
  byId('imageLogCount').textContent = formatNumber(count);
  byId('errorLogCount').textContent = formatNumber(data.errorRequests);
  byId('statsScope').textContent = '统计范围：当前保留日志'
    + (data.retentionDays > 0 ? '（自动保留 ' + data.retentionDays + ' 天）' : '（未启用自动清理）')
    + '。不含浏览器或 CDN 直接命中的请求；不随日志筛选变化。';
  const sources = [
    ['应用缓存', cached, 'cache', 'cache'], ['Unsplash 原词', direct, 'direct', 'direct'],
    ['Unsplash 换词', rewritten, 'rewritten', 'rewritten'], ['未匹配 / 兜底', fallback, 'fallback', 'fallback']
  ];
  const distribution = byId('sourceDistribution');
  distribution.replaceChildren();
  for (const [label, value, color, filter] of sources) {
    const row = createElement('button', 'source-row');
    row.type = 'button';
    row.setAttribute('aria-label', label + ' ' + formatNumber(value) + ' 次，查看日志');
    const track = createElement('span', 'bar-track');
    const fill = createElement('span', 'bar-fill ' + color);
    fill.style.width = (count ? Math.min(100, value / count * 100) : 0) + '%';
    track.setAttribute('aria-hidden', 'true');
    track.append(fill);
    row.append(createElement('span', 'source-label', label), track, createElement('strong', '', formatNumber(value) + ' · ' + percent(value, count)));
    row.addEventListener('click', () => drillInto(filter));
    distribution.append(row);
  }
  byId('directUnsplashCount').textContent = formatNumber(direct) + ' 次';
  byId('directUnsplashRate').textContent = percent(direct, direct + rewritten);
  byId('directUnsplashTime').textContent = '平均 ' + duration(data.directUnsplashAvgResponseTime);
  byId('rewrittenUnsplashCount').textContent = formatNumber(rewritten) + ' 次';
  byId('rewrittenUnsplashRate').textContent = percent(rewritten, direct + rewritten);
  byId('rewrittenUnsplashTime').textContent = '平均 ' + duration(data.rewrittenUnsplashAvgResponseTime);
  byId('matchNote').textContent = direct + rewritten ? '共 ' + formatNumber(direct + rewritten) + ' 次成功搜索；缓存与随机兜底不参与此处占比。' : '暂无成功搜索，收到请求后显示命中效率。';
  const quota = data.rateLimitStatus || {};
  const cache = data.cacheStats || {};
  byId('rateLimit').textContent = formatNumber(quota.current) + ' / ' + formatNumber(quota.limit);
  byId('rateLimitReset').textContent = Math.ceil((quota.resetIn || 0) / 60) + ' 分钟后重置 · 当前进程计数';
  byId('quotaProgress').style.width = (quota.limit ? Math.min(100, quota.current / quota.limit * 100) : 0) + '%';
  byId('quotaProgress').style.background = quota.current >= quota.limit * .8 ? '#b67a29' : '';
  byId('cacheEntries').textContent = '内存 ' + formatNumber(cache.activeEntries) + ' / 持久化 ' + formatNumber(cache.persistentEntries);
  byId('cacheTtl').textContent = '最长 ' + Math.round((cache.ttlSeconds || 0) / 3600) + ' 小时 · 持久化缓存跨重启保留';
  const hits = (cache.memoryHits || 0) + (cache.persistentHits || 0);
  byId('processCacheRate').textContent = percent(hits, hits + (cache.processMisses || 0));
  byId('processCacheRatio').textContent = '内存命中 ' + formatNumber(cache.memoryHits) + ' · 持久化命中 ' + formatNumber(cache.persistentHits) + ' · 未命中 ' + formatNumber(cache.processMisses);
}

function detailButton(log) {
  const button = createElement('button', 'text-button', '详情');
  button.type = 'button';
  button.setAttribute('aria-label', '查看请求 #' + log.id + ' 详情');
  button.addEventListener('click', () => openDetail(log));
  return button;
}

function renderLogs() {
  if (!state.logs.length) {
    const filtered = hasFilters();
    showLogState(filtered ? '没有符合条件的日志' : '暂无' + (state.type === 'error' ? '格式错误' : '图片请求'),
      filtered ? '试试缩短搜索词、扩大时间范围，或清除筛选。' : '新的请求记录会显示在这里。', filtered ? resetFilters : null, '清除筛选');
    return;
  }
  const isError = state.type === 'error';
  const preview = byId('showPreviews').checked && !isError;
  const wrapper = createElement('div', 'table-scroll');
  const table = createElement('table', 'logs-table');
  table.setAttribute('aria-label', isError ? '格式错误日志' : '图片请求日志');
  const head = createElement('thead');
  const header = createElement('tr');
  const columns = [['时间 / 北京', 'time'], [isError ? '请求路径 / 原因' : '查询词 / 请求路径', 'query'], ['来源', 'source'], ['结果', 'result'], ['耗时', 'duration']];
  if (preview) columns.push(['预览', 'preview']);
  columns.push(['操作', 'action']);
  for (const [label, name] of columns) {
    const cell = createElement('th', 'col-' + name, label);
    cell.scope = 'col';
    header.append(cell);
  }
  head.append(header);
  const body = createElement('tbody');
  const mobile = createElement('div', 'mobile-list');
  for (const log of state.logs) {
    const row = createElement('tr');
    const time = createElement('td', 'time-cell', timestamp(log.timestamp));
    const query = createElement('td');
    const mainText = isError ? log.original_url : log.query_term;
    const secondaryText = isError ? log.error_message : log.original_url;
    const primary = createElement('span', 'query-primary', mainText || '—');
    primary.title = mainText || '';
    const secondary = createElement('span', 'request-path', secondaryText || '—');
    secondary.title = secondaryText || '';
    query.append(primary, secondary);
    const source = createElement('td');
    source.append(badge(sourceLabel(log.source), log.source === 'cache' ? 'cache' : 'neutral'));
    const result = createElement('td');
    result.append(resultBadge(log));
    const elapsed = createElement('td', 'duration-cell' + (log.response_time >= 3000 ? ' slow' : ''), duration(log.response_time));
    elapsed.title = formatNumber(log.response_time) + ' ms';
    row.append(time, query, source, result, elapsed);
    if (preview) {
      const image = createElement('td');
      image.append(imagePreview(log));
      row.append(image);
    }
    const action = createElement('td');
    action.append(detailButton(log));
    row.append(action);
    body.append(row);
    const card = createElement('article', 'mobile-card');
    const cardHeader = createElement('div', 'mobile-card-header');
    cardHeader.append(createElement('time', 'time-cell', timestamp(log.timestamp)), resultBadge(log));
    const footer = createElement('div', 'mobile-card-footer');
    footer.append(createElement('span', 'muted', sourceLabel(log.source) + ' · ' + duration(log.response_time)), detailButton(log));
    card.append(cardHeader, createElement('span', 'query-primary', mainText || '—'), createElement('span', 'request-path', secondaryText || '—'));
    if (preview) card.append(imagePreview(log));
    card.append(footer);
    mobile.append(card);
  }
  table.append(head, body);
  wrapper.append(table);
  byId('logsContent').replaceChildren(wrapper, mobile);
}

function showLogState(title, message, action, label) {
  const empty = createElement('div', 'empty-state');
  empty.append(createElement('strong', '', title), createElement('p', '', message));
  if (action) {
    const button = createElement('button', 'button', label);
    button.type = 'button';
    button.addEventListener('click', action);
    empty.append(button);
  }
  byId('logsContent').replaceChildren(empty);
}

function openDetail(log) {
  state.selectedLog = log;
  byId('detailTitle').textContent = '请求 #' + log.id;
  byId('detailFeedback').textContent = '';
  const content = byId('detailContent');
  const summary = createElement('div', 'detail-summary');
  summary.append(resultBadge(log), badge(sourceLabel(log.source), 'neutral'), createElement('span', 'muted', duration(log.response_time)));
  const fields = createElement('dl', 'detail-fields');
  for (const [label, value] of [['请求时间', timestamp(log.timestamp) + '（北京时间）'], ['请求路径', log.original_url], ['原始查询词', log.query_term], ['图片来源', sourceLabel(log.source)], ['处理耗时', formatNumber(log.response_time) + ' ms'], ['缓存命中', log.from_cache ? '是' : '否'], ['重试次数', String(log.retry_count || 0)]]) {
    fields.append(createElement('dt', '', label), createElement('dd', '', value || '—'));
  }
  content.replaceChildren(summary, fields);
  if (log.error_message) {
    content.append(createElement('h3', '', '错误 / 降级原因'), createElement('div', 'detail-error', log.error_message));
  } else if (log.query_term && !log.success) {
    content.append(createElement('div', 'detail-error', '未匹配到图片或搜索预算已用尽。随机兜底不代表语义匹配成功。'));
  }
  if (log.query_term) {
    content.append(createElement('h3', '', '处理链路'));
    const steps = createElement('ol', 'search-steps');
    if (log.from_cache) {
      steps.append(createElement('li', '', '命中应用缓存，跳过外部搜索'));
    } else {
      steps.append(createElement('li', '', '原始查询：' + log.query_term));
      [log.retry_1_term, log.retry_2_term, log.retry_3_term].forEach((term, index) => {
        if (term) steps.append(createElement('li', '', '换词 ' + (index + 1) + '：' + term));
      });
    }
    steps.append(createElement('li', '', log.success ? '匹配成功 → ' + sourceLabel(log.source) : '未匹配 → ' + sourceLabel(log.source)));
    content.append(steps);
  }
  const url = safeImageUrl(log.final_url);
  if (url) {
    content.append(createElement('h3', '', '返回图片'), imagePreview(log, true));
    const link = createElement('a', 'request-path', '在新标签页打开原图 ↗');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    content.append(link);
    if (url.hostname === 'picsum.photos') content.append(createElement('p', 'muted', '随机兜底预览可能与请求时的图片不同。'));
  }
  const raw = createElement('details');
  raw.append(createElement('summary', '', '查看原始 JSON'), createElement('pre', '', JSON.stringify(log, null, 2)));
  content.append(raw);
  byId('detailDialog').showModal();
  content.scrollTop = 0;
  updateRefreshMode();
}

function hasFilters() { return Boolean(state.q || state.range !== 'all' || state.status !== 'all' || state.source !== 'all'); }
function syncControls() {
  byId('overviewPanel').hidden = state.view !== 'overview';
  byId('logsPanel').hidden = state.view !== 'logs';
  document.title = 'Vimage · ' + (state.view === 'overview' ? '运行概览' : '请求日志');
  document.querySelectorAll('[data-view]').forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-log-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.logType === state.type)));
  for (const [name, id] of Object.entries(filterControls)) byId(id).value = state[name];
  byId('statusFilter').disabled = byId('sourceFilter').disabled = state.type === 'error';
  byId('showPreviews').disabled = state.type === 'error';
  byId('pageSize').value = String(state.limit);
  renderFilterChips();
  updateRefreshMode();
}

function renderFilterChips() {
  const chips = byId('activeFilters');
  chips.replaceChildren();
  for (const [name, id] of Object.entries(filterControls)) {
    if (state[name] === defaults[name]) continue;
    const control = byId(id);
    const label = name === 'q' ? '搜索：' + state.q : control.selectedOptions[0].textContent;
    const chip = createElement('button', 'filter-chip', label + ' ×');
    chip.type = 'button';
    chip.setAttribute('aria-label', '移除筛选：' + label);
    chip.addEventListener('click', () => {
      state[name] = defaults[name];
      state.page = 1;
      syncControls();
      saveLocation();
      loadData();
    });
    chips.append(chip);
  }
}

function resetFilters() {
  for (const name of Object.keys(filterControls)) state[name] = defaults[name];
  state.page = 1;
  syncControls();
  saveLocation();
  loadData();
}

function renderPagination() {
  byId('pageInfo').textContent = state.totalPages ? state.page + ' / ' + state.totalPages + ' 页' : '暂无记录';
  byId('previousButton').disabled = state.loading || state.page <= 1;
  byId('nextButton').disabled = state.loading || state.page >= state.totalPages;
  byId('pageInput').value = String(state.page);
  byId('pageInput').max = String(Math.max(1, state.totalPages));
  byId('pageInput').disabled = state.loading || !state.totalPages;
  byId('pageForm').querySelector('button').disabled = state.loading || !state.totalPages;
}

function autoRefreshAllowed() {
  return !state.loading && !document.hidden && !byId('detailDialog').open
    && !byId('filterForm').contains(document.activeElement)
    && !byId('logsFrame').contains(document.activeElement)
    && !window.getSelection()?.toString() && (state.view === 'overview' || state.page === 1);
}
function updateRefreshMode() {
  byId('refreshMode').textContent = !byId('autoRefresh').checked ? '自动刷新已关闭' : autoRefreshAllowed() ? '每 30 秒更新 · 查看详情时暂停' : '自动刷新暂缓 · 当前查看内容保持不变';
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (response.status === 401) {
    if (!state.redirecting) {
      state.redirecting = true;
      window.location.assign('/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search));
    }
    throw new Error('登录已过期，正在前往登录页');
  }
  if (!response.ok) throw new Error('请求失败（HTTP ' + response.status + '），请点击刷新重试。');
  return response.json();
}

async function loadData() {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const requestId = ++state.requestId;
  state.loading = true;
  byId('refreshButton').disabled = true;
  byId('refreshButton').textContent = '刷新中…';
  byId('logsFrame').setAttribute('aria-busy', 'true');
  renderPagination();
  const params = new URLSearchParams();
  for (const name of ['type', 'page', 'limit', 'q', 'range', 'status', 'source', 'sort']) params.set(name, String(state[name]));
  const wantsLogs = state.view === 'logs';
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const requests = [fetchJson('/api/stats', controller.signal)];
    if (wantsLogs) requests.push(fetchJson('/api/logs?' + params, controller.signal));
    const [statsResult, logsResult] = await Promise.allSettled(requests);
    if (requestId !== state.requestId) return;
    let failed = false;
    byId('statsError').hidden = statsResult.status === 'fulfilled';
    if (statsResult.status === 'fulfilled') renderStats(statsResult.value);
    else {
      failed = true;
      byId('statsError').textContent = '统计更新失败，已展示的指标可能过期。请点击「刷新数据」重试。';
    }
    if (logsResult?.status === 'fulfilled') {
      const logs = logsResult.value;
      state.total = Number(logs.total || 0);
      state.totalPages = Number(logs.totalPages || 0);
      if (state.totalPages && state.page > state.totalPages) {
        state.page = state.totalPages;
        saveLocation(true);
        return loadData();
      }
      if (!state.totalPages) { state.page = 1; saveLocation(true); }
      state.logs = logs.data;
      renderLogs();
      const first = state.total ? (state.page - 1) * state.limit + 1 : 0;
      byId('logsSummary').textContent = '共 ' + formatNumber(state.total) + ' 条' + (hasFilters() ? '筛选结果' : '日志') + ' · 当前 ' + first + '–' + Math.min(state.page * state.limit, state.total) + ' 条';
    } else if (logsResult) {
      failed = true;
      state.logs = [];
      state.total = state.totalPages = 0;
      byId('logsSummary').textContent = '日志加载失败';
      showLogState('暂时无法加载日志', controller.signal.aborted ? '请求超时，请检查服务后重试。' : logsResult.reason.message, loadData, '重新加载');
    }
    byId('serviceState').textContent = failed ? '部分数据未更新' : '连接正常';
    byId('serviceState').className = 'service-state ' + (failed ? 'error' : 'ready');
    const time = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    byId('lastUpdated').textContent = (failed ? '最近尝试 ' : '最后更新 ') + time;
    byId('liveStatus').textContent = failed ? '部分数据更新失败，可点击刷新重试' : '数据已更新';
  } finally {
    window.clearTimeout(timeout);
    if (requestId === state.requestId) {
      state.loading = false;
      byId('refreshButton').disabled = false;
      byId('refreshButton').textContent = '刷新数据';
      byId('logsFrame').setAttribute('aria-busy', 'false');
      renderPagination();
      updateRefreshMode();
    }
  }
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  syncControls();
  saveLocation();
  loadData();
}));
document.querySelectorAll('[data-drill]').forEach(button => button.addEventListener('click', () => drillInto(button.dataset.drill)));
document.querySelectorAll('[data-log-type]').forEach(button => button.addEventListener('click', () => {
  state.type = button.dataset.logType;
  state.source = state.status = 'all';
  state.page = 1;
  syncControls();
  saveLocation();
  loadData();
}));
byId('filterForm').addEventListener('submit', event => {
  event.preventDefault();
  for (const [name, id] of Object.entries(filterControls)) state[name] = byId(id).value.trim();
  state.page = 1;
  syncControls();
  saveLocation();
  loadData();
});
byId('sortFilter').addEventListener('change', () => {
  state.sort = byId('sortFilter').value;
  state.page = 1;
  renderFilterChips();
  saveLocation();
  loadData();
});
byId('pageSize').addEventListener('change', () => {
  state.limit = Number(byId('pageSize').value);
  state.page = 1;
  saveLocation();
  loadData();
});
async function changePage(page) {
  if (state.loading || !Number.isSafeInteger(page) || page < 1 || page > state.totalPages) return;
  state.page = page;
  saveLocation();
  await loadData();
  byId('logsSummary').scrollIntoView({ block: 'start' });
}
byId('previousButton').addEventListener('click', () => changePage(state.page - 1));
byId('nextButton').addEventListener('click', () => changePage(state.page + 1));
byId('pageForm').addEventListener('submit', event => { event.preventDefault(); changePage(Number(byId('pageInput').value)); });
byId('refreshButton').addEventListener('click', loadData);
byId('resetFilters').addEventListener('click', resetFilters);
byId('showPreviews').addEventListener('change', renderLogs);
byId('autoRefresh').addEventListener('change', updateRefreshMode);
byId('closeDetail').addEventListener('click', () => byId('detailDialog').close());
byId('detailDialog').addEventListener('close', updateRefreshMode);
byId('copyDetail').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.selectedLog, null, 2));
    byId('detailFeedback').textContent = '已复制，可直接粘贴排查';
  } catch {
    byId('detailContent').querySelector('details').open = true;
    byId('detailFeedback').textContent = '浏览器不允许自动复制，请手动选择原始 JSON。';
  }
});
window.addEventListener('popstate', () => { readLocation(); syncControls(); loadData(); });
document.addEventListener('focusin', updateRefreshMode);
document.addEventListener('focusout', () => window.setTimeout(updateRefreshMode, 0));
document.addEventListener('visibilitychange', updateRefreshMode);
readLocation();
syncControls();
loadData();
window.setInterval(() => {
  updateRefreshMode();
  if (byId('autoRefresh').checked && autoRefreshAllowed()) loadData();
}, 30000);
