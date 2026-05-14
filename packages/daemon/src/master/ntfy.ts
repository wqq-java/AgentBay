// 把 escalation 推到 ntfy(https://ntfy.sh)。
// 配置:config.ntfy.{topicUrl, enabled}
// severity → ntfy priority 映射:
//   info    → 3 (default)
//   warn    → 4 (high — 振动)
//   blocker → 5 (max — 响铃)

import type { Severity } from './escalations.js';
import type { Config } from '../config/config.js';

const SEVERITY_PRIORITY: Record<Severity, string> = {
  info: '3',
  warn: '4',
  blocker: '5',
};

const SEVERITY_TAGS: Record<Severity, string> = {
  info: 'information_source',
  warn: 'warning',
  blocker: 'rotating_light',
};

export interface NtfyOpts {
  config: Config;
  severity: Severity;
  message: string;
  title?: string;
  click?: string;       // 点击通知打开的 URL
  /** fetch 注入(测试用) */
  fetchImpl?: typeof fetch;
}

export interface NtfyResult {
  ok: boolean;
  status: number;
  skipped?: boolean;
  reason?: string;
}

/**
 * 把消息 POST 到 ntfy 配置的 topicUrl。
 * 配置缺失或 disabled 时静默 skip(不抛错——通知失败不该阻止业务)。
 */
export async function pushNtfy(opts: NtfyOpts): Promise<NtfyResult> {
  const ntfy = opts.config.ntfy;
  if (!ntfy?.enabled) {
    return { ok: true, status: 0, skipped: true, reason: 'ntfy disabled in config' };
  }
  if (!ntfy.topicUrl) {
    return { ok: true, status: 0, skipped: true, reason: 'ntfy.topicUrl not set' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Priority': SEVERITY_PRIORITY[opts.severity],
    'Tags': SEVERITY_TAGS[opts.severity],
  };
  if (opts.title) headers.Title = encodeAsciiHeader(opts.title);
  if (opts.click) headers.Click = opts.click;

  const fetchFn = opts.fetchImpl ?? fetch;
  try {
    const r = await fetchFn(ntfy.topicUrl, {
      method: 'POST',
      headers,
      body: opts.message,
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message };
  }
}

/** ntfy header 不支持 UTF-8;非 ASCII 字符 fallback 成 '?' 防 fetch 报错 */
function encodeAsciiHeader(s: string): string {
  // ntfy 推荐做法:Title 字段限定 ASCII;UTF-8 内容应放 body
  return s.replace(/[^\x20-\x7E]/g, '?');
}
