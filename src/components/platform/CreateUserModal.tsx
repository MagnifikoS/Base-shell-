/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CreateUserModal — Platform Super Admin: create a user for an establishment
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, UserPlus, AlertTriangle, Info } from "lucide-react";
import { filterAssignableRoles } from "@/lib/roles";

interface CreateUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  establishmentId: string;
  establishmentName: string;
}

interface RoleOption {
  id: string;
  name: string;
  type: string;
}

export function CreateUserModal({
  open,
  onOpenChange,
  organizationId,
  establishmentId,
  establishmentName,
}: CreateUserModalProps) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ email: string; password: string; fullName: string; roleName: string } | null>(null);

  // Fetch assignable roles (system + org-specific)
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ["platform-roles-for-creation", organizationId],
    queryFn: async () => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "list_roles" },
      });
      if (response.error) throw response.error;
      return filterAssignableRoles(response.data.roles as RoleOption[]);
    },
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  // Auto-select highest role (Administrateur) on first load
  const defaultRole = roles.find((r: RoleOption) => r.name === "Administrateur") ?? roles[0];

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPassword("");
    setRoleId("");
    setResult(null);
  };

  const handleClose = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast.error("Veuillez remplir tous les champs obligatoires");
      return;
    }

    const selectedRoleId = roleId || defaultRole?.id;
    if (!selectedRoleId) {
      toast.error("Veuillez sélectionner un rôle");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await supabase.functions.invoke("platform-create-user", {
        body: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim().toLowerCase(),
          password: password || undefined,
          role_id: selectedRoleId,
          organization_id: organizationId,
          establishment_id: establishmentId,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erreur lors de la création");
      }

      const data = response.data;
      if (!data?.success) {
        throw new Error(data?.error || "Erreur inconnue");
      }

      setResult({
        email: data.email,
        password: data.temp_password,
        fullName: data.full_name,
        roleName: data.role_name,
      });

      // Refresh user list
      queryClient.invalidateQueries({ queryKey: ["platform-establishment-users", establishmentId] });
      toast.success(`Compte créé pour ${data.full_name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copié`);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Créer un compte utilisateur
          </DialogTitle>
          <DialogDescription>
            {establishmentName} — Ce compte pourra se connecter immédiatement.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          /* ═══ SUCCESS VIEW ═══ */
          <div className="space-y-4">
            <Alert className="border-green-500/30 bg-green-50 dark:bg-green-950/20">
              <AlertDescription className="space-y-3">
                <p className="font-medium text-green-800 dark:text-green-200">
                  ✅ Compte créé avec succès
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Nom :</span>
                    <span className="font-medium">{result.fullName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Rôle :</span>
                    <span className="font-medium">{result.roleName}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Email :</span>
                    <div className="flex items-center gap-1">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{result.email}</code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(result.email, "Email")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Mot de passe :</span>
                    <div className="flex items-center gap-1">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{result.password}</code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(result.password, "Mot de passe")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <Alert>
              <Info className="w-4 h-4" />
              <AlertDescription>
                Conservez ces identifiants. Plus tard, l'invitation par email remplacera ce mode de création.
              </AlertDescription>
            </Alert>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { resetForm(); }}>
                Créer un autre
              </Button>
              <Button onClick={() => handleClose(false)}>
                Fermer
              </Button>
            </div>
          </div>
        ) : (
          /* ═══ FORM VIEW ═══ */
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                V0 : Création directe avec mot de passe. L'invitation email sera ajoutée ultérieurement.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">Prénom *</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jean"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Nom *</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Dupont"
                  maxLength={100}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jean.dupont@example.com"
                maxLength={255}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe (optionnel — auto-généré si vide)</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 caractères"
                  maxLength={128}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Rôle *</Label>
              {rolesLoading ? (
                <div className="h-10 bg-muted animate-pulse rounded-md" />
              ) : (
                <Select value={roleId || defaultRole?.id || ""} onValueChange={setRoleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un rôle" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r: RoleOption) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Annuler
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Création..." : "Créer le compte"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
