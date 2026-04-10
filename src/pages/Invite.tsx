import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { inviteSchema } from "@/lib/schemas/auth";
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator";
import type { ZodError } from "zod";

// SEC-12: Extract token from hash fragment (#token=...) to avoid server-side logging.
// Falls back to query parameter (?token=...) for backwards compatibility with existing links.
function useInviteToken(): string | null {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Prefer hash fragment (new, secure format)
  const hash = location.hash; // e.g. "#token=abc123"
  if (hash) {
    const hashParams = new URLSearchParams(hash.slice(1)); // remove leading '#'
    const hashToken = hashParams.get("token");
    if (hashToken) return hashToken;
  }

  // Fallback: query parameter (old format, for backwards compat with existing invitation links)
  return searchParams.get("token");
}

export default function Invite() {
  const navigate = useNavigate();
  const token = useInviteToken();

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) {
      setError("Lien d'invitation invalide. Veuillez vérifier votre email.");
    }
  }, [token]);

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!token) {
      setError("Token manquant");
      return;
    }

    const result = inviteSchema.safeParse({
      fullName: fullName.trim(),
      password,
      confirmPassword,
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

    setIsSubmitting(true);

    try {
      const response = await supabase.functions.invoke("accept-invitation", {
        body: {
          token,
          password,
          full_name: fullName.trim(),
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Erreur lors de la création du compte");
      }

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      setIsSuccess(true);
      toast.success("Compte créé avec succès !");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Une erreur est survenue";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="h-16 w-16 text-green-500 dark:text-green-400 mx-auto mb-4" />
            <CardTitle>Compte créé !</CardTitle>
            <CardDescription>
              Votre compte a été créé avec succès. Un administrateur doit maintenant valider votre
              accès.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Vous recevrez une notification lorsque votre compte sera activé.
            </p>
            <Button onClick={() => navigate("/auth")} variant="outline">
              Retour à la connexion
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <CardTitle>Lien invalide</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate("/auth")} variant="outline">
              Retour à la connexion
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Créer votre compte</CardTitle>
          <CardDescription>
            Vous avez été invité à rejoindre l'organisation. Veuillez compléter votre inscription.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" aria-label="Création de compte">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="fullName">Nom complet *</Label>
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  clearFieldError("fullName");
                }}
                placeholder="Jean Dupont"
                maxLength={100}
                required
                disabled={isSubmitting}
                className={fieldErrors.fullName ? "border-destructive" : ""}
              />
              {fieldErrors.fullName && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.fullName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe *</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError("password");
                }}
                placeholder="••••••••"
                minLength={8}
                required
                disabled={isSubmitting}
                className={fieldErrors.password ? "border-destructive" : ""}
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.password}</p>
              )}
              <PasswordStrengthIndicator password={password} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmer le mot de passe *</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  clearFieldError("confirmPassword");
                }}
                placeholder="••••••••"
                required
                disabled={isSubmitting}
                className={fieldErrors.confirmPassword ? "border-destructive" : ""}
              />
              {fieldErrors.confirmPassword && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.confirmPassword}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={
                isSubmitting ||
                !fullName.trim() ||
                password.length < 8 ||
                password !== confirmPassword
              }
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Créer mon compte
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
