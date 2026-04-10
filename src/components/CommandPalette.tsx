import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileDown, Keyboard } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { NAV_REGISTRY, type NavItem } from "@/config/navRegistry";

/**
 * Filter navigation items that should appear in the command palette:
 * - Must have at least one placement (not hidden/empty)
 * - Must not be marked as hidden
 * - Exclude child-only items (childType === "tab")
 * - Exclude legacy/masked items (empty placements)
 */
function getNavigableItems(): NavItem[] {
  return NAV_REGISTRY.filter(
    (item) => !item.hidden && item.placements.length > 0 && !item.childType
  ).sort((a, b) => a.order - b.order);
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [navItems] = useState<NavItem[]>(() => getNavigableItems());

  // Listen for Cmd+K / Ctrl+K to toggle the palette
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  const handleSelect = useCallback(
    (route: string) => {
      onOpenChange(false);
      navigate(route);
    },
    [navigate, onOpenChange]
  );

  const handleAction = useCallback(
    (action: string) => {
      onOpenChange(false);
      switch (action) {
        case "export-csv":
          navigate("/parametres");
          break;
        case "shortcuts-help":
          // Re-open with a small delay so dialog transition completes
          break;
      }
    },
    [navigate, onOpenChange]
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Rechercher une page ou une action..." />
      <CommandList>
        <CommandEmpty>Aucun resultat.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.id}
                value={item.label}
                onSelect={() => handleSelect(item.route)}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                <span>{item.label}</span>
                {item.adminOnly && <CommandShortcut>Admin</CommandShortcut>}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="Exporter CSV" onSelect={() => handleAction("export-csv")}>
            <FileDown className="mr-2 h-4 w-4 shrink-0" />
            <span>Exporter CSV</span>
          </CommandItem>
          <CommandItem value="Raccourcis clavier" onSelect={() => handleAction("shortcuts-help")}>
            <Keyboard className="mr-2 h-4 w-4 shrink-0" />
            <span>Raccourcis clavier</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
