import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Building2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  ImagePlus,
  X,
  Check,
  Blocks,
} from "lucide-react";
import {
  platformCreateOrganizationWizard,
  platformListModules,
} from "@/lib/platform/rpcPlatform";
import type {
  CreateOrgWizardPayload,
  PlatformModuleRow,
} from "@/lib/platform/rpcPlatform";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEPS = [
  { label: "Organisation", icon: "🏢" },
  { label: "Établissement", icon: "📋" },
  { label: "Modules", icon: "🧩" },
];

export function PlatformCreateOrgWizard({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState(false);

  // ── Form state ──
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("");
  const [estName, setEstName] = useState("");
  const [estType, setEstType] = useState("restaurant");
  const [profile, setProfile] = useState({
    legal_name: "",
    siret: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    address_line1: "",
    address_line2: "",
    postal_code: "",
    city: "",
    country: "FR",
    logo_url: "",
  });
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());

  // ── Modules query ──
  const { data: modules = [] } = useQuery({
    queryKey: ["platform-modules"],
    queryFn: platformListModules,
    enabled: open,
  });

  // ── Submit mutation ──
  const createMutation = useMutation({
    mutationFn: (payload: CreateOrgWizardPayload) =>
      platformCreateOrganizationWizard(payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["platform-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-kpis"] });
      toast.success("Organisation créée avec succès");
      onOpenChange(false);
      resetForm();
      if (result.organization_id) {
        navigate(`/platform/org/${result.organization_id}`);
      }
    },
    onError: (err) => {
      toast.error(
        `Erreur : ${err instanceof Error ? err.message : "Erreur inconnue"}`
      );
    },
  });

  const resetForm = () => {
    setStep(0);
    setOrgName("");
    setOrgType("");
    setEstName("");
    setEstType("restaurant");
    setProfile({
      legal_name: "",
      siret: "",
      contact_name: "",
      contact_email: "",
      contact_phone: "",
      address_line1: "",
      address_line2: "",
      postal_code: "",
      city: "",
      country: "FR",
      logo_url: "",
    });
    setSelectedModules(new Set());
  };

  const updateProfile = (field: string, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  // ── Logo upload ──
  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Le fichier doit être une image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("L'image ne doit pas dépasser 2 Mo");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const tempId = crypto.randomUUID();
      const path = `establishments/${tempId}/logo.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("establishment-logos")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from("establishment-logos")
        .getPublicUrl(path);
      updateProfile("logo_url", `${urlData.publicUrl}?t=${Date.now()}`);
      toast.success("Logo uploadé");
    } catch (err) {
      toast.error(
        `Erreur upload : ${err instanceof Error ? err.message : "Erreur"}`
      );
    } finally {
      setUploading(false);
    }
  };

  const toggleModule = (key: string) => {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Validation ──
  const canProceed = () => {
    if (step === 0) return orgName.trim().length > 0;
    if (step === 1) return estName.trim().length > 0;
    return true; // modules step is optional
  };

  const handleSubmit = () => {
    const payload: CreateOrgWizardPayload = {
      org_name: orgName.trim(),
      org_type: orgType || undefined,
      est_name: estName.trim(),
      est_type: estType,
      profile,
      modules: selectedModules.size > 0 ? [...selectedModules] : undefined,
    };
    createMutation.mutate(payload);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Nouvelle organisation</DialogTitle>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 pb-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  i === step
                    ? "bg-primary text-primary-foreground"
                    : i < step
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span>{s.icon}</span>
                )}
                {s.label}
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-6 h-px bg-border" />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="space-y-4 pt-2">
          {step === 0 && <StepOrganisation
            orgName={orgName}
            setOrgName={setOrgName}
            orgType={orgType}
            setOrgType={setOrgType}
          />}

          {step === 1 && <StepEstablishment
            estName={estName}
            setEstName={setEstName}
            estType={estType}
            setEstType={setEstType}
            profile={profile}
            updateProfile={updateProfile}
            uploading={uploading}
            fileInputRef={fileInputRef}
            onLogoUpload={handleLogoUpload}
          />}

          {step === 2 && <StepModules
            modules={modules}
            selected={selectedModules}
            onToggle={toggleModule}
          />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            className="gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Précédent
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              size="sm"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed()}
              className="gap-1.5"
            >
              Suivant <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={createMutation.isPending || !canProceed()}
              className="gap-1.5"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Créer l'organisation
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 1: Organisation
// ────────────────────────────────────────────────────────────────
function StepOrganisation({
  orgName,
  setOrgName,
  orgType,
  setOrgType,
}: {
  orgName: string;
  setOrgName: (v: string) => void;
  orgType: string;
  setOrgType: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Créez une nouvelle organisation. Le type est optionnel et n'est pas hérité par les établissements.
      </p>
      <div className="space-y-2">
        <Label htmlFor="wiz-org-name">Nom de l'organisation *</Label>
        <Input
          id="wiz-org-name"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Ex: Groupe Sapori"
          maxLength={200}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="wiz-org-type">Type d'organisation (optionnel)</Label>
        <Select value={orgType} onValueChange={setOrgType}>
          <SelectTrigger id="wiz-org-type">
            <SelectValue placeholder="Sélectionner…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="restaurant">Restaurant</SelectItem>
            <SelectItem value="fournisseur">Fournisseur</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 2: Établissement (Fiche officielle)
// ────────────────────────────────────────────────────────────────
function StepEstablishment({
  estName,
  setEstName,
  estType,
  setEstType,
  profile,
  updateProfile,
  uploading,
  fileInputRef,
  onLogoUpload,
}: {
  estName: string;
  setEstName: (v: string) => void;
  estType: string;
  setEstType: (v: string) => void;
  profile: Record<string, string>;
  updateProfile: (field: string, value: string) => void;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onLogoUpload: (file: File) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Fiche officielle de l'établissement — source de vérité pour BL, factures et documents.
      </p>

      {/* Logo */}
      <div className="flex items-center gap-4">
        {profile.logo_url ? (
          <div className="relative group">
            <img
              src={profile.logo_url}
              alt="Logo"
              className="w-16 h-16 rounded-lg object-contain border bg-white"
            />
            <button
              type="button"
              className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => updateProfile("logo_url", "")}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="w-16 h-16 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-muted-foreground/40" />
          </div>
        )}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ImagePlus className="w-3.5 h-3.5" />
            )}
            {uploading ? "Upload..." : "Logo"}
          </Button>
          <p className="text-xs text-muted-foreground mt-1">PNG, JPG. Max 2 Mo.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLogoUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Name + Type */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Nom établissement *</Label>
          <Input
            value={estName}
            onChange={(e) => setEstName(e.target.value)}
            placeholder="Ex: Sapori Miei"
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Type établissement</Label>
          <Select value={estType} onValueChange={setEstType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="restaurant">Restaurant</SelectItem>
              <SelectItem value="fournisseur">Fournisseur</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Legal */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Raison sociale</Label>
          <Input
            value={profile.legal_name}
            onChange={(e) => updateProfile("legal_name", e.target.value)}
            placeholder="SAS Magnifiko"
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label>N° SIRET</Label>
          <Input
            value={profile.siret}
            onChange={(e) => updateProfile("siret", e.target.value)}
            placeholder="123 456 789 00012"
            maxLength={20}
          />
        </div>
      </div>

      {/* Contact */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Contact</Label>
          <Input
            value={profile.contact_name}
            onChange={(e) => updateProfile("contact_name", e.target.value)}
            placeholder="Prénom Nom"
            maxLength={100}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input
            type="email"
            value={profile.contact_email}
            onChange={(e) => updateProfile("contact_email", e.target.value)}
            placeholder="contact@example.com"
            maxLength={255}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Téléphone</Label>
          <Input
            value={profile.contact_phone}
            onChange={(e) => updateProfile("contact_phone", e.target.value)}
            placeholder="01 23 45 67 89"
            maxLength={20}
          />
        </div>
      </div>

      {/* Address */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Adresse</Label>
          <Input
            value={profile.address_line1}
            onChange={(e) => updateProfile("address_line1", e.target.value)}
            placeholder="12 rue de la Paix"
            maxLength={200}
          />
        </div>
        <Input
          value={profile.address_line2}
          onChange={(e) => updateProfile("address_line2", e.target.value)}
          placeholder="Bâtiment A (optionnel)"
          maxLength={200}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            value={profile.postal_code}
            onChange={(e) => updateProfile("postal_code", e.target.value)}
            placeholder="75001"
            maxLength={10}
          />
          <Input
            value={profile.city}
            onChange={(e) => updateProfile("city", e.target.value)}
            placeholder="Paris"
            maxLength={100}
          />
          <Input
            value={profile.country}
            onChange={(e) => updateProfile("country", e.target.value)}
            placeholder="FR"
            maxLength={5}
          />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 3: Modules (with bundle support)
// ────────────────────────────────────────────────────────────────
import { MODULE_BUNDLES } from "@/lib/platform/moduleBundles";

function StepModules({
  modules,
  selected,
  onToggle,
}: {
  modules: PlatformModuleRow[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const handleBundleToggle = (bundleKeys: string[], activate: boolean) => {
    for (const key of bundleKeys) {
      const isSelected = selected.has(key);
      if (activate && !isSelected) onToggle(key);
      if (!activate && isSelected) onToggle(key);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sélectionnez les modules à activer pour cet établissement.
      </p>

      {/* Bundles */}
      {MODULE_BUNDLES.map((bundle) => {
        const allActive = bundle.moduleKeys.every((k) => selected.has(k));
        const someActive = bundle.moduleKeys.some((k) => selected.has(k));
        const activeCount = bundle.moduleKeys.filter((k) => selected.has(k)).length;

        return (
          <div
            key={bundle.id}
            className={`rounded-lg border p-3 transition-colors ${
              allActive
                ? "border-primary/40 bg-primary/[0.05]"
                : "border-border"
            }`}
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={allActive}
                className="mt-0.5"
                onCheckedChange={(checked) =>
                  handleBundleToggle(bundle.moduleKeys, !!checked)
                }
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {bundle.icon} {bundle.label}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {activeCount}/{bundle.moduleKeys.length}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {bundle.description}
                </p>
              </div>
            </label>
          </div>
        );
      })}

      {/* Separator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="flex-1 h-px bg-border" />
        <span>Modules individuels</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {modules.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <Blocks className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Aucun module global disponible pour le moment.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {modules.map((mod) => (
            <label
              key={mod.key}
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                checked={selected.has(mod.key)}
                onCheckedChange={() => onToggle(mod.key)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{mod.name}</p>
                {mod.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
