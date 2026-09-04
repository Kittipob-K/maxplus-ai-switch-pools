import type { Pool } from "../types.js";

// Default pools configuration - will be extended with config file support
const DEFAULT_POOLS: Pool[] = [
  {
    id: "claude-default",
    name: "Claude Default",
    model: "claude-sonnet-4-20250514",
    agents: [
      {
        id: "claude-code",
        name: "Claude Code CLI",
        type: "claude-code",
        command: "claude",
      },
    ],
  },
  {
    id: "claude-fast",
    name: "Claude Fast",
    model: "claude-haiku-3",
    agents: [
      {
        id: "claude-code",
        name: "Claude Code CLI",
        type: "claude-code",
        command: "claude",
      },
    ],
  },
];

export class PoolService {
  private pools: Pool[];

  constructor() {
    this.pools = DEFAULT_POOLS;
  }

  listPools(): Pool[] {
    return this.pools;
  }

  getPool(id: string): Pool | undefined {
    return this.pools.find((p) => p.id === id);
  }

  getPoolByModel(model: string): Pool | undefined {
    return this.pools.find((p) => p.model === model);
  }
}
