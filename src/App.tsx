import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { EstablishmentProvider } from "@/contexts/EstablishmentContext";
import { BlockingDialogProvider } from "@/contexts/BlockingDialogContext";
import { queryClient } from "@/lib/queryClient";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PermissionCheck } from "@/routes/PermissionCheck";
import { AppRoutes } from "@/routes/AppRoutes";

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <BlockingDialogProvider>
            <Toaster />
            <OfflineBanner />
            <BrowserRouter>
              <AuthProvider>
                <EstablishmentProvider>
                  <PermissionCheck>
                    <AppRoutes />
                  </PermissionCheck>
                </EstablishmentProvider>
              </AuthProvider>
            </BrowserRouter>
          </BlockingDialogProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
