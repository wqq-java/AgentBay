// 主区:根据当前选中决定显示什么
//  - 选了 topic → 显示消息流 + 发送框
//  - 选了 group → 显示 topic 列表 + 新建 topic + 给 group 加 agent
//  - 选了 agent → 显示 agent 详情 + 发文本到 pane
//  - 都没选 → 空态指引

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/state.js';
import {
  createTopic, sendKeystrokes, addAgentToGroup, createGroup,
  renameAgent as apiRenameAgent, fetchMessages,
  spawnAgent, killAgent,
  listWorkerProfiles, createWorkerProfile, deleteWorkerProfile,
  fetchConfig,
  type AppConfig,
} from '../api/client.js';
import type { Agent, Topic, Message, WorkerProfile } from '@agent-bay/shared';

export function MainArea() {
  const selectedAgentId = useAppStore(s => s.selectedAgentId);
  const selectedGroupId = useAppStore(s => s.selectedGroupId);
  const selectedTopicId = useAppStore(s => s.selectedTopicId);
  const view = useAppStore(s => s.view);

  if (view === 'workers') return <WorkerProfilesView />;
  if (selectedTopicId) return <TopicView topicId={selectedTopicId} />;
  if (selectedGroupId) return <GroupView groupId={selectedGroupId} />;
  if (selectedAgentId) return <AgentView agentId={selectedAgentId} />;
  return <EmptyView />;
}

// ──────────────────────────────────────────────────────
// 共用:模板 + 键位按钮

const TEMPLATES = [
  { label: '/clear', text: '/clear' },
  { label: '/compact', text: '/compact' },
  { label: '/help', text: '/help' },
  { label: '继续', text: '继续' },
  { label: 'Ctrl-C 一次', text: '', sendKey: 'C-c' },
  { label: 'ESC', text: '', sendKey: 'Escape' },
];

const KEY_BUTTONS: Array<{ label: string; key: string }> = [
  { label: 'Enter', key: 'Enter' },
  { label: 'Esc', key: 'Escape' },
  { label: 'Ctrl-C', key: 'C-c' },
  { label: 'Ctrl-D', key: 'C-d' },
  { label: 'Tab', key: 'Tab' },
  { label: '↑', key: 'Up' },
  { label: '↓', key: 'Down' },
];

async function sendRawKey(agentId: string, key: string) {
  // /api/send 只送字符,key 通过把 text='' enter=true 模拟 Enter;其他键暂用文本拼
  // 实际想要专门的"按键 endpoint"在 M3.5 加;此处仅 Enter 通过 enter:true 走
  if (key === 'Enter') {
    await sendKeystrokes(agentId, '', true);
    return;
  }
  // 其他键 daemon 暂不支持;先 alert 提示用户(M3.5 后端会加 /api/send-key)
  throw new Error(`按键 "${key}" 暂未在后端支持(M3.5 加,目前只支持 Enter)`);
}

// ──────────────────────────────────────────────────────

function EmptyView() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doCreate() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try { await createGroup(name.trim()); setName(''); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="empty-view">
      <h2>欢迎</h2>
      <p>左侧选一个 group / agent / topic 开始,或先创建一个 group:</p>
      <div className="row">
        <input
          className="input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="group 名(如 team-aimeter)"
          disabled={busy}
        />
        <button className="btn" onClick={doCreate} disabled={busy || !name.trim()}>新建 Group</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────

function AgentView({ agentId }: { agentId: string }) {
  const agent = useAppStore(s => s.agents[agentId]);
  const groups = useAppStore(s => s.groups);
  const selectAgent = useAppStore(s => s.selectAgent);
  const [text, setText] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [enter, setEnter] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!agent) return <div className="empty-view">Agent 不在或已下线</div>;

  async function send() {
    setErr(null);
    try { await sendKeystrokes(agent.id, text, enter); setText(''); }
    catch (e) { setErr((e as Error).message); }
  }

  async function applyTemplate(t: typeof TEMPLATES[number]) {
    setErr(null);
    try {
      if (t.sendKey) {
        await sendRawKey(agent.id, t.sendKey);
      } else {
        await sendKeystrokes(agent.id, t.text, true); // 模板默认带回车
      }
    } catch (e) { setErr((e as Error).message); }
  }

  async function pressKey(key: string) {
    setErr(null);
    try { await sendRawKey(agent.id, key); }
    catch (e) { setErr((e as Error).message); }
  }

  async function rename() {
    if (!newName.trim()) return;
    try { await apiRenameAgent(agent.id, newName.trim()); setRenaming(false); }
    catch (e) { setErr((e as Error).message); }
  }

  async function assignToGroup(gid: string) {
    try { await addAgentToGroup(gid, agent.id); }
    catch (e) { setErr((e as Error).message); }
  }

  async function doKill() {
    if (!confirm(`确认杀掉 agent ${agent.name}?(只能杀 spawn 出来的)`)) return;
    try {
      await killAgent(agent.id);
      selectAgent(null);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="main-pad">
      <div className="card">
        <div className="card-head">
          <span className={`agent-dot agent-dot-${agent.status}`} />
          {renaming ? (
            <>
              <input className="input inline" value={newName} onChange={e => setNewName(e.target.value)} />
              <button className="btn small" onClick={rename}>保存</button>
              <button className="btn small ghost" onClick={() => setRenaming(false)}>取消</button>
            </>
          ) : (
            <>
              <h2 className="card-title">{agent.name}</h2>
              {agent.isSpawned && <span className="badge spawned">SPAWNED</span>}
              <button className="btn small ghost" onClick={() => { setRenaming(true); setNewName(agent.name); }}>改名</button>
              {agent.isSpawned && agent.status !== 'gone' && (
                <button className="btn small danger" onClick={doKill}>杀掉</button>
              )}
            </>
          )}
        </div>
        <dl className="kv">
          <dt>tool</dt><dd>{agent.tool}</dd>
          <dt>status</dt><dd>{agent.status}</dd>
          <dt>tmux</dt><dd><code>{agent.tmuxTarget}</code> (pid {agent.pid ?? '?'})</dd>
          <dt>group</dt><dd>
            {agent.groupId ? (groups[agent.groupId]?.name ?? agent.groupId) : <em>未分配</em>}
          </dd>
        </dl>

        {!agent.groupId && Object.values(groups).filter(g => !g.isDm).length > 0 && (
          <div className="row wrap">
            <span className="muted">加入 group:</span>
            {Object.values(groups).filter(g => !g.isDm).map(g => (
              <button key={g.id} className="btn small" onClick={() => assignToGroup(g.id)}>{g.name}</button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>发文本到 pane</h3>
        <p className="muted small">默认不送回车——agent 看得到但不会立刻执行。勾上"含回车"会触发 submit。</p>
        <textarea
          className="textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="发给 pane 的文本…"
          rows={4}
        />
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={enter} onChange={e => setEnter(e.target.checked)} />
            含回车(送 Enter)
          </label>
          <button className="btn primary" onClick={send} disabled={!text || agent.status === 'gone'}>发送</button>
        </div>

        <div className="row wrap" style={{ marginTop: 12 }}>
          <span className="muted">快捷键:</span>
          {KEY_BUTTONS.map(k => (
            <button
              key={k.key}
              className="btn small"
              onClick={() => pressKey(k.key)}
              disabled={agent.status === 'gone' || k.key !== 'Enter'}
              title={k.key === 'Enter' ? '送回车' : 'M3.5 加'}
            >{k.label}</button>
          ))}
        </div>

        <div className="row wrap" style={{ marginTop: 8 }}>
          <span className="muted">模板:</span>
          {TEMPLATES.map(t => (
            <button
              key={t.label}
              className="btn small"
              onClick={() => applyTemplate(t)}
              disabled={agent.status === 'gone' || (!!t.sendKey && t.sendKey !== 'Enter')}
              title={t.sendKey ? `按键 ${t.sendKey}(M3.5 加)` : `输入 ${t.text} + 回车`}
            >{t.label}</button>
          ))}
        </div>
        {err && <div className="err">{err}</div>}
      </div>
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
  const messages = useAppStore(s => s.messagesByTopic[topicId] ?? []);
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
