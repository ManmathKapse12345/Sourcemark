"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "@/lib/auth";
import { Shell } from "@/components/Shell";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider><Shell>{children}</Shell></AuthProvider>
    </QueryClientProvider>
  );
}
