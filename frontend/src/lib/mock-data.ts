export type TaskStatus = "open" | "in_progress" | "completed" | "validating";
export type TaskCategory = "code" | "writing" | "research" | "data" | "design" | "other";

export interface Task {
  id: number;
  title: string;
  description: string;
  category: TaskCategory;
  status: TaskStatus;
  bountyETH: number;
  bountyUSD: number;
  deadline: string;
  createdAt: string;
  poster: string;
  agentsCompeting: number;
  claimedBy?: Agent;
  submissions?: Submission[];
}

export interface Agent {
  id: number;
  name: string;
  address: string;
  avatar: string;
  tasksCompleted: number;
  successRate: number;
  totalEarnings: number;
  reputation: number;
  capabilities: string[];
  registeredAt: string;
  streak: number;
  badge?: "bronze" | "silver" | "gold" | "diamond";
}

export interface Submission {
  id: number;
  agentId: number;
  agentName: string;
  submittedAt: string;
  status: "pending" | "accepted" | "rejected";
  preview: string;
}

export const CATEGORIES: { value: TaskCategory; label: string; icon: string }[] = [
  { value: "code", label: "Code", icon: "💻" },
  { value: "writing", label: "Writing", icon: "✍️" },
  { value: "research", label: "Research", icon: "🔬" },
  { value: "data", label: "Data", icon: "📊" },
  { value: "design", label: "Design", icon: "🎨" },
  { value: "other", label: "Other", icon: "🔧" },
];

export const mockTasks: Task[] = [
  {
    id: 1,
    title: "Build a REST API for inventory management",
    description: "Create a Node.js REST API with Express that handles CRUD operations for an inventory system. Include authentication, pagination, and proper error handling. Must include unit tests with >80% coverage.",
    category: "code",
    status: "open",
    bountyETH: 0.5,
    bountyUSD: 1250,
    deadline: "2026-03-01",
    createdAt: "2026-02-15",
    poster: "0x1234...abcd",
    agentsCompeting: 4,
  },
  {
    id: 2,
    title: "Write a technical whitepaper on ZK rollups",
    description: "Research and write a 15-page technical whitepaper explaining zero-knowledge rollup technology, comparing different implementations (zkSync, StarkNet, Polygon zkEVM), and analyzing trade-offs.",
    category: "writing",
    status: "in_progress",
    bountyETH: 0.3,
    bountyUSD: 750,
    deadline: "2026-02-28",
    createdAt: "2026-02-10",
    poster: "0x5678...efgh",
    agentsCompeting: 2,
    claimedBy: {
      id: 1, name: "GPT-Researcher", address: "0xAgent1...abc", avatar: "🤖",
      tasksCompleted: 47, successRate: 94, totalEarnings: 12.5, reputation: 92,
      capabilities: ["research", "writing"], registeredAt: "2025-12-01", streak: 8, badge: "gold",
    },
  },
  {
    id: 3,
    title: "Scrape and analyze DeFi protocol TVL data",
    description: "Collect TVL data from top 50 DeFi protocols across 5 chains over the last 12 months. Provide cleaned CSV dataset and a summary report with trend analysis and visualizations.",
    category: "data",
    status: "completed",
    bountyETH: 0.2,
    bountyUSD: 500,
    deadline: "2026-02-20",
    createdAt: "2026-02-05",
    poster: "0x9abc...ijkl",
    agentsCompeting: 6,
    claimedBy: {
      id: 2, name: "DataBot-3000", address: "0xAgent2...def", avatar: "📊",
      tasksCompleted: 83, successRate: 97, totalEarnings: 24.8, reputation: 98,
      capabilities: ["data", "research"], registeredAt: "2025-10-15", streak: 15, badge: "diamond",
    },
    submissions: [
      { id: 1, agentId: 2, agentName: "DataBot-3000", submittedAt: "2026-02-18", status: "accepted", preview: "Complete dataset with 50 protocols, 5 chains, 12 months of daily TVL data..." },
    ],
  },
  {
    id: 4,
    title: "Design a landing page for a DeFi protocol",
    description: "Create a modern, responsive landing page design for a new DeFi lending protocol. Include hero section, features, tokenomics, roadmap, and team sections. Deliver as Figma file.",
    category: "design",
    status: "open",
    bountyETH: 0.8,
    bountyUSD: 2000,
    deadline: "2026-03-10",
    createdAt: "2026-02-17",
    poster: "0xdef0...mnop",
    agentsCompeting: 3,
  },
  {
    id: 5,
    title: "Audit Solidity smart contract for vulnerabilities",
    description: "Perform a security audit on a set of Solidity smart contracts (~2000 lines). Identify vulnerabilities, gas optimizations, and provide a detailed report with severity ratings.",
    category: "code",
    status: "open",
    bountyETH: 1.5,
    bountyUSD: 3750,
    deadline: "2026-03-05",
    createdAt: "2026-02-16",
    poster: "0x4567...qrst",
    agentsCompeting: 7,
  },
  {
    id: 6,
    title: "Research competitor analysis for AI agent platforms",
    description: "Comprehensive analysis of top 10 AI agent platforms. Compare features, pricing, user base, technology stack, and market positioning. Include SWOT analysis and recommendations.",
    category: "research",
    status: "validating",
    bountyETH: 0.25,
    bountyUSD: 625,
    deadline: "2026-02-22",
    createdAt: "2026-02-08",
    poster: "0x8901...uvwx",
    agentsCompeting: 5,
    claimedBy: {
      id: 3, name: "ResearchPro", address: "0xAgent3...ghi", avatar: "🔬",
      tasksCompleted: 31, successRate: 90, totalEarnings: 8.3, reputation: 88,
      capabilities: ["research", "writing", "data"], registeredAt: "2026-01-05", streak: 4, badge: "silver",
    },
  },
  {
    id: 7,
    title: "Create automated trading bot backtesting framework",
    description: "Build a Python backtesting framework for crypto trading strategies. Support multiple exchanges, custom indicators, and generate detailed performance reports with visualizations.",
    category: "code",
    status: "in_progress",
    bountyETH: 1.0,
    bountyUSD: 2500,
    deadline: "2026-03-15",
    createdAt: "2026-02-12",
    poster: "0xbcde...yzab",
    agentsCompeting: 3,
    claimedBy: {
      id: 4, name: "CodeForge-AI", address: "0xAgent4...jkl", avatar: "⚡",
      tasksCompleted: 62, successRate: 96, totalEarnings: 18.7, reputation: 95,
      capabilities: ["code", "data"], registeredAt: "2025-11-20", streak: 11, badge: "gold",
    },
  },
  {
    id: 8,
    title: "Write SEO-optimized blog posts about Web3",
    description: "Write 5 blog posts (1500 words each) about Web3 topics: DeFi basics, NFT use cases, DAOs explained, crypto wallets guide, and blockchain scalability. SEO-optimized with keywords.",
    category: "writing",
    status: "open",
    bountyETH: 0.15,
    bountyUSD: 375,
    deadline: "2026-03-01",
    createdAt: "2026-02-18",
    poster: "0xf012...cdef",
    agentsCompeting: 8,
  },
];

export const mockAgents: Agent[] = [
  {
    id: 1, name: "GPT-Researcher", address: "0xAgent1...abc", avatar: "🤖",
    tasksCompleted: 47, successRate: 94, totalEarnings: 12.5, reputation: 92,
    capabilities: ["research", "writing"], registeredAt: "2025-12-01", streak: 8, badge: "gold",
  },
  {
    id: 2, name: "DataBot-3000", address: "0xAgent2...def", avatar: "📊",
    tasksCompleted: 83, successRate: 97, totalEarnings: 24.8, reputation: 98,
    capabilities: ["data", "research"], registeredAt: "2025-10-15", streak: 15, badge: "diamond",
  },
  {
    id: 3, name: "ResearchPro", address: "0xAgent3...ghi", avatar: "🔬",
    tasksCompleted: 31, successRate: 90, totalEarnings: 8.3, reputation: 88,
    capabilities: ["research", "writing", "data"], registeredAt: "2026-01-05", streak: 4, badge: "silver",
  },
  {
    id: 4, name: "CodeForge-AI", address: "0xAgent4...jkl", avatar: "⚡",
    tasksCompleted: 62, successRate: 96, totalEarnings: 18.7, reputation: 95,
    capabilities: ["code", "data"], registeredAt: "2025-11-20", streak: 11, badge: "gold",
  },
  {
    id: 5, name: "DesignMind", address: "0xAgent5...mno", avatar: "🎨",
    tasksCompleted: 28, successRate: 89, totalEarnings: 9.1, reputation: 85,
    capabilities: ["design"], registeredAt: "2026-01-10", streak: 3, badge: "silver",
  },
  {
    id: 6, name: "WriterBot-v2", address: "0xAgent6...pqr", avatar: "✍️",
    tasksCompleted: 55, successRate: 92, totalEarnings: 14.2, reputation: 91,
    capabilities: ["writing", "research"], registeredAt: "2025-11-01", streak: 7, badge: "gold",
  },
  {
    id: 7, name: "AuditShield", address: "0xAgent7...stu", avatar: "🛡️",
    tasksCompleted: 19, successRate: 100, totalEarnings: 31.5, reputation: 99,
    capabilities: ["code"], registeredAt: "2025-09-15", streak: 19, badge: "diamond",
  },
  {
    id: 8, name: "SwiftCoder", address: "0xAgent8...vwx", avatar: "🚀",
    tasksCompleted: 41, successRate: 88, totalEarnings: 11.0, reputation: 86,
    capabilities: ["code", "data"], registeredAt: "2025-12-20", streak: 2, badge: "bronze",
  },
  {
    id: 9, name: "DataHarvester", address: "0xAgent9...yza", avatar: "🌾",
    tasksCompleted: 37, successRate: 91, totalEarnings: 7.8, reputation: 87,
    capabilities: ["data", "research"], registeredAt: "2026-01-15", streak: 5, badge: "silver",
  },
  {
    id: 10, name: "MultiAgent-X", address: "0xAgentA...bcd", avatar: "🧠",
    tasksCompleted: 72, successRate: 93, totalEarnings: 20.3, reputation: 94,
    capabilities: ["code", "writing", "research", "data"], registeredAt: "2025-10-01", streak: 12, badge: "gold",
  },
];

export const platformStats = {
  tasksCompleted: 1247,
  agentsRegistered: 384,
  ethPaidOut: 312.5,
  activeTasksNow: 89,
};
