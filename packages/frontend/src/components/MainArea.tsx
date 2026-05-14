// 主区:根据当前选中决定显示什么
//  - 选了 topic → 显示消息流 + 发送框
//  - 选了 group → 显示 topic 列表 + 新建 topic + 给 group 加 agent
//  - 选了 agent → 显示 agent 详情 + 发文本到 pane
//  - 都没选 → 空态指引

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/state.js';
import {
  createTopic, fetchMessages,
  spawnAgent,
  listWorkerProfiles, createWorkerProfile, deleteWorkerProfile,
  fetchConfig,
  fetchMasterToken, fetchEscalations, testEscalate, resolveEscalationApi,
  type AppConfig, type Escalation,
} from '../api/client.js';
import { ChatView } from './ChatView.js';
import { NewTeamWizard } from './NewTeamWizard.js';
import type { Agent, Topic, Message, WorkerProfile } from '@agent-bay/shared';

// 模块级稳定引用,防止 Zustand selector 返回新 [] 触发 re-render 循环
const EMPTY_TOPIC_MSGS: Message[] = [];

export function MainArea() {
  const selectedAgentId = useAppStore(s => s.selectedAgentId);
  const selectedGroupId = useAppStore(s => s.selectedGroupId);
  const selectedTopicId = useAppStore(s => s.selectedTopicId);
  const view = useAppStore(s => s.view);
  const selectAgent = useAppStore(s => s.selectAgent);
  const setView = useAppStore(s => s.setView);

  if (view === 'newteam') {
    return <NewTeamWizard
      onCreated={(_groupId, firstAgentId) => {
        if (firstAgentId) selectAgent(firstAgentId);
        setView('main');
      }}
      onCancel={() => setView('main')}
    />;
  }
  if (view === 'workers') return <WorkerProfilesView />;
  if (view === 'master') return <MasterView />;
  // 主用法:选了 agent → ChatView(浏览器跟 Claude 聊)
  if (selectedAgentId) return <ChatView agentId={selectedAgentId} />;
  if (selectedTopicId) return <TopicView topicId={selectedTopicId} />;
  if (selectedGroupId) return <GroupView groupId={selectedGroupId} />;
  return <EmptyView />;
}

// ──────────────────────────────────────────────────────

function EmptyView() {
  const setView = useAppStore(s => s.setView);
  return (
    <div className="empty-view">
      <h2>欢迎来到 AgentBay</h2>
      <p>用浏览器跟 Claude(单独 / 一队)聊天 + 派活的工作站。</p>
      <p className="muted">从这里开始:</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
        <button className="btn primary" onClick={() => setView('newteam')}>+ 新建团队</button>
      </div>
      <p className="muted small" style={{ marginTop: 24 }}>
        左侧 sidebar 已有 agent 的话,点任何一个就能在浏览器里直接聊。
      </p>
    </div>
  );
}


// ──────────────────────────────────────────────────────
// M3:Worker profile 管理 + Spawn 对话框

function WorkerProfilesView() {
  const [profiles, setProfiles] = useState<WorkerProfile[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [spawningId, setSpawningId] = useState<string | null>(null);
  const groups = useAppStore(s => s.groups);
  const setView = useAppStore(s => s.setView);

  useEffect(() => {
    listWorkerProfiles().then(setProfiles).catch(e => setErr((e as Error).message));
    fetchConfig().then(setConfig).catch(() => { /* ignore */ });
  }, []);

  async function reloadProfiles() {
    setProfiles(await listWorkerProfiles());
  }

  async function spawnFromProfile(p: WorkerProfile) {
    setErr(null); setSpawningId(p.id);
    try {
      await spawnAgent({
        command: p.command,
        cwd: p.cwd,
        name: p.name,
        group_id: p.groupId,
        role: p.role,
      });
      // 成功后跳回主视图,新 agent 已在 sidebar
      setView('main');
    } catch (e) { setErr((e as Error).message); }
    finally { setSpawningId(null); }
  }

  async function delProfile(id: string) {
    if (!confirm('删除这个 profile?')) return;
    await deleteWorkerProfile(id);
    await reloadProfiles();
  }

  return (
    <div className="main-pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Worker Profiles</h2>
        <button className="btn ghost" onClick={() => setView('main')}>← 返回</button>
        <button className="btn primary" onClick={() => setCreating(true)}>+ 新 Profile</button>
      </div>

      {config && (
        <div className="card">
          <h3>当前 spawn 白名单(来自 ~/.agent-bay/config.json)</h3>
          <dl className="kv">
            <dt>commands</dt><dd>{config.spawn.commands.join(', ') || <em>(空——禁止 spawn)</em>}</dd>
            <dt>cwds</dt><dd>{config.spawn.cwds.length ? config.spawn.cwds.join(', ') : <em>(无限制)</em>}</dd>
            <dt>maxConcurrent</dt><dd>{config.spawn.maxConcurrent}</dd>
            <dt>tmux session</dt><dd><code>{config.defaultTmuxSession}</code></dd>
          </dl>
        </div>
      )}

      {err && <div className="err">{err}</div>}

      {profiles.length === 0 && !creating && <em className="muted">还没有 profile · 创建一个吧</em>}

      {profiles.map(p => (
        <div key={p.id} className="card">
          <div className="card-head">
            <h3 style={{ flex: 1, margin: 0 }}>{p.name}</h3>
            <button className="btn small primary" onClick={() => spawnFromProfile(p)} disabled={spawningId === p.id}>
              {spawningId === p.id ? 'Spawning…' : 'Spawn'}
            </button>
            <button className="btn small ghost" onClick={() => delProfile(p.id)}>删除</button>
          </div>
          <dl className="kv">
            <dt>command</dt><dd><code>{p.command}</code></dd>
            <dt>cwd</dt><dd><code>{p.cwd}</code></dd>
            {p.role && <><dt>role</dt><dd>{p.role}</dd></>}
            {p.groupId && <><dt>group</dt><dd>{groups[p.groupId]?.name ?? p.groupId}</dd></>}
            {p.description && <><dt>desc</dt><dd className="muted">{p.description}</dd></>}
          </dl>
        </div>
      ))}

      {creating && <NewProfileForm onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); reloadProfiles(); }} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// M4:Master 视图(token / escalations / 测试推送)

function MasterView() {
  const setView = useAppStore(s => s.setView);
  const [token, setToken] = useState<string | null>(null);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showTestForm, setShowTestForm] = useState(false);

  async function reload() {
    try {
      setToken(await fetchMasterToken());
      setEscalations(await fetchEscalations());
    } catch (e) { setErr((e as Error).message); }
  }

  useEffect(() => { reload(); }, []);

  async function copyToken() {
    if (!token) return;
    try { await navigator.clipboard.writeText(token); }
    catch { /* no clipboard */ }
  }

  async function resolve(id: number) {
    try { await resolveEscalationApi(id); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="main-pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Master 控制台</h2>
        <button className="btn ghost" onClick={() => setView('main')}>← 返回</button>
        <button className="btn ghost" onClick={reload}>刷新</button>
      </div>

      <div className="card">
        <h3>Master Token</h3>
        <p className="muted small">Master Agent 在 ~/.agent-bay/master-token 文件里能直接读;前端这里只做展示用。</p>
        <div className="row">
          <code className="token-display">{tokenVisible ? token : '••••••••••••••••••••••••••••••••'}</code>
          <button className="btn small" onClick={() => setTokenVisible(v => !v)}>
            {tokenVisible ? '隐藏' : '显示'}
          </button>
          <button className="btn small" onClick={copyToken} disabled={!token}>复制</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          升级通道(Escalations)
          <button className="btn small primary" onClick={() => setShowTestForm(v => !v)}>
            {showTestForm ? '取消' : '+ 测试推送'}
          </button>
        </h3>
        {showTestForm && <TestEscalateForm onSent={() => { setShowTestForm(false); reload(); }} />}
        {err && <div className="err">{err}</div>}
        {escalations.length === 0 && <em className="muted">还没有 escalation</em>}
        <div className="esc-list">
          {escalations.map(e => (
            <div key={e.id} className={`esc-row sev-${e.severity} ${e.resolved ? 'resolved' : ''}`}>
              <span className={`sev-badge sev-${e.severity}`}>{e.severity}</span>
              <span className="esc-msg">{e.message}</span>
              <span className="esc-ts">{new Date(e.ts).toLocaleString()}</span>
              {!e.resolved && (
                <button className="btn small" onClick={() => resolve(e.id)}>resolve</button>
              )}
              {e.resolved && <span className="muted small">✓ resolved</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>ntfy 推送</h3>
        <p className="muted small">
          ntfy 配置在 <code>~/.agent-bay/config.json</code> 的 <code>ntfy.{`{enabled,topicUrl}`}</code>。
          推荐自己取一个唯一的 topic 名,如 <code>https://ntfy.sh/agentbay-jacky-x7y2</code>(够长够私就行,topic 公开但难猜)。
          手机装 ntfy app 订阅同一 topic。
        </p>
      </div>
    </div>
  );
}

function TestEscalateForm({ onSent }: { onSent: () => void }) {
  const [severity, setSeverity] = useState<'info' | 'warn' | 'blocker'>('info');
  const [message, setMessage] = useState('test escalation from UI');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true); setErr(null);
    try { await testEscalate(severity, message); onSent(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="row" style={{ marginTop: 8, marginBottom: 12 }}>
      <select className="input" value={severity} onChange={e => setSeverity(e.target.value as 'info' | 'warn' | 'blocker')} style={{ flex: '0 0 auto' }}>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="blocker">blocker</option>
      </select>
      <input className="input" value={message} onChange={e => setMessage(e.target.value)} placeholder="message" />
      <button className="btn primary" onClick={send} disabled={busy || !message}>发送</button>
      {err && <div className="err" style={{ marginTop: 4, width: '100%' }}>{err}</div>}
    </div>
  );
}

function NewProfileForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const groups = useAppStore(s => s.groups);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('claude');
  const [cwd, setCwd] = useState('');
  const [role, setRole] = useState('');
  const [groupId, setGroupId] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    try {
      await createWorkerProfile({
        name: name.trim(),
        command: command.trim(),
        cwd: cwd.trim(),
        role: role.trim() || null,
        group_id: groupId || null,
      });
      onCreated();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h3>新 Worker Profile</h3>
      <dl className="kv form-kv">
        <dt>name</dt><dd><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="frontend-aimeter" /></dd>
        <dt>command</dt><dd><input className="input" value={command} onChange={e => setCommand(e.target.value)} placeholder="claude / codex" /></dd>
        <dt>cwd</dt><dd><input className="input" value={cwd} onChange={e => setCwd(e.target.value)} placeholder="/Users/eoi/EOI/aimeter" /></dd>
        <dt>role</dt><dd><input className="input" value={role} onChange={e => setRole(e.target.value)} placeholder="可选,如 frontend" /></dd>
        <dt>group</dt><dd>
          <select className="input" value={groupId} onChange={e => setGroupId(e.target.value)}>
            <option value="">(不分配)</option>
            {Object.values(groups).filter(g => !g.isDm).map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </dd>
      </dl>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button className="btn ghost" onClick={onCancel}>取消</button>
        <button className="btn primary" onClick={submit} disabled={!name.trim() || !command.trim() || !cwd.trim()}>创建</button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────

function GroupView({ groupId }: { groupId: string }) {
  const group = useAppStore(s => s.groups[groupId]);
  const agents = useAppStore(s => s.agents);
  const topics = useAppStore(s => s.topics);
  const selectAgent = useAppStore(s => s.selectAgent);
  const selectTopic = useAppStore(s => s.selectTopic);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (!group) return <div className="empty-view">group 不存在</div>;

  const memberAgents = Object.values(agents).filter(a => a.groupId === groupId && a.status !== 'gone');
  const groupTopics = Object.values(topics).filter(t => t.groupId === groupId).sort((a, b) => a.createdAt - b.createdAt);
  const openTopics = groupTopics.filter(t => t.state === 'open');
  const resolvedTopics = groupTopics.filter(t => t.state === 'resolved');

  async function newTopic() {
    if (!title.trim()) return;
    setErr(null);
    try { await createTopic(groupId, title.trim()); setTitle(''); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="main-pad">
      <h2>{group.name}</h2>
      {group.description && <p className="muted">{group.description}</p>}

      <div className="card">
        <h3>成员 ({memberAgents.length})</h3>
        <div className="row wrap">
          {memberAgents.length === 0 && <em className="muted">暂无成员。在 sidebar 选未分配 agent 加入。</em>}
          {memberAgents.map(a => (
            <AgentChip key={a.id} agent={a} onClick={() => selectAgent(a.id)} />
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Topics</h3>
        <div className="row">
          <input
            className="input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="新 topic 标题"
            onKeyDown={e => e.key === 'Enter' && newTopic()}
          />
          <button className="btn" onClick={newTopic} disabled={!title.trim()}>新建 Topic</button>
        </div>
        {err && <div className="err">{err}</div>}

        <div className="topic-list">
          {openTopics.length === 0 && resolvedTopics.length === 0 && <em className="muted">还没有 topic</em>}
          {openTopics.map(t => (
            <TopicRow key={t.id} topic={t} onClick={() => selectTopic(t.id)} />
          ))}
          {resolvedTopics.length > 0 && (
            <>
              <div className="topic-section-title">已 resolved ({resolvedTopics.length})</div>
              {resolvedTopics.map(t => (
                <TopicRow key={t.id} topic={t} onClick={() => selectTopic(t.id)} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentChip({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  return (
    <button className="agent-chip" onClick={onClick} title={agent.tmuxTarget}>
      <span className={`agent-dot agent-dot-${agent.status}`} /> {agent.name}
    </button>
  );
}

function TopicRow({ topic, onClick }: { topic: Topic; onClick: () => void }) {
  return (
    <div className={`topic-row ${topic.state}`} onClick={onClick}>
      <span className="topic-title">{topic.title}</span>
      <span className="topic-state">{topic.state === 'open' ? '○' : '✓'}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────

function TopicView({ topicId }: { topicId: string }) {
  const topic = useAppStore(s => s.topics[topicId]);
  const messages = useAppStore(s => s.messagesByTopic[topicId]) ?? EMPTY_TOPIC_MSGS;
  const agents = useAppStore(s => s.agents);
  const setMessages = useAppStore(s => s.setMessages);
  const applyEvent = useAppStore(s => s.applyEvent);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!topicId) return;
    setLoading(true);
    fetchMessages(topicId)
      .then(ms => setMessages(topicId, ms))
      .catch(e => console.warn('fetch messages', e))
      .finally(() => setLoading(false));
  }, [topicId, setMessages]);

  // 自动滚到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function toggleResolve() {
    if (!topic) return;
    try {
      if (topic.state === 'open') {
        const r = await fetch(`/api/topics/${encodeURIComponent(topic.id)}/resolve`, { method: 'POST' });
        if (!r.ok) throw new Error(`resolve ${r.status}`);
        const d = await r.json() as { topic: Topic };
        applyEvent({ type: 'topic-updated', topic: d.topic });
      }
    } catch (e) { setErr((e as Error).message); }
  }

  if (!topic) return <div className="empty-view">topic 不存在</div>;

  // 计算消息时间分组(按日期分隔)
  const grouped: Array<{ dateLabel: string; messages: Message[] }> = [];
  for (const m of messages) {
    const dateLabel = new Date(m.ts).toLocaleDateString();
    const last = grouped[grouped.length - 1];
    if (last && last.dateLabel === dateLabel) {
      last.messages.push(m);
    } else {
      grouped.push({ dateLabel, messages: [m] });
    }
  }

  return (
    <div className="topic-view">
      <div className="topic-head">
        <h2>{topic.title}</h2>
        <span className={`badge state-${topic.state}`}>{topic.state}</span>
        {topic.state === 'open' && (
          <button className="btn small" onClick={toggleResolve}>标记 resolved</button>
        )}
      </div>
      {err && <div className="err">{err}</div>}
      <div className="messages">
        {loading && <em className="muted">加载中…</em>}
        {!loading && messages.length === 0 && <em className="muted">还没消息</em>}
        {grouped.map((g, i) => (
          <div key={i} className="msg-group">
            <div className="msg-date-sep">{g.dateLabel}</div>
            {g.messages.map(m => (
              <MessageRow
                key={m.id}
                message={m}
                agentName={m.fromAgentId ? (agents[m.fromAgentId]?.name ?? m.fromAgentId) : 'human'}
              />
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function MessageRow({ message, agentName }: { message: Message; agentName: string }) {
  const isImage = message.kind === 'image' || !!message.imagePath;
  return (
    <div className="msg-row">
      <span className="msg-from">@{agentName}</span>
      <div className="msg-body-wrap">
        <span className="msg-body">{message.body}</span>
        {isImage && message.imagePath && (
          <div className="msg-image">
            <img src={`file://${message.imagePath}`} alt="" onError={e => (e.currentTarget.style.display = 'none')} />
            <div className="msg-image-path">{message.imagePath}</div>
          </div>
        )}
      </div>
      <span className="msg-ts">{new Date(message.ts).toLocaleTimeString()}</span>
    </div>
  );
}
