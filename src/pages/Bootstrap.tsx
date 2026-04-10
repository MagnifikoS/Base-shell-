import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";
import { bootstrapSchema } from "@/lib/schemas/auth";
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator";
import type { ZodError } from "zod";

export default function Bootstrap() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    checkAdminExists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAdminExists = async () => {
    try {
      const { data, error } = await supabase.rpc("admin_exists");

      if (error) {
        if (import.meta.env.DEV) console.error("Erreur vérification admin:", error);
        setChecking(false);
        return;
      }

      if (data === true) {
        navigate("/auth", { replace: true });
      } else {
        setChecking(false);
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("Erreur:", error);
      setChecking(false);
    }
  };

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const result = bootstrapSchema.safeParse({
      organizationName: organizationName.trim(),
      fullName: fullName.trim(),
      email: email.trim(),
      password,
    });
    if (!result.success) {
      const errors: Record<string, string> = {};
      (result.error as ZodError).issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }

    setLoading(true);

    try {
      const response = await supabase.functions.invoke("bootstrap-admin", {
        body: {
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          organizationName: organizationName.trim(),
        },
      });

      if (response.error) {
        toast.error(response.error.message || "Erreur lors de la création");
        setLoading(false);
        return;
      }

      if (response.data?.error) {
        toast.error(response.data.error);
        setLoading(false);
        return;
      }

      toast.success("Administrateur créé avec succès. Vous pouvez maintenant vous connecter.");
      navigate("/auth", { replace: true });
    } catch (error) {
      if (import.meta.env.DEV) console.error("Erreur bootstrap:", error);
      toast.error("Erreur lors de la création");
    }

    setLoading(false);
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <Building2 className="w-7 h-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Premier lancement</CardTitle>
          <CardDescription>Créez votre organisation et votre compte administrateur</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleBootstrap}
            className="space-y-4"
            aria-label="Création du compte administrateur"
          >
            <div className="space-y-2">
              <Label htmlFor="org-name">Nom de l'organisation</Label>
              <Input
                id="org-name"
                type="text"
                value={organizationName}
                onChange={(e) => {
                  setOrganizationName(e.target.value);
                  clearFieldError("organizationName");
                }}
                placeholder="Ma Société"
                required
                maxLength={100}
                className={fieldErrors.organizationName ? "border-destructive" : ""}
              />
              {fieldErrors.organizationName && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.organizationName}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="full-name">Votre nom complet</Label>
              <Input
                id="full-name"
                type="text"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  clearFieldError("fullName");
                }}
                placeholder="Jean Dupont"
                required
                maxLength={100}
                className={fieldErrors.fullName ? "border-destructive" : ""}
              />
              {fieldErrors.fullName && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.fullName}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError("email");
                }}
                placeholder="admin@example.com"
                required
                maxLength={255}
                className={fieldErrors.email ? "border-destructive" : ""}
              />
              {fieldErrors.email && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.email}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError("password");
                }}
                required
                minLength={8}
                className={fieldErrors.password ? "border-destructive" : ""}
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.password}</p>
              )}
              <PasswordStrengthIndicator password={password} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Création en cours...
                </>
              ) : (
                "Créer l'administrateur"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
