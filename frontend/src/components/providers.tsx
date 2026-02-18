"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { useState, useEffect, createContext, useContext } from "react";
import { onDemoModeChange, isDemoMode } from "@/lib/api";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

const DemoModeContext = createContext(false);
export function useDemoMode() {
  return useContext(DemoModeContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    setDemo(isDemoMode());
    return onDemoModeChange(setDemo);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({ accentColor: "#4f46e5", accentColorForeground: "white" })}
        >
          <DemoModeContext.Provider value={demo}>
            {demo && (
              <div className="bg-amber-500/90 text-black text-center text-sm font-medium py-1.5 px-4">
                ⚠️ Demo Mode — API not connected. Showing sample data.
              </div>
            )}
            {children}
          </DemoModeContext.Provider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
