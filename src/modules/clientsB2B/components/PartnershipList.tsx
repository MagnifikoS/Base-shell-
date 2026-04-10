/**
 * Partnership list with filter (active/archived) + archive action
 * Supplier view includes ShareStockToggle per client.
 */

import { useState } from "react";
import { useMyPartnerships } from "../hooks/useMyPartnerships";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { archivePartnership, type B2BPartnership } from "../services/b2bPartnershipService";
import { PartnerProfileCard } from "./PartnerProfileCard";
import { ShareStockToggle } from "./ShareStockToggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Archive, Loader2, BookOpen } from "lucide-react";
import { toast } from "sonner";

interface Props {
  /** "supplier" = show client partners, "client" = show supplier partners */
  viewAs: "supplier" | "client";
  /** Called when user clicks "Voir catalogue" on an active partnership */
  onViewCatalog?: (partnershipId: string, partnerName: string) => void;
}

export function PartnershipList({ viewAs, onViewCatalog }: Props) {
  const { partnerships, isLoading, refetch } = useMyPartnerships();
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const [archiveTarget, setArchiveTarget] = useState<B2BPartnership | null>(null);
  const [archiving, setArchiving] = useState(false);

  const estId = activeEstablishment?.id;

  // Filter by role
  const filtered = partnerships.filter((p) => {
    if (viewAs === "supplier") return p.supplier_establishment_id === estId;
    return p.client_establishment_id === estId;
  });

  const active = filtered.filter((p) => p.status === "active");
  const archived = filtered.filter((p) => p.status === "archived");

  const getPartnerEstId = (p: B2BPartnership) =>
    viewAs === "supplier" ? p.client_establishment_id : p.supplier_establishment_id;

  const handleArchive = async () => {
    if (!archiveTarget || !user?.id) return;
    setArchiving(true);
    try {
      await archivePartnership(archiveTarget.id, user.id);
      toast.success("Partenariat archivé");
      refetch();
    } catch (err: unknown) {
      toast.error(`Erreur : ${(err as Error).message}`);
    } finally {
      setArchiving(false);
      setArchiveTarget(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderList = (list: B2BPartnership[]) => {
    if (list.length === 0) {
      return (
        <p className="text-center text-muted-foreground py-8">
          Aucun partenariat {list === archived ? "archivé" : "actif"}
        </p>
      );
    }

    return (
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((p) => {
          const canViewCatalog = viewAs === "client" && onViewCatalog && p.status === "active";
          const showShareToggle = viewAs === "supplier" && p.status === "active";
          return (
            <div key={p.id} className="space-y-2">
              <div
                className={`group ${canViewCatalog ? "cursor-pointer" : ""}`}
                onClick={canViewCatalog ? () => onViewCatalog(p.id, "") : undefined}
              >
                <PartnerProfileCard
                  partnerEstablishmentId={getPartnerEstId(p)}
                  partnershipStatus={p.status as "active" | "archived"}
                  actions={
                    p.status === "active" ? (
                      <>
                        {canViewCatalog && (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-8 rounded-lg shadow-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewCatalog(p.id, "");
                            }}
                          >
                            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                            Catalogue
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg text-muted-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiveTarget(p);
                          }}
                        >
                          <Archive className="h-3.5 w-3.5 mr-1.5" />
                          Archiver
                        </Button>
                      </>
                    ) : undefined
                  }
                />
                {canViewCatalog && (
                  <div className="absolute inset-0 rounded-lg border-2 border-transparent group-hover:border-primary/30 transition-colors pointer-events-none" />
                )}
              </div>
              {showShareToggle && (
                <ShareStockToggle
                  partnershipId={p.id}
                  initialValue={p.share_stock ?? false}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <Tabs defaultValue="active" className="w-full">
        <TabsList>
          <TabsTrigger value="active">Actifs ({active.length})</TabsTrigger>
          <TabsTrigger value="archived">Archivés ({archived.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          {renderList(active)}
        </TabsContent>
        <TabsContent value="archived" className="mt-4">
          {renderList(archived)}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!archiveTarget} onOpenChange={() => setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver ce partenariat ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le partenariat sera archivé pour les deux parties. Cette action est réversible
              uniquement par un administrateur.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} disabled={archiving}>
              {archiving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
