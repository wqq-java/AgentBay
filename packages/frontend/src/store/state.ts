// Zustand store(v2 数据模型)。

import { create } from 'zustand';
import type {
  Agent, Group, Topic, Message, ServerEvent, Snapshot, ChatMessage,
} from '@agent-bay/shared';

type Dict<T> = Record<string, T>;

interface State {
  agents: Dict<Agent>;
  groups: Dict<Group>;
  topics: Dict<Topic>;
  // 消息按 topic id 索引,每个 topic 一份数组(按 ts 升序)
  messagesByTopic: Dict<Message[]>;
  // 聊天消息按 agent id 索引(浏览器主用法)
  chatByAgent: Dict<ChatMessage[]>;

  connected: boolean;
  selectedAgentId: string | null;
  selectedGroupId: string | null;
  selectedTopicId: string | null;
  view: 'main' | 'workers' | 'master' | 'newteam';

  applySnapshot: (snap: Snapshot) => void;
  applyEvent: (event: ServerEvent) => void;
  setMessages: (topicId: string, messages: Message[]) => void;
  setChatMessages: (agentId: string, messages: ChatMessage[]) => void;
  setConnected: (connected: boolean) => void;
  selectAgent: (id: string | null) => void;
  selectGroup: (id: string | null) => void;
  selectTopic: (id: string | null) => void;
  setView: (view: 'main' | 'workers' | 'master' | 'newteam') => void;
}

function indexBy<T extends { id: string }>(items: T[]): Dict<T> {
  const out: Dict<T> = {};
  for (const it of items) out[it.id] = it;
  return out;
}

export const useAppStore = create<State>((set) => ({
  agents: {},
  groups: {},
  topics: {},
  messagesByTopic: {},
  chatByAgent: {},
  connected: false,
  selectedAgentId: null,
  selectedGroupId: null,
  selectedTopicId: null,
  view: 'main',

  applySnapshot: (snap) => set({
    agents: indexBy(snap.agents),
    groups: indexBy(snap.groups),
    topics: indexBy(snap.topics),
  }),

  applyEvent: (event) => set((state) => {
    switch (event.type) {
      case 'agent-created':
      case 'agent-updated':
        return { agents: { ...state.agents, [event.agent.id]: event.agent } };
      case 'agent-gone': {
        const a = state.agents[event.agentId];
        if (!a) return {};
        return { agents: { ...state.agents, [event.agentId]: { ...a, status: 'gone' } } };
      }
      case 'group-created':
      case 'group-updated':
        return { groups: { ...state.groups, [event.group.id]: event.group } };
      case 'group-deleted': {
        const next = { ...state.groups };
        delete next[event.groupId];
        return { groups: next };
      }
      case 'topic-created':
      case 'topic-updated':
        return { topics: { ...state.topics, [event.topic.id]: event.topic } };
      case 'message-created': {
        const list = state.messagesByTopic[event.message.topicId] ?? [];
        return {
          messagesByTopic: {
            ...state.messagesByTopic,
            [event.message.topicId]: [...list, event.message],
          },
        };
      }
      case 'chat-message': {
        const list = state.chatByAgent[event.agentId] ?? [];
        // dedupe by id
        if (list.some(m => m.id === event.message.id)) return {};
        return {
          chatByAgent: {
            ...state.chatByAgent,
            [event.agentId]: [...list, event.message],
          },
        };
      }
      default:
        return {};
    }
  }),

  setMessages: (topicId, messages) => set((state) => ({
    messagesByTopic: { ...state.messagesByTopic, [topicId]: messages },
  })),

  setChatMessages: (agentId, messages) => set((state) => ({
    chatByAgent: { ...state.chatByAgent, [agentId]: messages },
  })),

  setConnected: (connected) => set({ connected }),
  selectAgent: (id) => set({ selectedAgentId: id, view: 'main' }),
  selectGroup: (id) => set({ selectedGroupId: id, selectedTopicId: null, view: 'main' }),
  selectTopic: (id) => set({ selectedTopicId: id, view: 'main' }),
  setView: (view) => set({ view }),
}));
