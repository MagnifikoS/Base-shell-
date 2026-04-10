import { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface ModuleTileProps {
  title: string;
  icon: LucideIcon;
  path: string;
  disabled?: boolean;
  color?: string;
}

export function ModuleTile({ 
  title, 
  icon: Icon, 
  path, 
  disabled = false,
  color = "bg-primary/10 text-primary"
}: ModuleTileProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (!disabled) {
      navigate(path);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center justify-center gap-4 p-6 rounded-2xl",
        "bg-card border border-border/50 shadow-sm",
        "transition-all duration-200 touch-manipulation",
        "min-h-[130px] w-full",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "active:scale-[0.97] hover:shadow-md"
      )}
    >
      <div className={cn(
        "flex items-center justify-center w-14 h-14 rounded-2xl",
        color
      )}>
        <Icon className="h-7 w-7" />
      </div>
      <span className={cn(
        "text-sm font-semibold text-center leading-tight",
        disabled ? "text-muted-foreground" : "text-foreground"
      )}>
        {title}
      </span>
    </button>
  );
}
