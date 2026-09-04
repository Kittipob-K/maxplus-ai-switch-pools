export type AgentType = "claude-code" | "openai" | "custom";

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  command: string;
  args?: string[];
}

export interface Pool {
  id: string;
  name: string;
  model: string;
  agents: Agent[];
}

export interface RunOptions {
  pool?: string;
  model?: string;
  agent?: AgentType;
  args?: string[];
}
