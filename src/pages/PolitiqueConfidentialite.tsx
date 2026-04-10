import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Politique de confidentialite -- Page publique (accessible sans authentification)
 *
 * Conforme au RGPD (Art. 13 et 14) -- Information des personnes concernees
 *
 * RGPD-07 / I-017
 */
export default function PolitiqueConfidentialite() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header avec retour */}
      <div className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/auth">
            <Button variant="ghost" size="icon" aria-label="Retour">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-semibold text-foreground">Politique de confidentialite</h1>
        </div>
      </div>

      {/* Contenu */}
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Introduction */}
        <section className="space-y-3">
          <p className="text-muted-foreground leading-relaxed">
            La presente politique de confidentialite decrit comment Restaurant OS (ci-apres
            "l'Application") collecte, utilise et protege vos donnees personnelles conformement au
            Reglement General sur la Protection des Donnees (RGPD -- Reglement UE 2016/679).
          </p>
          <p className="text-sm text-muted-foreground">Derniere mise a jour : 14 fevrier 2026</p>
        </section>

        {/* 1. Responsable du traitement */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">1. Responsable du traitement</h2>
          <p className="text-muted-foreground leading-relaxed">
            Le responsable du traitement est l'entreprise utilisant l'Application Restaurant OS pour
            la gestion de son ou ses etablissements de restauration. Pour toute question relative a
            la protection de vos donnees, veuillez contacter l'administrateur de votre
            etablissement.
          </p>
        </section>

        {/* 2. Donnees collectees */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            2. Donnees personnelles collectees
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Dans le cadre de son fonctionnement, l'Application collecte les categories de donnees
            suivantes :
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
            <li>
              <strong className="text-foreground">Donnees d'identification :</strong> nom, prenom,
              adresse email, numero de telephone
            </li>
            <li>
              <strong className="text-foreground">Donnees contractuelles :</strong> type de contrat,
              role, date d'embauche, etablissement de rattachement
            </li>
            <li>
              <strong className="text-foreground">Donnees financieres :</strong> IBAN, numero de
              securite sociale (chiffrees AES-256-GCM)
            </li>
            <li>
              <strong className="text-foreground">Donnees de pointage :</strong> heures d'arrivee et
              de depart, type de pointage
            </li>
            <li>
              <strong className="text-foreground">Donnees de paie :</strong> salaire brut/net,
              heures supplementaires, conges, absences
            </li>
            <li>
              <strong className="text-foreground">Donnees d'authentification :</strong> adresse
              email, mot de passe hashe, sessions
            </li>
            <li>
              <strong className="text-foreground">Photo (selfie) :</strong> si le selfie d'arrivee
              est active, une photo peut etre prise lors du pointage (soumis a votre consentement
              prealable)
            </li>
          </ul>
        </section>

        {/* 3. Bases legales */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">3. Bases legales du traitement</h2>
          <p className="text-muted-foreground leading-relaxed">
            Vos donnees sont traitees sur les bases legales suivantes (Art. 6 RGPD) :
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
            <li>
              <strong className="text-foreground">Execution du contrat de travail</strong> (Art.
              6.1.b) : gestion des employes, conges, plannings
            </li>
            <li>
              <strong className="text-foreground">Obligation legale</strong> (Art. 6.1.c) : pointage
              (Code du travail Art. L3171-2), paie, declarations sociales, obligations comptables
            </li>
            <li>
              <strong className="text-foreground">Interet legitime</strong> (Art. 6.1.f) :
              planification, extraction IA des factures
            </li>
            <li>
              <strong className="text-foreground">Consentement</strong> (Art. 9.2.a) : selfie de
              pointage (donnee potentiellement biometrique)
            </li>
          </ul>
        </section>

        {/* 4. Durees de conservation */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">4. Durees de conservation</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium text-foreground">Donnees</th>
                  <th className="text-left p-3 font-medium text-foreground">Duree</th>
                  <th className="text-left p-3 font-medium text-foreground">Fondement</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="p-3 text-muted-foreground">Donnees employes</td>
                  <td className="p-3 text-muted-foreground">Contrat + 5 ans</td>
                  <td className="p-3 text-muted-foreground">Prescription legale</td>
                </tr>
                <tr>
                  <td className="p-3 text-muted-foreground">Pointage</td>
                  <td className="p-3 text-muted-foreground">5 ans</td>
                  <td className="p-3 text-muted-foreground">Prescription sociale</td>
                </tr>
                <tr>
                  <td className="p-3 text-muted-foreground">Paie</td>
                  <td className="p-3 text-muted-foreground">5 ans</td>
                  <td className="p-3 text-muted-foreground">Art. L3245-1 Code du travail</td>
                </tr>
                <tr>
                  <td className="p-3 text-muted-foreground">Conges et absences</td>
                  <td className="p-3 text-muted-foreground">Contrat + 3 ans</td>
                  <td className="p-3 text-muted-foreground">Prescription</td>
                </tr>
                <tr>
                  <td className="p-3 text-muted-foreground">Factures</td>
                  <td className="p-3 text-muted-foreground">10 ans</td>
                  <td className="p-3 text-muted-foreground">Art. L123-22 Code de commerce</td>
                </tr>
                <tr>
                  <td className="p-3 text-muted-foreground">Planning</td>
                  <td className="p-3 text-muted-foreground">Annee en cours + 1 an</td>
                  <td className="p-3 text-muted-foreground">Interet legitime</td>
                </tr>
                <tr>
                  <td className="p-3 text-muted-foreground">Images Vision AI</td>
                  <td className="p-3 text-muted-foreground">Supprimees apres traitement</td>
                  <td className="p-3 text-muted-foreground">Minimisation (Art. 5.1.c)</td>
                </tr>
                <tr>
                  <td className="p-3 text-muted-foreground">Selfie de pointage</td>
                  <td className="p-3 text-muted-foreground">Non persiste</td>
                  <td className="p-3 text-muted-foreground">Consentement</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 5. Securite */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">5. Mesures de securite</h2>
          <p className="text-muted-foreground leading-relaxed">
            Nous mettons en oeuvre les mesures techniques et organisationnelles suivantes pour
            proteger vos donnees (Art. 32 RGPD) :
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
            <li>Chiffrement AES-256-GCM pour les donnees sensibles (IBAN, N. SS)</li>
            <li>Chiffrement TLS pour toutes les communications</li>
            <li>Authentification par JWT avec expiration</li>
            <li>Controle d'acces base sur les roles (RBAC) avec permissions granulaires</li>
            <li>Row Level Security (RLS) au niveau de la base de donnees</li>
            <li>Mots de passe hashes (bcrypt)</li>
            <li>Principe du moindre privilege pour l'acces aux donnees</li>
          </ul>
        </section>

        {/* 6. Sous-traitants */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            6. Sous-traitants et transferts hors UE
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            L'Application fait appel aux sous-traitants suivants :
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
            <li>
              <strong className="text-foreground">Supabase :</strong> hebergement des donnees et
              authentification. Localisation : a verifier selon la configuration du projet (UE
              recommande).
            </li>
            <li>
              <strong className="text-foreground">OpenAI :</strong> extraction IA des donnees de
              factures uniquement (pas de donnees personnelles). Siege aux Etats-Unis -- transfert
              couvert par les Clauses Contractuelles Types (SCC).
            </li>
          </ul>
        </section>

        {/* 7. Droits */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">7. Vos droits</h2>
          <p className="text-muted-foreground leading-relaxed">
            Conformement au RGPD, vous disposez des droits suivants sur vos donnees personnelles :
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
            <li>
              <strong className="text-foreground">Droit d'acces</strong> (Art. 15) : obtenir une
              copie de vos donnees personnelles
            </li>
            <li>
              <strong className="text-foreground">Droit de rectification</strong> (Art. 16) :
              corriger des donnees inexactes ou incompletes
            </li>
            <li>
              <strong className="text-foreground">Droit a l'effacement</strong> (Art. 17) : demander
              la suppression de vos donnees (sous reserve des obligations legales de conservation)
            </li>
            <li>
              <strong className="text-foreground">Droit a la limitation</strong> (Art. 18) : limiter
              le traitement de vos donnees
            </li>
            <li>
              <strong className="text-foreground">Droit a la portabilite</strong> (Art. 20) :
              recevoir vos donnees dans un format structure (JSON/CSV)
            </li>
            <li>
              <strong className="text-foreground">Droit d'opposition</strong> (Art. 21) : vous
              opposer au traitement base sur l'interet legitime
            </li>
            <li>
              <strong className="text-foreground">Retrait du consentement</strong> (Art. 7.3) :
              retirer votre consentement a tout moment (ex: selfie de pointage)
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-3">
            Pour exercer vos droits, adressez-vous a l'administrateur de votre etablissement. En cas
            de litige, vous pouvez introduire une reclamation aupres de la CNIL (Commission
            Nationale de l'Informatique et des Libertes) -- www.cnil.fr.
          </p>
        </section>

        {/* 8. Cookies */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">8. Cookies et stockage local</h2>
          <p className="text-muted-foreground leading-relaxed">
            L'Application utilise le stockage local du navigateur (localStorage) pour des finalites
            strictement necessaires au fonctionnement du service : preferences d'affichage,
            selection d'etablissement, consentement selfie. Aucun cookie de tracking ou publicitaire
            n'est utilise.
          </p>
        </section>

        {/* 9. Contact */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">9. Contact</h2>
          <p className="text-muted-foreground leading-relaxed">
            Pour toute question concernant cette politique de confidentialite ou le traitement de
            vos donnees personnelles, contactez l'administrateur de votre etablissement ou ecrivez a
            l'adresse indiquee dans les mentions legales de l'Application.
          </p>
        </section>

        {/* Footer */}
        <div className="border-t pt-6 mt-8">
          <p className="text-xs text-muted-foreground text-center">
            Cette politique de confidentialite est conforme au Reglement General sur la Protection
            des Donnees (RGPD -- Reglement UE 2016/679) et a la loi Informatique et Libertes du 6
            janvier 1978 modifiee.
          </p>
        </div>
      </div>
    </div>
  );
}
