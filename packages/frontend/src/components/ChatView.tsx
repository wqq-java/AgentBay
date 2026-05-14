// 浏览器对话界面 —— 用户主用法。
// 显示 agent 的完整对话(从 jsonl 解析),气泡式;输入框发消息(走 send-keys + Enter)。

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/state.js';
import { fetchChatMessages, sendChatMessage } from '../api/client.js';
import type { ChatMessage, ContentBlock } from '@agent-bay/shared';

export function ChatView({ agentId }: { agentId: string }) {
  const agent = useAppStore(s => s.agents[agentId]);
  const messages = useAppStore(s => s.chatByAgent[agentId] ?? []);
  const setChatMessages = useAppStore(s => s.setChatMessages);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true); setErr(null);
    fetchChatMessages(agentId)
      .then(ms => setChatMessages(agentId, ms))
      .catch(e => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [agentId, setChatMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!agent) return <div className="empty-view">Agent 不在</div>;

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true); setErr(null);
    try {
      await sendChatMessage(agentId, text);
      setText('');
      // jsonl 增量会通过 SSE chat-message 推到 store,UI 自动滚到最新
    } catch (e) { setErr((e as Error).message); }
    finally { setSending(false); }
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl + Enter 发送;裸 Enter 换行
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  // 把 tool_use 跟它对应的 tool_result 配成一对(便于一起渲染)
  const toolResultsByUseId = new Map<string, ContentBlock & { type: 'tool_result' }>();
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.type === 'tool_result') toolResultsByUseId.set(b.tool_use_id, b);
    }
  }

  // 渲染消息列表(过滤掉 tool_result_synthetic,因为已嵌入 assistant)
  const visible = messages.filter(m => m.role !== 'tool_result_synthetic');

  return (
    <div className="chat-view">
      <div className="chat-head">
        <div className="chat-head-left">
          <span className={`agent-dot agent-dot-${agent.status}`} />
          <h2 className="chat-title">{agent.name}</h2>
          <span className="muted small"> · {agent.tool} · {agent.status}</span>
        </div>
      </div>

      <div className="chat-messages">
        {loading && <div className="muted">加载历史…</div>}
        {!loading && visible.length === 0 && (
          <div className="empty-view" style={{ padding: 40 }}>
            <p className="muted">还没消息。在下面输入框对 Claude 说点什么:</p>
          </div>
        )}
        {visible.map(m => (
          <ChatBubble key={m.id} message={m} toolResults={toolResultsByUseId} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="chat-input-bar">
        <textarea
          className="textarea chat-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder="对 Claude 说…  (⌘/Ctrl + Enter 发送,裸 Enter 换行)"
          rows={3}
          disabled={agent.status === 'gone' || sending}
        />
        <button
          className="btn primary"
          onClick={send}
          disabled={!text.trim() || agent.status === 'gone' || sending}
        >
          {sending ? '发送…' : '发送'}
        </button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function ChatBubble({ message, toolResults }: {
  message: ChatMessage;
  toolResults: Map<string, ContentBlock & { type: 'tool_result' }>;
}) {
  const { role, blocks } = message;
  const isUser = role === 'user';
  const sideClass = isUser ? 'user' : role === 'assistant' ? 'assistant' : 'system';

  return (
    <div className={`chat-bubble chat-bubble-${sideClass} ${message.isSidechain ? 'sidechain' : ''}`}>
      <div className="chat-bubble-role">
        {isUser ? '你' : role === 'assistant' ? 'Claude' : role === 'system' ? '系统' : ''}
        {message.isSidechain && <span className="muted small"> · sidechain</span>}
        <span className="muted small chat-ts">{new Date(message.ts).toLocaleTimeString()}</span>
      </div>
      <div className="chat-bubble-body">
        {blocks.map((b, i) => (
          <BlockRender key={i} block={b} toolResults={toolResults} />
        ))}
      </div>
      {message.usage && (
        <div className="chat-usage muted small">
          tokens · in {message.usage.inputTokens ?? 0}
          + out {message.usage.outputTokens ?? 0}
          {message.usage.cacheReadTokens ? ` · cache ${message.usage.cacheReadTokens}` : ''}
        </div>
      )}
    </div>
  );
}

function BlockRender({ block, toolResults }: {
  block: ContentBlock;
  toolResults: Map<string, ContentBlock & { type: 'tool_result' }>;
}) {
  if (block.type === 'text') {
    return <div className="block-text">{block.text}</div>;
  }
  if (block.type === 'thinking') {
    return (
      <details className="block-thinking">
        <summary className="muted small">💭 thinking</summary>
        <pre className="thinking-content">{block.thinking}</pre>
      </details>
    );
  }
  if (block.type === 'tool_use') {
    const result = toolResults.get(block.id);
    return (
      <details className="block-tool" open={false}>
        <summary>
          <span className="tool-name">⚙ {block.name}</span>
          {result?.is_error && <span className="err-badge"> · error</span>}
        </summary>
        <div className="tool-input">
          <div className="muted small">input</div>
          <pre>{JSON.stringify(block.input, null, 2)}</pre>
        </div>
        {result && (
          <div className="tool-output">
            <div className="muted small">output</div>
            <pre>{result.content}</pre>
          </div>
        )}
      </details>
    );
  }
  if (block.type === 'tool_result') {
    // 不在这里渲染——已经嵌入对应 tool_use 块里
    return null;
  }
  return null;
}
