interface ShiftCoreHeaderProps {
  employeeName: string;
  formattedDate: string;
  openingDisplay: string;
  isClosed: boolean;
}

/**
 * Header section showing employee name, date, and opening hours
 */
export function ShiftCoreHeader({
  employeeName,
  formattedDate,
  openingDisplay,
  isClosed,
}: ShiftCoreHeaderProps) {
  return (
    <>
      {/* Employee & Date info */}
      <div className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{employeeName}</span>
        <span className="mx-1">·</span>
        <span className="capitalize">{formattedDate}</span>
      </div>

      {/* Opening hours */}
      <div className="text-sm px-3 py-2 rounded-md bg-muted/50 border">
        <span className="text-muted-foreground">Horaires d'ouverture : </span>
        <span className={isClosed ? "text-destructive font-medium" : "font-medium text-foreground"}>
          {openingDisplay}
        </span>
      </div>
    </>
  );
}
