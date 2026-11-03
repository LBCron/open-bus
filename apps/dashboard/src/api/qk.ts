/** Every cache key the dashboard uses. The live-updates hook writes these directly. */
export const qk = {
  me: ["me"] as const,
  machines: ["machines"] as const,
  agents: ["agents"] as const,
  linkedApps: ["linked-apps"] as const,
};
