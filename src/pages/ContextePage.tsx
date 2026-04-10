/**
 * Contexte & Événements — Coming Soon Placeholder
 */
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { CalendarCheck } from "lucide-react";

export default function ContextePage() {
  return (
    <ComingSoonPage
      moduleKey="contexte"
      title="Contexte & Événements"
      description="Enrichissez vos données avec le contexte externe."
      icon={CalendarCheck}
      features={[
        "Calendrier des événements locaux",
        "Météo et affluence prédite",
        "Jours fériés et vacances",
        "Impact sur les ventes",
      ]}
    />
  );
}
