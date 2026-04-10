/**
 * SelfieConsentDialog -- RGPD-03 / I-013
 *
 * Dialog de consentement RGPD pour la capture de selfie lors du pointage.
 * Conformement a l'Art. 9.2.a du RGPD, le consentement explicite est requis
 * avant toute collecte de donnees potentiellement biometriques (photo/selfie).
 *
 * Le consentement est stocke dans localStorage sous la cle "selfie-consent".
 * L'employe peut :
 * - Accepter : le selfie est capture normalement
 * - Refuser : le pointage se fait sans selfie
 *
 * Le consentement peut etre retire a tout moment via les parametres.
 */

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Camera, ShieldCheck } from "lucide-react";

const SELFIE_CONSENT_KEY = "selfie-consent";

export type SelfieConsentStatus = "accepted" | "refused" | "pending";

/**
 * Verifie si l'utilisateur a deja donne son consentement pour le selfie.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getSelfieConsentStatus(): SelfieConsentStatus {
  const stored = localStorage.getItem(SELFIE_CONSENT_KEY);
  if (stored === "accepted") return "accepted";
  if (stored === "refused") return "refused";
  return "pending";
}

/**
 * Enregistre le consentement selfie dans localStorage.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function setSelfieConsent(accepted: boolean): void {
  localStorage.setItem(SELFIE_CONSENT_KEY, accepted ? "accepted" : "refused");
}

/**
 * Reinitialise le consentement (pour permettre a l'utilisateur de re-choisir).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function resetSelfieConsent(): void {
  localStorage.removeItem(SELFIE_CONSENT_KEY);
}

interface SelfieConsentDialogProps {
  open: boolean;
  onAccept: () => void;
  onRefuse: () => void;
}

export function SelfieConsentDialog({ open, onAccept, onRefuse }: SelfieConsentDialogProps) {
  const handleAccept = () => {
    setSelfieConsent(true);
    onAccept();
  };

  const handleRefuse = () => {
    setSelfieConsent(false);
    onRefuse();
  };

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Camera className="h-5 w-5 text-primary" />
            </div>
            <AlertDialogTitle className="text-left">Selfie de pointage</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-left space-y-3">
            <p>
              Votre etablissement utilise la verification par selfie lors du pointage. Avant
              d'activer la camera, nous avons besoin de votre consentement.
            </p>
            <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Finalite :</strong> Verification visuelle de votre identite lors du
                  pointage.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Stockage :</strong> La photo n'est pas conservee de maniere permanente.
                  Elle sert uniquement a la verification au moment du pointage.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Vos droits :</strong> Vous pouvez refuser ou retirer votre consentement a
                  tout moment. Le pointage restera possible sans selfie.
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Base legale : Art. 9.2.a RGPD (consentement explicite pour donnees potentiellement
              biometriques).
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleRefuse} aria-label="Refuser le consentement selfie">
            Refuser le selfie
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleAccept} aria-label="Accepter le consentement selfie">
            Accepter
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
