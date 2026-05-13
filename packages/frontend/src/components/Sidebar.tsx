import { useAppStore } from '../store/state.js';
import type { Workspace, Session, Agent } from '@claude-teams/shared';

export function Sidebar() {
  const workspaces = useAppStore(s => s.workspaces);
  const sessions = useAppStore(s => s.sessions);
  const agents = useAppStore(s => s.agents);

  const wsList = Object.values(workspaces).sort((a, b) => a.createdAt - b.createdAt);

  if (wsList.length === 0) {
    return (
      <>
        <div className="sidebar-header">claude-teams</div>
        <div className="sidebar-empty">没有发现 workspace。启动 daemon 后会自动扫描 ~/.claude/projects/。</div>
      </>
    );
  }

  return (
    <>
      <div className="sidebar-header">claude-teams · {wsList.length} workspaces</div>
      <ul className="tree">
        {wsList.map(ws => (
          <WorkspaceNode
            key={ws.id}
            workspace={ws}
            sessions={Object.values(sessions).filter(s => s.workspaceId === ws.id)}
            agents={Object.values(agents)}
          />
        ))}
      </ul>
    </>
  );
}

function WorkspaceNode({ workspace, sessions, agents }: {
  workspace: Workspace; sessions: Session[]; agents: Agent[];
}) {
  return (
    <li className="tree-node tree-workspace">
      <div className="tree-row">
        <span>▾ {workspace.label}</span>
        <span className="tree-count">{sessions.length}</span>
      </div>
      <ul className="tree-children">
        {sessions.length === 0 && <li className="tree-empty">(无 session)</li>}
        {sessions.map(s => (
          <SessionNode key={s.id} session={s} agents={agents.filter(a => a.sessionId === s.id)} />
        ))}
      </ul>
    </li>
  );
}

function SessionNode({ session, agents }: { session: Session; agents: Agent[] }) {
  const shortId = session.id.length > 8 ? session.id.slice(0, 8) : session.id;
  return (
    <li className="tree-node tree-session">
      <div className="tree-row">
        <span title={session.id}>▸ {shortId}</span>
        <span className={`badge badge-${session.mode}`}>{session.mode === 'owned' ? 'Owned' : 'Observed'}</span>
      </div>
      {agents.length > 0 && (
        <ul className="tree-children">
          {agents.map(a => (
            <li key={a.id} className="tree-node tree-agent">
              <span className={`agent-dot agent-dot-${a.state}`} /> {a.name}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
