// API client + SSE 订阅(替代 v1 的 WebSocket)。

import type { Snapshot, ServerEvent, Message, Agent, WorkerProfile } from '@agent-bay/shared';

export async function fetchSnapshot(): Promise<Snapshot> {
  const r = await fetch('/api/snapshot');
  if (!r.ok) throw new Error(`snapshot ${r.status}`);
  return await r.json() as Snapshot;
}

export async function fetchMessages(topicId: string, limit = 100): Promise<Message[]> {
  const r = await fetch(`/api/topics/${encodeURIComponent(topicId)}/messages?limit=${limit}`);
  if (!r.ok) throw new Error(`messages ${r.status}`);
  const d = await r.json() as { messages: Message[] };
  return d.messages;
}

export async function createGroup(name: string, description?: string): Promise<void> {
  const r = await fetch('/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!r.ok) {
    const d = await r.json() as { error?: string };
    throw new Error(d.error ?? `groups ${r.status}`);
  }
}

export async function addAgentToGroup(groupId: string, agentId: string): Promise<void> {
  const r = await fetch(`/api/groups/${encodeURIComponent(groupId)}/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (!r.ok) throw new Error(`add ${r.status}`);
}

export async function renameAgent(agentId: string, name: string): Promise<void> {
  const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}/name`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`rename ${r.status}`);
}

export async function createTopic(groupId: string, title: string): Promise<void> {
  const r = await fetch('/api/topics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ group_id: groupId, title }),
  });
  if (!r.ok) throw new Error(`topic ${r.status}`);
}

export async function sendKeystrokes(agentId: string, text: string, enter = false): Promise<void> {
  const r = await fetch('/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId, text, enter }),
  });
  if (!r.ok) {
    const d = await r.json() as { error?: string };
    throw new Error(d.error ?? `send ${r.status}`);
  }
}

// ── M3:调度 + worker profile ─────────────────────────

export interface SpawnArgs {
  command: string;
  cwd: string;
  name?: string;
  group_id?: string | null;
  role?: string | null;
}

export async function spawnAgent(args: SpawnArgs): Promise<Agent> {
  const r = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const d = await r.json() as { error?: string };
    throw new Error(d.error ?? `spawn ${r.status}`);
  }
  const d = await r.json() as { agent: Agent };
  return d.agent;
}

export async function killAgent(agentId: string, force = false): Promise<void> {
  const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}${force ? '?force=1' : ''}`, {
    method: 'DELETE',
  });
  if (!r.ok) {
    const d = await r.json() as { error?: string };
    throw new Error(d.error ?? `kill ${r.status}`);
  }
}

export async function listWorkerProfiles(): Promise<WorkerProfile[]> {
  const r = await fetch('/api/worker-profiles');
  if (!r.ok) throw new Error(`profiles ${r.status}`);
  const d = await r.json() as { profiles: WorkerProfile[] };
  return d.profiles;
}

export async function createWorkerProfile(args: {
  name: string; command: string; cwd: string; role?: string | null; group_id?: string | null;
}): Promise<WorkerProfile> {
  const r = await fetch('/api/worker-profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const d = await r.json() as { error?: string };
    throw new Error(d.error ?? `create profile ${r.status}`);
  }
  const d = await r.json() as { profile: WorkerProfile };
  return d.profile;
}

export async function deleteWorkerProfile(id: string): Promise<void> {
  await fetch(`/api/worker-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface AppConfig {
  spawn: { commands: string[]; cwds: string[]; maxConcurrent: number };
  defaultTmuxSession: string;
}

export async function fetchConfig(): Promise<AppConfig> {
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error(`config ${r.status}`);
  const d = await r.json() as { config: AppConfig };
  return d.config;
}

export interface SseHandle {
  close: () => void;
}

export function subscribeEvents(
  onEvent: (e: ServerEvent) => void,
  onConnect: (connected: boolean) => void,
): SseHandle {
  let es: EventSource | null = null;
  let closed = false;
  let retryMs = 500;

  function connect(): void {
    if (closed) return;
    es = new EventSource('/api/events');
    es.onopen = () => {
      retryMs = 500;
      onConnect(true);
    };
    es.onmessage = (m) => {
      try { onEvent(JSON.parse(m.data) as ServerEvent); }
      catch (e) { console.warn('bad sse msg', e); }
    };
    es.onerror = () => {
      onConnect(false);
      es?.close();
      if (!closed) setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    };
  }
  connect();

  return {
    close() {
      closed = true;
      es?.close();
    },
  };
}
