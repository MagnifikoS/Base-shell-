/**
 * Mobile employees tabs component (dumb UI only)
 * Switches between Active and Archived employees lists
 */

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type EmployeeTabValue = "active" | "archived";

interface MobileEmployeesTabsProps {
  value: EmployeeTabValue;
  onChange: (value: EmployeeTabValue) => void;
}

export function MobileEmployeesTabs({ value, onChange }: MobileEmployeesTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as EmployeeTabValue)}
      className="w-full"
    >
      <TabsList className="w-full grid grid-cols-2">
        <TabsTrigger value="active">Actifs</TabsTrigger>
        <TabsTrigger value="archived">Archives</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
