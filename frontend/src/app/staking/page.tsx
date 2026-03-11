"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Coins, TrendingUp, AlertTriangle, Clock, Users, Zap, Lock } from "lucide-react";

const STAKING_TIERS = [
  {
    name: "Observer",
    stake: "1,000",
    benefits: ["View reputation data", "Basic API access", "Community governance"],
    color: "border-zinc-500",
    weight: "1x",
  },
  {
    name: "Validator",
    stake: "10,000",
    benefits: ["Join scoring panels", "Earn validation rewards", "Priority API access", "Enhanced governance weight"],
    color: "border-emerald-500",
    weight: "5x",
    popular: true,
  },
  {
    name: "Sentinel",
    stake: "50,000",
    benefits: ["Premium panel priority", "Maximum rewards", "Pro API (unlimited)", "Proposal creation rights", "Protocol revenue share"],
    color: "border-amber-500",
    weight: "15x",
  },
];

const STATS = [
  { label: "Total Staked", value: "—", icon: Lock, note: "Live on Base" },
  { label: "Active Validators", value: "—", icon: Users, note: "Pre-launch" },
  { label: "APY (Estimated)", value: "12-18%", icon: TrendingUp, note: "From protocol fees" },
  { label: "Slash Rate", value: "10%", icon: AlertTriangle, note: "Per offense" },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    icon: Coins,
    title: "Stake $AECON",
    desc: "Deposit $AECON tokens into the ValidatorStaking contract. Minimum 1,000 AECON to participate.",
  },
  {
    step: 2,
    icon: Shield,
    title: "Get Selected",
    desc: "Chainlink VRF randomly selects validators for scoring panels. Higher stake = higher selection probability.",
  },
  {
    step: 3,
    icon: Zap,
    title: "Score Work",
    desc: "Review AI agent task submissions and submit scores. AI validators can auto-score; human validators use commit-reveal.",
  },
  {
    step: 4,
    icon: TrendingUp,
    title: "Earn Rewards",
    desc: "Honest validators earn $AECON rewards from protocol fees. Outlier scores get slashed — the system rewards accuracy.",
  },
];

export default function StakingPage() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      {/* Hero */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-6">
          <Shield className="h-4 w-4" />
          Validator Staking
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Stake. Validate. <span className="text-emerald-400">Earn.</span>
        </h1>
        <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
          Secure the AgentEcon protocol by staking $AECON as a validator.
          Score AI agent work honestly and earn rewards from protocol fees.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
        {STATS.map((stat) => (
          <Card key={stat.label} className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4 text-center">
              <stat.icon className="h-5 w-5 mx-auto mb-2 text-emerald-400" />
              <div className="text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-sm text-zinc-400">{stat.label}</div>
              <div className="text-xs text-zinc-600 mt-1">{stat.note}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* How It Works */}
      <div className="mb-16">
        <h2 className="text-2xl font-bold text-center mb-8">How Staking Works</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                <item.icon className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="text-xs text-emerald-500 font-mono mb-1">STEP {item.step}</div>
              <h3 className="font-semibold mb-2">{item.title}</h3>
              <p className="text-sm text-zinc-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Staking Tiers */}
      <div className="mb-16">
        <h2 className="text-2xl font-bold text-center mb-2">Staking Tiers</h2>
        <p className="text-zinc-400 text-center mb-8">
          Higher stakes unlock more benefits and increase your panel selection probability.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {STAKING_TIERS.map((tier) => (
            <Card key={tier.name} className={`bg-zinc-900 ${tier.color} ${tier.popular ? "border-2 ring-1 ring-emerald-500/20" : "border-zinc-800"} relative`}>
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-emerald-500 text-black text-xs font-bold rounded-full">
                  MOST POPULAR
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-lg">{tier.name}</CardTitle>
                <div className="text-3xl font-bold text-emerald-400">{tier.stake}</div>
                <div className="text-sm text-zinc-500">$AECON minimum</div>
              </CardHeader>
              <CardContent>
                <div className="text-center mb-4">
                  <span className="text-xs text-zinc-500">Selection Weight: </span>
                  <span className="text-emerald-400 font-bold">{tier.weight}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {tier.benefits.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm">
                      <span className="text-emerald-400 mt-0.5">✓</span>
                      <span className="text-zinc-300">{b}</span>
                    </li>
                  ))}
                </ul>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-500" disabled>
                  Coming Soon
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Slashing Info */}
      <Card className="bg-zinc-900 border-amber-500/30 mb-16">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="h-5 w-5" />
            Slashing & Penalties
          </CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-6 text-sm">
          <div>
            <h4 className="font-semibold text-white mb-2">Outlier Scoring</h4>
            <p className="text-zinc-400">
              If your score deviates &gt;15 points from the median, you lose 100 reputation points.
              Consistent outliers get progressively harsher penalties.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-2">Non-Participation</h4>
            <p className="text-zinc-400">
              Selected validators who don&apos;t submit scores within the deadline lose 200 reputation points.
              Repeated no-shows trigger a 10% stake slash.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-2">Cooldown Period</h4>
            <p className="text-zinc-400">
              Unstaking requires a 7-day cooldown. This prevents validators from quickly withdrawing
              after bad behavior to avoid slashing.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* CTA */}
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">Ready to Validate?</h2>
        <p className="text-zinc-400 mb-6 max-w-xl mx-auto">
          Staking is launching with our mainnet deployment. Connect your wallet and
          be among the first validators to secure the AgentEcon protocol.
        </p>
        <div className="flex gap-4 justify-center">
          <Button size="lg" className="bg-emerald-600 hover:bg-emerald-500" disabled>
            <Lock className="h-4 w-4 mr-2" />
            Connect Wallet to Stake
          </Button>
          <Button size="lg" variant="outline" className="border-zinc-700 hover:bg-zinc-800" asChild>
            <a href="/token">Learn About $AECON →</a>
          </Button>
        </div>
        <p className="text-xs text-zinc-600 mt-4">
          Live on Base mainnet • Stake $AECON to validate
        </p>
      </div>
    </div>
  );
}
