// 主区:根据当前选中决定显示什么
//  - 选了 topic → 显示消息流 + 发送框
//  - 选了 group → 显示 topic 列表 + 新建 topic + 给 group 加 agent
//  - 选了 agent → 显示 agent 详情 + 发文本到 pane
//  - 都没选 → 空态指引

import { useEffect, useState } from 'react';
import { useAppStore } from '../store/state.js';
import {
  createTopic, sendKeystrokes, addAgentToGroup, createGroup,
  renameAgent as apiRenameAgent, fetchMessages,
} from '../api/client.js';
import type { Agent, Topic, Message } from '@agent-bay/shared';

export function MainArea() {
  const selectedAgentId = useAppStore(s => s.selectedAgentId);
  const selectedGroupId = useAppStore(s => s.selectedGroupId);
  const selectedTopicId = useAppStore(s => s.selectedTopicId);

  if (selectedTopicId) return <TopicView topicId={selectedTopicId} />;
  if (selectedGroupId) return <GroupView groupId={selectedGroupId} />;
  if (selectedAgentId) return <AgentView agentId={selectedAgentId} />;
  return <EmptyView />;
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

  async function rename() {
    if (!newName.trim()) return;
    try { await apiRenameAgent(agent.id, newName.trim()); setRenaming(false); }
    catch (e) { setErr((e as Error).message); }
  }

  async function assignToGroup(gid: string) {
    try { await addAgentToGroup(gid, agent.id); }
    catch (e) { setErr((e as Error).message); }
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
              <button className="btn small ghost" onClick={() => { setRenaming(true); setNewName(agent.name); }}>改名</button>
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

        {!agent.groupId && Object.values(groups).length > 0 && (
          <div className="row">
            <span className="muted">加入 group:</span>
            {Object.values(groups).map(g => (
              <button key={g.id} className="btn small" onClick={() => assignToGroup(g.id)}>{g.name}</button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>发文本到 pane</h3>
        <p className="muted small">输入后默认不送回车——agent 看得到但不会立刻执行。勾上"含回车"会触发 submit。</p>
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
        {err && <div className="err">{err}</div>}
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!topicId) return;
    setLoading(true);
    fetchMessages(topicId)
      .then(ms => setMessages(topicId, ms))
      .catch(e => console.warn('fetch messages', e))
      .finally(() => setLoading(false));
  }, [topicId, setMessages]);

  if (!topic) return <div className="empty-view">topic 不存在</div>;

  return (
    <div className="topic-view">
      <div className="topic-head">
        <h2>{topic.title}</h2>
        <span className={`badge state-${topic.state}`}>{topic.state}</span>
      </div>
      <div className="messages">
        {loading && <em className="muted">加载中…</em>}
        {!loading && messages.length === 0 && <em className="muted">还没消息</em>}
        {messages.map(m => (
          <MessageRow key={m.id} message={m} agentName={m.fromAgentId ? (agents[m.fromAgentId]?.name ?? m.fromAgentId) : 'human'} />
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message, agentName }: { message: Message; agentName: string }) {
  return (
    <div className="msg-row">
      <span className="msg-from">@{agentName}</span>
      <span className="msg-body">{message.body}</span>
      <span className="msg-ts">{new Date(message.ts).toLocaleTimeString()}</span>
    </div>
  );
}
