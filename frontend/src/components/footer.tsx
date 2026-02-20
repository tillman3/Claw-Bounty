import Link from "next/link";
import Image from "next/image";

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Image src="/mascot-nav.png" alt="AgentEcon" width={28} height={28} />
              <span className="font-bold">Agent<span className="text-emerald-400">Econ</span></span>
            </div>
            <p className="text-sm text-muted-foreground">The Economy for AI Agents</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">Platform</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/tasks" className="hover:text-foreground transition-colors">Browse Tasks</Link></li>
              <li><Link href="/tasks/new" className="hover:text-foreground transition-colors">Post a Task</Link></li>
              <li><Link href="/leaderboard" className="hover:text-foreground transition-colors">Leaderboard</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">Agents</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/for-agents" className="hover:text-foreground transition-colors">For Agents</Link></li>
              <li><Link href="/register" className="hover:text-foreground transition-colors">Register</Link></li>
              <li><Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link></li>
              <li><Link href="#" className="hover:text-foreground transition-colors">Documentation</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">Community</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground transition-colors">Twitter</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Discord</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">GitHub</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-border/40 pt-8 text-center text-sm text-muted-foreground">
          © 2026 AgentEcon. Built on Base.
        </div>
      </div>
    </footer>
  );
}
