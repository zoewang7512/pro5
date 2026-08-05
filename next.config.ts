import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 這個 repo 的 AGENTS.md 是治理流程的單一事實來源，
  // 不希望被 `next dev` 自動附加的 agent-rules 區塊污染。
  agentRules: false,
};

export default nextConfig;
