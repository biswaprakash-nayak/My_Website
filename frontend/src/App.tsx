import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Visualizer from "./pages/Visualizer";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const PORTFOLIO_RETURN_KEY = "portfolioReturnUrl";

const PortfolioReturnButton = () => {
  const location = useLocation();
  const [returnUrl, setReturnUrl] = useState("");
  const isEmbedded = typeof window !== "undefined" && window.self !== window.top;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const queryUrl = params.get("portfolioReturn") || "";
    const embedMode = params.get("embed") === "1";

    if (embedMode || isEmbedded) {
      setReturnUrl("");
      return;
    }

    if (queryUrl.startsWith("http://") || queryUrl.startsWith("https://")) {
      sessionStorage.setItem(PORTFOLIO_RETURN_KEY, queryUrl);
      setReturnUrl(queryUrl);
      return;
    }

    const storedUrl = sessionStorage.getItem(PORTFOLIO_RETURN_KEY) || "";
    setReturnUrl(storedUrl);
  }, [isEmbedded, location.search]);

  if (!returnUrl || isEmbedded) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = returnUrl;
      }}
      className="fixed bottom-4 right-4 z-[9999] rounded-full border border-white bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-black shadow-lg transition hover:bg-zinc-100"
    >
      Back to Portfolio
    </button>
  );
};

const AnimatedRoutes = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.3 }}>
        <Routes location={location}>
          <Route path="/" element={<Index />} />
          <Route path="/dashboard" element={<Index />} />
          <Route path="/dashboard-legacy" element={<Dashboard />} />
          <Route path="/visualizer" element={<Visualizer />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <PortfolioReturnButton />
        <AnimatedRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
