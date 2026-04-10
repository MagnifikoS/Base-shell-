import { useState } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useBenchPdfs } from "../hooks/useBenchPdfs";
import { BenchPdfList } from "../components/BenchPdfList";
import { BenchRunsCompare } from "../components/BenchRunsCompare";
import { BenchDashboard } from "../components/BenchDashboard";
import type { BenchPdf } from "../types";
import { FlaskConical, FolderOpen, BarChart3, Loader2 } from "lucide-react";

export function VisionAIBenchPage() {
  const { activeEstablishment, loading: establishmentLoading } = useEstablishment();
  const establishmentId = activeEstablishment?.id || null;
  const { data: pdfs = [], isLoading } = useBenchPdfs(establishmentId);
  const [selectedPdf, setSelectedPdf] = useState<BenchPdf | null>(null);
  const [activeTab, setActiveTab] = useState("corpus");

  const handleSelectPdf = (pdf: BenchPdf) => {
    setSelectedPdf(pdf);
    setActiveTab("compare");
  };

  const handlePdfUpdate = (updatedPdf: BenchPdf) => {
    setSelectedPdf(updatedPdf);
  };

  return (
    <ResponsiveLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6" />
            Vision AI Bench
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Comparez les résultats d'extraction entre différents modèles IA
          </p>
        </div>

        {/* Wait for establishment context to be ready */}
        {establishmentLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement...
          </div>
        )}

        {!establishmentLoading && !activeEstablishment && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">Aucun établissement sélectionné.</p>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className={establishmentLoading || !activeEstablishment ? "hidden" : ""}
        >
          <TabsList>
            <TabsTrigger value="corpus" className="gap-1.5">
              <FolderOpen className="h-4 w-4" />
              Corpus ({pdfs.length})
            </TabsTrigger>
            <TabsTrigger value="compare" className="gap-1.5" disabled={!selectedPdf}>
              <FlaskConical className="h-4 w-4" />
              Compare
            </TabsTrigger>
            <TabsTrigger value="dashboard" className="gap-1.5">
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
          </TabsList>

          <TabsContent value="corpus" className="mt-4">
            <BenchPdfList
              pdfs={pdfs}
              isLoading={isLoading}
              establishmentId={establishmentId || ""}
              onSelectPdf={handleSelectPdf}
              selectedPdfId={selectedPdf?.id}
            />
          </TabsContent>

          <TabsContent value="compare" className="mt-4">
            {selectedPdf ? (
              <BenchRunsCompare pdf={selectedPdf} onPdfUpdate={handlePdfUpdate} />
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">Sélectionnez un PDF depuis l'onglet Corpus pour comparer</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="dashboard" className="mt-4">
            <BenchDashboard />
          </TabsContent>
        </Tabs>
      </div>
    </ResponsiveLayout>
  );
}

export default VisionAIBenchPage;
