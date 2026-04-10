import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Building2, Loader2, ArrowLeft } from "lucide-react";
import { loginSchema, resetPasswordSchema } from "@/lib/schemas/auth";
import type { ZodError } from "zod";

export default function Auth() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resetFieldErrors, setResetFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    checkAdminExists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAdminExists = async () => {
    try {
      // PERF: Skip RPC if already confirmed in this session
      const cached = sessionStorage.getItem("admin_exists_confirmed");
      if (cached === "true") {
        setChecking(false);
        return;
      }

      const { data } = await supabase.rpc("admin_exists");
      if (data === false) {
        navigate("/bootstrap", { replace: true });
      } else {
        // Cache positive result — admin existence is permanent
        try {
          sessionStorage.setItem("admin_exists_confirmed", "true");
        } catch {
          // sessionStorage unavailable, no-op
        }
        setChecking(false);
      }
    } catch {
      setChecking(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const result = loginSchema.safeParse({ email, password });
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

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error(error.message);
    } else {
      navigate("/", { replace: true });
    }
    setLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetFieldErrors({});

    const result = resetPasswordSchema.safeParse({ email: resetEmail.trim() });
    if (!result.success) {
      const errors: Record<string, string> = {};
      (result.error as ZodError).issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setResetFieldErrors(errors);
      return;
    }

    setResetLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: window.location.origin + "/auth",
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Un email de réinitialisation vous a été envoyé");
      setShowForgotPassword(false);
      setResetEmail("");
    }

    setResetLoading(false);
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
          <CardTitle className="text-2xl">GestionPro</CardTitle>
          <CardDescription>
            {showForgotPassword
              ? "Réinitialisation du mot de passe"
              : "Connectez-vous à votre compte"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {showForgotPassword ? (
            <>
              <form
                onSubmit={handleResetPassword}
                className="space-y-4"
                aria-label="Réinitialisation du mot de passe"
              >
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    value={resetEmail}
                    onChange={(e) => {
                      setResetEmail(e.target.value);
                      setResetFieldErrors((prev) => {
                        const n = { ...prev };
                        delete n.email;
                        return n;
                      });
                    }}
                    placeholder="votre@email.com"
                    className={resetFieldErrors.email ? "border-destructive" : ""}
                    required
                  />
                  {resetFieldErrors.email && (
                    <p className="text-sm text-destructive mt-1">{resetFieldErrors.email}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Saisissez l'adresse email associée à votre compte. Vous recevrez un lien pour
                    réinitialiser votre mot de passe.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={resetLoading}>
                  {resetLoading ? "Envoi en cours..." : "Envoyer le lien de réinitialisation"}
                </Button>
              </form>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetEmail("");
                  }}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Retour à la connexion
                </button>
              </div>
            </>
          ) : (
            <>
              <form onSubmit={handleLogin} className="space-y-4" aria-label="Connexion">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldErrors((prev) => {
                        const n = { ...prev };
                        delete n.email;
                        return n;
                      });
                    }}
                    className={fieldErrors.email ? "border-destructive" : ""}
                    required
                  />
                  {fieldErrors.email && (
                    <p className="text-sm text-destructive mt-1">{fieldErrors.email}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Mot de passe</Label>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(true);
                        setResetEmail(email);
                      }}
                      className="text-xs text-muted-foreground hover:text-primary underline transition-colors"
                    >
                      Mot de passe oublié ?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFieldErrors((prev) => {
                        const n = { ...prev };
                        delete n.password;
                        return n;
                      });
                    }}
                    className={fieldErrors.password ? "border-destructive" : ""}
                    required
                  />
                  {fieldErrors.password && (
                    <p className="text-sm text-destructive mt-1">{fieldErrors.password}</p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Chargement..." : "Se connecter"}
                </Button>
              </form>
              <div className="mt-4 text-center">
                <Link
                  to="/politique-confidentialite"
                  className="text-xs text-muted-foreground hover:text-primary underline"
                >
                  Politique de confidentialite
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
