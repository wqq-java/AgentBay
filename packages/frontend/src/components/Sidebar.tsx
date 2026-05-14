// 重做 Sidebar:Teams 在最上面,然后是单 agent 会话,设置类(Workers/Master)收纳到底部。

import { useAppStore } from '../store/state.js';
import type { Agent, Group } from '@agent-bay/shared';

export function Sidebar() {
  const agents = useAppStore(s => s.agents);
  const groups = useAppStore(s => s.groups);
  const selectedAgentId = useAppStore(s => s.selectedAgentId);
  const view = useAppStore(s => s.view);
  const setView = useAppStore(s => s.setView);
  const selectAgent = useAppStore(s => s.selectAgent);

  const onlineAgents = Object.values(agents).filter(a => a.status !== 'gone');
  const allGroups = Object.values(groups).sort((a, b) => a.createdAt - b.createdAt);
  const teamGroups = allGroups.filter(g => !g.isDm);
  const standaloneAgents = onlineAgents.filter(a => !a.groupId);

  function newTeam() {
    setView('newteam');
  }

  return (
    <>
      <div className="sidebar-header">
        AgentBay
        <span className="sb-count">{onlineAgents.length} agents · {teamGroups.length} teams</span>
      </div>

      <div className="sb-section">
        <button className="btn primary sb-new-team-btn" onClick={newTeam}>+ 新建团队</button>
      </div>

      <div className="sb-section">
        <div className="sb-section-title">Teams</div>
        {teamGroups.length === 0 && (
          <div className="sb-empty">还没团队 · 点上面"+ 新建团队"</div>
        )}
        {teamGroups.map(g => (
          <TeamNode
            key={g.id}
            group={g}
            agents={onlineAgents.filter(a => a.groupId === g.id)}
            selectedAgentId={selectedAgentId}
            currentView={view}
            onSelectAgent={(id) => { selectAgent(id); setView('main'); }}
          />
        ))}
      </div>

      {standaloneAgents.length > 0 && (
        <div className="sb-section">
          <div className="sb-section-title">单聊会话</div>
          {standaloneAgents.map(a => (
            <AgentRow
              key={a.id}
              agent={a}
              selected={selectedAgentId === a.id && view === 'main'}
              onSelect={() => { selectAgent(a.id); setView('main'); }}
            />
          ))}
        </div>
      )}

      <div className="sb-section sb-bottom">
        <div className="sb-section-title">设置</div>
        <div className={`sb-nav-row ${view === 'master' ? 'sb-selected' : ''}`}
             onClick={() => setView(view === 'master' ? 'main' : 'master')}>
          🎛 Master 控制台
        </div>
        <div className={`sb-nav-row ${view === 'workers' ? 'sb-selected' : ''}`}
             onClick={() => setView(view === 'workers' ? 'main' : 'workers')}>
          ⚙ Worker Profiles
        </div>
      </div>
    </>
  );
}

function TeamNode({ group, agents, selectedAgentId, currentView, onSelectAgent }: {
  group: Group;
  agents: Agent[];
  selectedAgentId: string | null;
  currentView: string;
  onSelectAgent: (id: string) => void;
}) {
  return (
    <div className="sb-team">
      <div className="sb-team-row">
        <span className="sb-team-name">▾ {group.name}</span>
        <span className="sb-count">{agents.length}</span>
      </div>
      <div className="sb-team-agents">
        {agents.length === 0 && <div className="sb-empty">(空,所有 agent 已下线)</div>}
        {agents.map(a => (
          <AgentRow
            key={a.id}
            agent={a}
            selected={selectedAgentId === a.id && currentView === 'main'}
            onSelect={() => onSelectAgent(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent, selected, onSelect }: {
  agent: Agent;
  selected: boolean;
  onSelect: () => void;
}) {
  const usagePct = agent.statusMeta?.usagePct as number | undefined;
  const role = agent.role;
  return (
    <div
      className={`sb-agent ${selected ? 'sb-selected' : ''}`}
      onClick={onSelect}
      title={`${agent.tool} · ${agent.tmuxTarget} · ${agent.status}`}
    >
      <span className={`agent-dot agent-dot-${agent.status}`} />
      <span className="sb-agent-name">
        {role ? `@${role}` : agent.name}
      </span>
      {typeof usagePct === 'number' && (
        <span className="sb-agent-usage">{usagePct}%</span>
      )}
      <span className="sb-agent-tool">{toolIcon(agent.tool)}</span>
    </div>
  );
}

function toolIcon(tool: Agent['tool']): string {
  if (tool === 'claude-code') return 'CC';
  if (tool === 'codex') return 'Cx';
  return '?';
}
