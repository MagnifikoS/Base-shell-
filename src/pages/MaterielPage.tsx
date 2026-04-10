/**
 * Matériel — Coming Soon Placeholder
 */
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { Wrench } from "lucide-react";

export default function MaterielPage() {
  return (
    <ComingSoonPage
      moduleKey="materiel"
      title="Matériel"
      description="Gérez vos équipements et leur maintenance."
      icon={Wrench}
      features={[
        "Inventaire du matériel",
        "Calendrier de maintenance",
        "Suivi des réparations",
        "Gestion des garanties",
      ]}
    />
  );
}
