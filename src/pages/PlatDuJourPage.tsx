/**
 * Plat du Jour — Coming Soon Placeholder
 */
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { UtensilsCrossed } from "lucide-react";

export default function PlatDuJourPage() {
  return (
    <ComingSoonPage
      moduleKey="plat_du_jour"
      title="Plat du Jour"
      description="Planifiez et publiez vos plats du jour."
      icon={UtensilsCrossed}
      features={[
        "Calendrier de publication",
        "Suggestions IA basées sur le stock",
        "Partage sur réseaux sociaux",
        "Historique des plats",
      ]}
    />
  );
}
