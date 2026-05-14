import { useAppStore } from '../store/state.js';
import type { Agent, Group } from '@agent-bay/shared';

export function Sidebar() {
  const agents = useAppStore(s => s.agents);
  const groups = useAppStore(s => s.groups);
  const selectedGroupId = useAppStore(s => s.selectedGroupId);
  const selectAgent = useAppStore(s => s.selectAgent);
  const selectGroup = useAppStore(s => s.selectGroup);

  const agentList = Object.values(agents).filter(a => a.status !== 'gone');
  const allGroups = Object.values(groups).sort((a, b) => a.createdAt - b.createdAt);
  const realGroups = allGroups.filter(g => !g.isDm);
  const dmGroups = allGroups.filter(g => g.isDm);
  const ungroupedAgents = agentList.filter(a => !a.groupId);

  return (
    <>
      <div className="sidebar-header">
        AgentBay <span className="sb-count">{agentList.length} agents · {realGroups.length} groups</span>
      </div>

      <div className="sb-section">
        <div className="sb-section-title">Groups</div>
        {realGroups.length === 0 && <div className="sb-empty">暂无 group · 在主区按 + 创建</div>}
        {realGroups.map(g => (
          <GroupNode
            key={g.id}
            group={g}
            agents={agentList.filter(a => a.groupId === g.id)}
            selected={selectedGroupId === g.id}
            onSelect={() => selectGroup(g.id)}
            onSelectAgent={selectAgent}
          />
        ))}
      </div>

      {ungroupedAgents.length > 0 && (
        <div className="sb-section">
          <div className="sb-section-title">未分配 Agents</div>
          {ungroupedAgents.map(a => (
            <AgentRow key={a.id} agent={a} onSelect={() => selectAgent(a.id)} />
          ))}
        </div>
      )}

      {dmGroups.length > 0 && (
        <div className="sb-section">
          <div className="sb-section-title">DMs</div>
          {dmGroups.map(g => (
            <DmRow
              key={g.id}
              group={g}
              agents={agents}
              selected={selectedGroupId === g.id}
              onSelect={() => selectGroup(g.id)}
            />
          ))}
        </div>
      )}

      <WorkerProfilesNav />
    </>
  );
}

function WorkerProfilesNav() {
  const view = useAppStore(s => s.view);
  const setView = useAppStore(s => s.setView);
  return (
    <div className="sb-section sb-bottom">
      <div
        className={`sb-nav-row ${view === 'master' ? 'sb-selected' : ''}`}
        onClick={() => setView(view === 'master' ? 'main' : 'master')}
      >
        🎛 Master 控制台
      </div>
      <div
        className={`sb-nav-row ${view === 'workers' ? 'sb-selected' : ''}`}
        onClick={() => setView(view === 'workers' ? 'main' : 'workers')}
      >
        ⚙ Worker Profiles
      </div>
    </div>
  );
}

function GroupNode({ group, agents, selected, onSelect, onSelectAgent }: {
  group: Group;
  agents: Agent[];
  selected: boolean;
  onSelect: () => void;
  onSelectAgent: (id: string) => void;
}) {
  return (
    <div className={`sb-group ${selected ? 'sb-selected' : ''}`}>
      <div className="sb-group-row" onClick={onSelect}>
        <span className="sb-group-name">▾ {group.name}</span>
        <span className="sb-count">{agents.length}</span>
      </div>
      <div className="sb-group-agents">
        {agents.length === 0 && <div className="sb-empty">(空)</div>}
        {agents.map(a => (
          <AgentRow key={a.id} agent={a} onSelect={() => onSelectAgent(a.id)} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent, onSelect }: { agent: Agent; onSelect: () => void }) {
  const usagePct = (agent.statusMeta?.usagePct as number | undefined);
  return (
    <div className="sb-agent" onClick={onSelect} title={`${agent.tool} · ${agent.tmuxTarget} · ${agent.status}`}>
      <span className={`agent-dot agent-dot-${agent.status}`} />
      <span className="sb-agent-name">{agent.name}</span>
      {typeof usagePct === 'number' && (
        <span className="sb-agent-usage" title={`用量 ${usagePct}%`}>{usagePct}%</span>
      )}
      <span className="sb-agent-tool">{toolIcon(agent.tool)}</span>
    </div>
  );
}

function DmRow({ group, agents, selected, onSelect }: {
  group: Group;
  agents: Record<string, Agent>;
  selected: boolean;
  onSelect: () => void;
}) {
  // dm:%a:%b → 取出两端 agent 名拼"alice ↔ bob"
  const ids = group.name.replace(/^dm:/, '').split(':');
  const names = ids.map(id => agents[id]?.name ?? id);
  return (
    <div className={`sb-dm ${selected ? 'sb-selected' : ''}`} onClick={onSelect}>
      <span className="sb-dm-icon">✉</span>
      <span className="sb-dm-name">{names.join(' ↔ ')}</span>
    </div>
  );
}

function toolIcon(tool: Agent['tool']): string {
  if (tool === 'claude-code') return 'CC';
  if (tool === 'codex') return 'Cx';
  return '?';
}
