import { Bell, LogOut, Moon, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { MobileEstablishmentSwitcher } from "./admin/MobileEstablishmentSwitcher";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MobileHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  // Unified establishment access - single source of truth
  const { showSelector, activeEstablishment } = useEstablishmentAccess();

  // Get user initials for avatar
  const initials = user?.email ? user.email.substring(0, 2).toUpperCase() : "??";

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  // Display establishment name
  const establishmentName = activeEstablishment?.name || "Établissement";

  return (
    <header className="sticky top-0 z-40 bg-card border-b border-border safe-area-top">
      <div className="flex items-center justify-between h-14 px-4">
        {/* Left: Establishment switcher (if multi-establishment) or establishment name */}
        <div className="flex items-center min-w-0 flex-1">
          {showSelector ? (
            <MobileEstablishmentSwitcher />
          ) : (
            <h1 className="text-base font-semibold text-foreground truncate">
              {establishmentName}
            </h1>
          )}
        </div>

        {/* Right: User avatar with dropdown */}
        <div className="flex items-center gap-3 ml-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center justify-center w-11 h-11 rounded-full bg-primary text-primary-foreground text-sm font-medium transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                aria-label="Menu utilisateur"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem disabled className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span className="truncate">{user?.email}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate("/settings/notifications")}
                className="flex items-center gap-2"
              >
                <Bell className="h-4 w-4" />
                <span>Notifications</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setTheme("light")}
                className="flex items-center gap-2"
              >
                <Sun className="h-4 w-4" />
                <span>Clair</span>
                {theme === "light" && <span className="ml-auto text-primary text-xs">--</span>}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTheme("dark")}
                className="flex items-center gap-2"
              >
                <Moon className="h-4 w-4" />
                <span>Sombre</span>
                {theme === "dark" && <span className="ml-auto text-primary text-xs">--</span>}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTheme("system")}
                className="flex items-center gap-2"
              >
                <Sun className="h-4 w-4" />
                <span>Systeme</span>
                {theme === "system" && <span className="ml-auto text-primary text-xs">--</span>}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="flex items-center gap-2 text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                <span>Déconnexion</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
