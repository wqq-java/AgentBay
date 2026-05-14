import { useEffect, useState } from 'react';
import { fetchTeamTemplates, createTeamApi, type TeamTemplate } from '../api/client.js';

export function NewTeamWizard({ onCreated, onCancel }: {
  onCreated: (groupId: string, firstAgentId: string | null) => void;
  onCancel: () => void;
}) {
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('fullstack');
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);

  useEffect(() => {
    fetchTeamTemplates().then(t => {
      setTemplates(t);
      if (t.length > 0) setSelectedId(t[0].id);
    }).catch(e => setErr((e as Error).message));
  }, []);

  const selected = templates.find(t => t.id === selectedId);

  async function submit() {
    if (!name.trim() || !cwd.trim() || !selected) return;
    setBusy(true); setErr(null); setProgress([`creating team "${name}" with template ${selected.name}…`]);
    try {
      setProgress(p => [...p, `spawning ${selected.members.length} agents in tmux…(可能要 ~30 秒)`]);
      const r = await createTeamApi({ name: name.trim(), cwd: cwd.trim(), template_id: selected.id });
      setProgress(p => [...p, `✅ ${r.agents.length} agents spawned`]);
      if (r.errors.length > 0) {
        setProgress(p => [...p, `⚠️ ${r.errors.length} errors:`, ...r.errors.map(e => `  - ${e.role}: ${e.error}`)]);
      }
      const firstMain = r.agents.find(a => a.role === 'main') ?? r.agents[0];
      onCreated(r.group.id, firstMain?.id ?? null);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="main-pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ flex: 1, margin: 0 }}>+ 新建团队</h2>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>取消</button>
      </div>

      <div className="card">
        <h3>选模板</h3>
        <div className="template-grid">
          {templates.map(t => (
            <div
              key={t.id}
              className={`template-card ${selectedId === t.id ? 'selected' : ''}`}
              onClick={() => !busy && setSelectedId(t.id)}
            >
              <div className="template-name">{t.name}</div>
              <div className="template-desc muted small">{t.description}</div>
              <div className="template-members">
                {t.members.map(m => (
                  <span key={m.role} className="member-chip">@{m.role}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>团队设置</h3>
        <dl className="kv form-kv">
          <dt>团队名</dt>
          <dd>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例:aimeter-feature-x"
              disabled={busy}
            />
            <div className="muted small">作为 group 名,不能跟现有冲突</div>
          </dd>
          <dt>工作目录</dt>
          <dd>
            <input
              className="input"
              value={cwd}
              onChange={e => setCwd(e.target.value)}
              placeholder="例:/Users/eoi/EOI/aimeter"
              disabled={busy}
            />
            <div className="muted small">所有 agent 起在这个 cwd;必须在 ~/.agent-bay/config.json 的 spawn.cwds 白名单里</div>
          </dd>
        </dl>

        {selected && (
          <div className="muted small" style={{ marginTop: 8 }}>
            将启动 <strong>{selected.members.length}</strong> 个 CC 进程:
            {selected.members.map(m => ` @${m.role}`).join(', ')}
          </div>
        )}
      </div>

      {progress.length > 0 && (
        <div className="card">
          <h3>进度</h3>
          {progress.map((p, i) => (
            <div key={i} className="progress-line">{p}</div>
          ))}
        </div>
      )}

      {err && <div className="err">{err}</div>}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn primary"
          onClick={submit}
          disabled={busy || !name.trim() || !cwd.trim() || !selected}
        >
          {busy ? '创建中…' : `🚀 启动 ${selected?.members.length ?? 0} 个 agent`}
        </button>
      </div>
    </div>
  );
}
