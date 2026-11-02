/**
 * Local, explainable source-text retrieval. No model, embedding, generated
 * answer, network request, or interpretation of the author's position.
 *
 * A result is a mention, not an endorsement. Different dates stay separate.
 */

// Deliberately small, explicit equivalences: not an industry taxonomy or a
// substitution between a company and its peers. Longer exact names win.
const TOPICS = [
  ['中国船舶', ['中国船舶']], ['中国重工', ['中国重工']],
  ['中船防务', ['中船防务']], ['水发燃气', ['水发燃气']],
  ['彤程新材', ['彤程新材']], ['赣锋锂业', ['赣锋锂业']],
  ['比亚迪', ['比亚迪']], ['南大光电', ['南大光电']],
  ['昆仑万维', ['昆仑万维']], ['华大基因', ['华大基因']],
  ['泓博医药', ['泓博医药']], ['贵州茅台', ['贵州茅台', '茅台']],
  ['宁德时代', ['宁德时代']], ['中际旭创', ['中际旭创']],
  ['新易盛', ['新易盛']], ['天孚通信', ['天孚通信']],
  ['科大讯飞', ['科大讯飞']], ['中科曙光', ['中科曙光']],
  ['寒武纪', ['寒武纪']], ['海光信息', ['海光信息']],
  ['人工智能', ['人工智能', '大模型', 'aigc', 'ai']],
  ['船舶', ['船舶', '造船']], ['半导体', ['半导体']],
  ['芯片', ['芯片']], ['光刻胶', ['光刻胶']],
  ['光刻机', ['光刻机']], ['算力', ['算力']],
  ['光模块', ['光模块']], ['创新药', ['创新药']],
  ['港股创新药', ['港股创新药']], ['机器人', ['机器人']],
  ['新能源车', ['新能源汽车', '新能源车', '电动车']],
  ['新能源', ['新能源']], ['锂电池', ['锂电池', '锂电']],
  ['锂矿', ['锂矿']], ['光伏', ['光伏']],
  ['风电', ['风电']], ['储能', ['储能']],
  ['核电', ['核电']], ['煤炭', ['煤炭']],
  ['石油', ['石油']], ['天然气', ['天然气']],
  ['军工', ['军工']], ['白酒', ['白酒']],
  ['医药', ['医药']], ['基因测序', ['基因测序']],
  ['房地产', ['房地产', '地产']], ['银行', ['银行']],
  ['券商', ['券商', '证券公司']], ['保险', ['保险']],
  ['黄金', ['黄金']], ['有色金属', ['有色金属']],
  ['消费', ['消费']], ['农业', ['农业']],
  ['港股', ['港股']], ['美股', ['美股']],
  ['a股', ['a股']], ['etf', ['etf']],
  ['估值', ['估值']], ['周期', ['周期']],
  ['分红', ['分红']], ['现金流', ['现金流']],
  ['业绩', ['业绩']], ['政策', ['政策']], ['风险', ['风险提示', '风险']],
];

// These words describe a question about the archive, not an investment subject.
// Removing them must not turn two separated fragments into a new company name.
const QUESTION_WORDS = [
  '我想知道', '我想了解', '想问一下', '能不能', '可不可以', '有没有', '是否有',
  '帮我查一下', '帮我找一下', '帮我看看', '帮我查', '帮我找', '查一下',
  '找一下', '问一下', '请问一下', '请问', '告诉我', '给我', '介绍一下', '讲讲',
  '梳理一下', '梳理下', '总结一下', '如何看待', '怎么看待', '有什么看法', '有什么观点',
  '是什么看法', '是什么观点', '怎么看', '怎么想', '怎么样', '看法',
  '什么时候', '哪些时候', '什么时间', '最早一次', '第一次', '首次', '何时', '最初', '开始',
  '曾经', '以前', '后来', '之前', '之后', '现在', '当时', '最早',
  '这些年', '过去五年', '这五年', '本周', '上周', '今年', '去年', '未来',
  '有哪些', '有什么', '哪几篇', '哪一篇', '哪篇', '相关的', '相关',
  '提到过', '谈到过', '说到过', '关注过', '分析过', '讨论过', '看过',
  '说过', '谈过', '提过', '讲过', '写过', '提及过', '提及', '提到', '谈到', '说到', '关注', '分析',
  '讨论', '文章里', '文章中', '历史文章', '历史记录', '文章', '原文', '历年', '总结',
  '公众号', '王曼巴', '作者', '老师', '观点变化', '投资逻辑', '观点',
  '态度', '判断', '逻辑', '看好', '看多', '看空', '谨慎', '中性',
  '股票', '个股', '行业', '板块', '主题', '方面', '一下', '一下子',
  '为什么', '什么', '如何', '多少', '情况', '你好', '您好', '谢谢',
].sort((a, b) => b.length - a.length);

// Only discard a single-character particle when it is an entire residual
// grammar fragment, never by deleting characters inside a noun/company name.
const GRAMMAR_PARTICLES = /^[的我你您他她对在是有和或了吗呢啊呀请及与]+$/;
const SUBJECT_PREFIX = /^(?:你对|您对|作者对|他对|她对|我想问|我想看|想看看|关于|有关|对于)/;

const normalize = (value) => value.normalize('NFKC').toLowerCase();
const asciiWord = (char) => Boolean(char && /[a-z0-9_]/i.test(char));

function exactPositions(haystack, needle) {
  const positions = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length;
    // "AI" is not the letters in "paid"; Chinese names can be substrings.
    if ((!/[a-z0-9_]/i.test(needle[0]) || !asciiWord(haystack[start - 1])) &&
        (!/[a-z0-9_]/i.test(needle.at(-1)) || !asciiWord(haystack[end]))) {
      positions.push(start);
    }
    from = start + Math.max(needle.length, 1);
  }
  return positions;
}

function queryPlan(query) {
  if (typeof query !== 'string') return null;
  let text = normalize(query.trim().slice(0, 500));
  if (!text || /<|>|javascript:|\b(?:__proto__|constructor|prototype)\b/i.test(text)) return null;
  // Only exact years, listed years and inclusive ranges are implemented. Do not
  // silently reinterpret "before/after 2024" as the single year 2024.
  if (/(?:19|20)\d{2}\s*年?\s*(?:及)?(?:以前|之前|以后|之后|以来|前|后)/.test(text)) return null;
  const years = new Set();
  let invalidYearRange = false;
  // Explicit ranges are inclusive. Separate listed years form a union; the
  // caller's year dropdown is intersected with this set below, never ignored.
  text = text.replace(/((?:19|20)\d{2})\s*年?\s*(?:-|—|–|至|到|~|～)\s*((?:19|20)\d{2})\s*年?/g, (_, from, to) => {
    if (+from > +to) invalidYearRange = true;
    for (let year = +from; year <= +to; year += 1) years.add(String(year));
    return ' ';
  });
  text = text.replace(/((?:19|20)\d{2})\s*年?/g, (_, year) => { years.add(year); return ' '; });
  if (invalidYearRange) return null;
  for (const word of QUESTION_WORDS) text = text.split(word).join(' ');
  text = text.replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ');
  const selected = [];
  const add = (term) => { if (!selected.some((item) => item.key === term.key)) selected.push(term); };
  for (let token of text.split(/\s+/)) {
    if (!token || /^\d+$/.test(token) || GRAMMAR_PARTICLES.test(token)) continue;
    // These are anchored multi-character question prefixes. Do not strip the
    // characters 有/和/我 from an unknown company's interior or beginning.
    token = token.replace(SUBJECT_PREFIX, '').replace(/(?:的|吗|呢|吧)$/, '');
    if (!token || GRAMMAR_PARTICLES.test(token)) continue;
    const candidates = [];
    for (const [key, aliases] of TOPICS) for (const alias of aliases) {
      for (const start of exactPositions(token, alias)) candidates.push({ key, aliases, start, end: start + alias.length });
    }
    candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const terms = [];
    const spans = [];
    for (const candidate of candidates) {
      if (spans.some(([start, end]) => candidate.start < end && candidate.end > start)) continue;
      spans.push([candidate.start, candidate.end]);
      terms.push(candidate);
    }
    const characters = token.split('');
    for (const [start, end] of spans) characters.fill(' ', start, end);
    const residue = characters.join('').split(/\s+/).filter(Boolean);
    if (terms.length && residue.every((fragment) => GRAMMAR_PARTICLES.test(fragment))) {
      for (const term of terms) add({ key: term.key, aliases: term.aliases });
    } else {
      // Preserve unknown modifiers as ONE literal subject: 国有银行 must not
      // degrade into 银行 plus a disconnected 国有 somewhere in the article.
      if (token.length < 2 || token.length > 40 || /^(.)\1+$/u.test(token)) continue;
      add({ key: token, aliases: [token] });
    }
  }
  return { terms: selected.slice(0, 12), years };
}

function hitsFor(text, term) {
  return term.aliases.flatMap((alias) => exactPositions(text, alias).map((start) => ({ start, length: alias.length })));
}

function excerptRanges(body, hits) {
  if (!body || !hits.length) return [];
  const sortedHits = [...hits].sort((a, b) => a.start - b.start);
  const ranges = [];
  // Preserve surrounding sentences (including caveats), rather than selecting
  // isolated positive words. Max 300 original UTF-16 characters per fragment.
  const sentenceBoundary = /[。！？!?\n]/;
  for (const hit of sortedHits) {
    if (ranges.some(([start, end]) => hit.start >= start && hit.start < end)) continue;
    let start = Math.max(0, hit.start - 105);
    let end = Math.min(body.length, hit.start + Math.max(hit.length, 1) + 180);
    const previousBoundary = body.slice(start, hit.start).search(/[。！？!?\n][^。！？!?\n]*$/);
    if (previousBoundary >= 0) start += previousBoundary + 1;
    const tailBoundary = body.slice(hit.start + hit.length, end).search(sentenceBoundary);
    if (tailBoundary >= 0) {
      const firstSentenceEnd = hit.start + hit.length + tailBoundary + 1;
      // Include the next sentence too when it may qualify the first sentence.
      const after = body.slice(firstSentenceEnd, end);
      const nextEnd = after.search(sentenceBoundary);
      if (nextEnd >= 0) end = firstSentenceEnd + nextEnd + 1;
    }
    end = Math.min(end, start + 300);
    while (start < end && /\s/.test(body[start])) start += 1;
    while (end > start && /\s/.test(body[end - 1])) end -= 1;
    if (start < end) ranges.push([start, end]);
    if (ranges.length === 2) break;
  }
  return ranges.map(([start, end]) => ({ text: body.slice(start, end) }));
}

function dateValue(value) {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? date : null;
}

/**
 * @param {Array<{id:string,title:string,date:string,dateSource:string,url:string,body:string,originality:string}>} articles
 * @param {string} query A literal subject or a short Chinese question.
 * @param {{year?:string|number,sort?:'relevance'|'dateAsc'|'dateDesc',limit?:number}} options
 * @returns {Array<{article:object,excerpts:Array<{text:string}>,score:number}>}
 */
export function searchArticles(articles, query, options = {}) {
  if (!Array.isArray(articles)) return [];
  const opts = options && typeof options === 'object' ? options : {};
  const plan = queryPlan(query);
  if (!plan?.terms.length) return [];
  const { terms, years } = plan;
  const year = opts.year == null ? 'all' : String(opts.year);
  if (year !== 'all' && !/^\d{4}$/.test(year)) return [];
  if (year !== 'all' && years.size && !years.has(year)) return [];
  const limit = Number.isFinite(opts.limit) ? Math.min(1000, Math.max(0, Math.floor(opts.limit))) : 6;
  if (!limit) return [];
  const sort = ['dateAsc', 'dateDesc'].includes(opts.sort) ? opts.sort : 'relevance';
  const seen = new Set();
  const results = [];
  for (const article of articles) {
    if (!article || typeof article !== 'object' || typeof article.body !== 'string') continue;
    if (year !== 'all' && !String(article.date || '').startsWith(`${year}-`)) continue;
    if (years.size && !years.has(String(article.date || '').slice(0, 4))) continue;
    const title = typeof article.title === 'string' ? article.title : '';
    const body = article.body;
    // Query compatibility forms are normalized above; source text is only case
    // folded here so hit offsets always refer to the untouched original body.
    const normalizedTitle = title.toLowerCase();
    const normalizedBody = body.toLowerCase();
    const matches = terms.map((term) => ({ title: hitsFor(normalizedTitle, term), body: hitsFor(normalizedBody, term) }));
    // All substantive query subjects must occur somewhere in the same article.
    if (!matches.every((match) => match.title.length || match.body.length)) continue;
    const key = article.id ? `id:${article.id}` : article.url ? `url:${article.url}` : `text:${article.date}\0${title}\0${body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let score = 0;
    for (const match of matches) score += Math.min(match.title.length, 3) * 12 + Math.min(match.body.length, 12) * 2;
    const sourceHits = matches.flatMap((match) => match.body);
    const excerpts = excerptRanges(body, sourceHits.length ? sourceHits : [{ start: 0, length: 1 }]);
    results.push({ article, excerpts, score });
  }
  return results.sort((a, b) => {
    const aDate = dateValue(a.article.date);
    const bDate = dateValue(b.article.date);
    if (sort !== 'relevance') {
      if (aDate === null && bDate !== null) return 1;
      if (bDate === null && aDate !== null) return -1;
      if (aDate !== bDate) return sort === 'dateAsc' ? aDate - bDate : bDate - aDate;
    }
    return b.score - a.score || (bDate ?? -Infinity) - (aDate ?? -Infinity) || String(a.article.id || '').localeCompare(String(b.article.id || ''));
  }).slice(0, limit);
}
