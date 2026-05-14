import { useEffect, useState } from 'react';
import {
  fetchTeamTemplates, createTeamApi, fetchProjects,
  type TeamTemplate, type ProjectEntry,
} from '../api/client.js';

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
            <ProjectPicker value={cwd} onChange={setCwd} disabled={busy} />
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

function ProjectPicker({ value, onChange, disabled }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [root, setRoot] = useState('');
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [editingRoot, setEditingRoot] = useState(false);
  const [draftRoot, setDraftRoot] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load(r?: string) {
    setLoading(true); setErr(null);
    try {
      const data = await fetchProjects(r);
      setRoot(data.root);
      setProjects(data.projects);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function applyRoot() {
    if (!draftRoot.trim()) return;
    void load(draftRoot.trim());
    setEditingRoot(false);
  }

  return (
    <div className="picker">
      <div className="picker-root-row">
        <span className="muted small">根目录:</span>
        {editingRoot ? (
          <>
            <input
              className="input inline"
              value={draftRoot}
              onChange={e => setDraftRoot(e.target.value)}
              placeholder="例:~/EOI 或 /Users/eoi/EOI"
              autoFocus
            />
            <button className="btn small" onClick={applyRoot}>切换</button>
            <button className="btn small ghost" onClick={() => setEditingRoot(false)}>取消</button>
          </>
        ) : (
          <>
            <code className="picker-root">{root || '(未设)'}</code>
            <button className="btn small ghost" onClick={() => { setDraftRoot(root); setEditingRoot(true); }} disabled={disabled}>改</button>
            <button className="btn small ghost" onClick={() => void load(root)} disabled={disabled}>刷新</button>
          </>
        )}
      </div>

      {err && (
        <div className="err" style={{ marginTop: 8 }}>
          {err}
          <div className="muted small" style={{ marginTop: 4 }}>
            没设过根?编辑 <code>~/.agent-bay/config.json</code> 加 <code>{`"projectRoots": ["~/EOI"]`}</code>,或上面"改"按钮临时切换。
          </div>
        </div>
      )}

      {loading && <div className="muted small" style={{ marginTop: 8 }}>列目录中…</div>}

      {!loading && projects.length > 0 && (
        <div className="project-grid">
          {projects.map(p => (
            <div
              key={p.path}
              className={`project-card ${value === p.path ? 'selected' : ''}`}
              onClick={() => !disabled && onChange(p.path)}
              title={p.path}
            >
              <div className="project-name">📁 {p.name}</div>
              <div className="project-markers">
                {p.markers.map(m => (
                  <span key={m} className="marker-chip">{m}</span>
                ))}
                {p.markers.length === 0 && <span className="muted small">— 普通目录</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <button className="btn small ghost" onClick={() => setShowManual(s => !s)} disabled={disabled}>
          {showManual ? '隐藏手动输入' : '或手动输入路径…'}
        </button>
        {showManual && (
          <input
            className="input"
            style={{ marginTop: 4 }}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="完整 cwd 路径"
            disabled={disabled}
          />
        )}
      </div>

      {value && (
        <div className="muted small" style={{ marginTop: 6 }}>
          ✅ 选中:<code>{value}</code>
        </div>
      )}
    </div>
  );
}
