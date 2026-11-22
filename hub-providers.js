'use strict';

// Community script providers for the Aether hub. Requests are made from the
// Electron main process so the renderer can keep connect-src 'none'.

const CACHE_TTL = 4 * 60 * 1000;
const CACHE_LIMIT = 160;
const REQUEST_TIMEOUT = 9000;
const MAX_RESPONSE = 4 * 1024 * 1024;
const MAX_CODE = 512 * 1024;

const cache = new Map();

const CATEGORY_RULES = [
  ['performance', /\b(fps|frame ?cap|lag|performance|optimis|optimiz|graphics|quality|shader)\b/i],
  ['visual', /\b(esp|visual|chams|tracer|fullbright|lighting|skin|skybox|viewmodel|highlight)\b/i],
  ['server', /\b(server|hop|rejoin|region|queue)\b/i],
  [
    'character',
    /\b(aimbot|silent ?aim|kill ?aura|combat|character|speed|jump|fly|noclip|god ?mode|melee|hitbox)\b/i,
  ],
];

function clip(value, max) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

function timestamp(value) {
  const result = Date.parse(String(value || ''));
  return Number.isFinite(result) ? result : 0;
}

function inferCategory(text) {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(text)) return category;
  }
  return 'utility';
}

function cleanTags(values) {
  const seen = new Set();
  const tags = [];

  for (const value of values) {
    const tag = clip(value, 24);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 8) break;
  }

  return tags;
}

function scriptUrl(base, slug) {
  return slug ? `${base}/script/${encodeURIComponent(String(slug))}` : base;
}

function absoluteUrl(base, value) {
  const text = String(value || '');
  if (!text) return '';
  try {
    return new URL(text, base).toString();
  } catch {
    return '';
  }
}

function friendlyError(error) {
  if (!error) return 'Request failed';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'Request timed out';

  const cause = error.cause && (error.cause.code || error.cause.message);
  const message = String(error.message || error);
  return clip(cause ? `${message} (${cause})` : message, 140) || 'Request failed';
}

function timeoutSignal() {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(REQUEST_TIMEOUT);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  timer.unref?.();
  return controller.signal;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Aether/1.0 (local script workspace)',
    },
    redirect: 'follow',
    signal: timeoutSignal(),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text || text.length > MAX_RESPONSE) {
    throw new Error('Unexpected response size');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Provider returned invalid JSON');
  }
}

function normaliseScriptBlox(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const title = clip(raw.title, 120);
  const code = typeof raw.script === 'string' ? raw.script.trim().slice(0, MAX_CODE) : '';
  if (!title || !code) return null;

  const universal = Boolean(raw.isUniversal);
  const game = clip(raw.game && raw.game.name ? raw.game.name : universal ? 'Universal' : 'Unknown game', 80);
  const owner =
    raw.owner && typeof raw.owner === 'object'
      ? raw.owner.username || raw.owner.name
      : raw.owner;
  const author = clip(owner || (raw.creator && raw.creator.username) || '', 60);
  const description = clip(raw.description, 240);
  const tags = cleanTags([
    ...(Array.isArray(raw.tags) ? raw.tags : []),
    universal ? 'Universal' : '',
    raw.key === false || raw.keyless === true ? 'Keyless' : raw.key === true ? 'Key' : '',
    raw.verified ? 'Verified' : '',
    raw.isPatched ? 'Patched' : '',
    raw.isHub ? 'Hub' : '',
  ]);

  const category = inferCategory(`${title} ${game} ${description} ${tags.join(' ')}`);
  const type = raw.scriptType === 'paid' ? 'Paid' : 'Free';

  return {
    id: `scriptblox:${raw._id || raw.slug || title}`,
    source: 'scriptblox',
    provider: 'scriptblox',
    providerLabel: 'ScriptBlox',
    title,
    blurb: description || `${game} · ${type} script${author ? ` by ${author}` : ''}.`,
    code,
    category,
    tags,
    game,
    author,
    verified: Boolean(raw.verified),
    keyless: raw.key === false || raw.keyless === true,
    patched: Boolean(raw.isPatched),
    views: number(raw.views || raw.executes),
    likes: number(raw.likeCount),
    updatedAt: timestamp(raw.lastUpdate || raw.updatedAt || raw.createdAt),
    createdAt: timestamp(raw.createdAt),
    url: scriptUrl('https://scriptblox.com', raw.slug),
    image: absoluteUrl('https://scriptblox.com', raw.image),
  };
}

function normaliseRobloxScripts(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const title = clip(raw.title, 120);
  const code = typeof raw.script === 'string' ? raw.script.trim().slice(0, MAX_CODE) : '';
  if (!title || !code) return null;

  const games = Array.isArray(raw.games) ? raw.games : [];
  const universal = Boolean(raw.isUniversal);
  const game = clip(
    raw.game && raw.game.name
      ? raw.game.name
      : universal
        ? 'Universal'
        : games.length
          ? `${games.length} games`
          : 'Unknown game',
    80,
  );
  const author = clip(raw.author && raw.author.username, 60);
  const verified = Boolean(raw.author && raw.author.verified);
  const description = clip(raw.description, 240);
  const tags = cleanTags([
    ...(Array.isArray(raw.tags) ? raw.tags : []),
    universal ? 'Universal' : '',
    raw.key === false ? 'Keyless' : raw.key === true ? 'Key' : '',
    verified ? 'Verified' : '',
    raw.isHub ? 'Hub' : '',
  ]);

  const category = inferCategory(`${title} ${game} ${description} ${tags.join(' ')}`);

  return {
    id: `robloxscripts:${raw.id || raw.slug || title}`,
    source: 'robloxscripts',
    provider: 'robloxscripts',
    providerLabel: 'RobloxScripts',
    title,
    blurb:
      description ||
      `${game}${raw.accessType === 'paid' ? ' · Paid script' : ''}${author ? ` by ${author}` : ''}.`,
    code,
    category,
    tags,
    game,
    author,
    verified,
    keyless: raw.key === false,
    patched: false,
    views: number(raw.views || raw.executions),
    likes: number(raw.likes),
    updatedAt: timestamp(raw.updatedAt || raw.createdAt),
    createdAt: timestamp(raw.createdAt),
    url: raw.scriptPageUrl || scriptUrl('https://robloxscripts.com', raw.slug),
    image: absoluteUrl('https://robloxscripts.com', raw.image || (raw.game && raw.game.iconUrl)),
  };
}

const PROVIDERS = {
  scriptblox: {
    label: 'ScriptBlox',
    async fetch(query, page) {
      const url = new URL(
        query ? 'https://scriptblox.com/api/script/search' : 'https://scriptblox.com/api/script/fetch',
      );
      url.searchParams.set('page', String(page));
      url.searchParams.set('max', '12');
      url.searchParams.set('patched', '0');
      if (query) {
        url.searchParams.set('q', query);
      } else {
        url.searchParams.set('sortBy', 'updatedAt');
        url.searchParams.set('order', 'desc');
      }

      const body = await getJson(url);
      const result = body && typeof body === 'object' ? body.result : null;
      if (!result || !Array.isArray(result.scripts)) {
        throw new Error((body && body.message) || 'Unexpected ScriptBlox response');
      }

      const items = result.scripts.map(normaliseScriptBlox).filter(Boolean);
      const totalPages = Math.max(1, Number(result.totalPages) || page);
      const nextPage = Number(result.nextPage) || (page < totalPages ? page + 1 : 0);

      return {
        items,
        page,
        hasMore: Boolean(nextPage && nextPage > page),
        total: totalPages,
      };
    },
  },

  robloxscripts: {
    label: 'RobloxScripts',
    async fetch(query, page) {
      const url = new URL('https://robloxscripts.com/api/v1/scripts');
      url.searchParams.set('page', String(page));
      url.searchParams.set('limit', '12');
      if (query) url.searchParams.set('q', query);

      const body = await getJson(url);
      if (!body || !Array.isArray(body.data)) {
        throw new Error('Unexpected RobloxScripts response');
      }

      const items = body.data.map(normaliseRobloxScripts).filter(Boolean);
      const pagination = body.pagination && typeof body.pagination === 'object' ? body.pagination : {};
      const pages = number(pagination.pages);

      return {
        items,
        page,
        hasMore:
          typeof pagination.hasMore === 'boolean'
            ? pagination.hasMore
            : pages
              ? page < pages
              : items.length > 0,
        total: number(pagination.total),
      };
    },
  },
};

function remember(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

async function fetchHub(providerId, options = {}) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    return {
      ok: false,
      provider: String(providerId || ''),
      label: 'Unknown',
      items: [],
      page: 1,
      hasMore: false,
      error: 'Unknown provider',
    };
  }

  const query = clip(options.query, 80);
  const page = Math.max(1, Math.min(50, Math.round(Number(options.page) || 1)));
  const key = `${providerId}:${query.toLowerCase()}:${page}`;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return {
      ok: true,
      provider: providerId,
      label: provider.label,
      ...cached.value,
      cached: true,
    };
  }

  try {
    const value = await provider.fetch(query, page);
    remember(key, value);
    return {
      ok: true,
      provider: providerId,
      label: provider.label,
      ...value,
      cached: false,
    };
  } catch (error) {
    if (cached) {
      return {
        ok: true,
        provider: providerId,
        label: provider.label,
        ...cached.value,
        cached: true,
        stale: true,
        error: friendlyError(error),
      };
    }

    return {
      ok: false,
      provider: providerId,
      label: provider.label,
      items: [],
      page,
      hasMore: false,
      error: friendlyError(error),
    };
  }
}

module.exports = { fetchHub };
