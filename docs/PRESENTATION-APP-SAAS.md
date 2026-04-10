# Restaurant OS — Présentation complète de l'application

> Application SaaS de gestion complète pour la restauration.
> Multi-établissements, multi-utilisateurs, accessible sur desktop et mobile.

---

## Vue d'ensemble

Restaurant OS est une plateforme tout-en-un qui couvre l'ensemble des besoins opérationnels d'un ou plusieurs restaurants : gestion des équipes, planification, pointage, paie, gestion des stocks, commandes fournisseurs, facturation, caisse, recettes et pilotage intelligent.

L'application est organisée en **modules indépendants**, chacun activable par établissement. Les accès sont contrôlés par un système de rôles et permissions granulaire (par module, par niveau d'accès, par périmètre).

---

## 1. Dashboard

- **Tableau de bord** de l'établissement actif
- Vue synthétique des indicateurs clés du jour
- Accès rapide aux modules les plus utilisés

### Dashboard Organisation (admin)
- Vue consolidée multi-établissements
- Comparaison des performances entre restaurants

---

## 2. Planning

- **Création et gestion des plannings** hebdomadaires par établissement
- Affectation des salariés aux créneaux horaires (shifts)
- Vue par jour, par semaine, par salarié
- Sous-onglets :
  - **Général** — Vue globale du planning
  - **Hebdomadaire** — Détail semaine par semaine
  - **Mensuel** — Vue calendrier mensuelle
  - **Templates** — Modèles de planning réutilisables
  - **Synthèse** — Résumé des heures planifiées
- Publication automatique programmable (heure configurable par établissement)

---

## 3. Salariés

- **Fiche salarié complète** : nom, prénom, coordonnées, adresse, poste
- Informations contractuelles : type de contrat (CDI, CDD…), dates de début/fin, heures contractuelles
- Données sensibles chiffrées : IBAN, numéro de sécurité sociale
- Documents employé : stockage sécurisé (pièces d'identité, contrats…)
- Sous-onglets :
  - **Liste** — Tous les salariés de l'établissement
  - **Détails** — Fiche individuelle complète

---

## 4. Badgeuse (Pointeuse)

- **Pointage d'entrée/sortie** des salariés
- Comparaison automatique avec le planning prévu
- Détection des **retards**, **départs anticipés** et **heures supplémentaires**
- Calcul du temps effectif travaillé
- Options configurables :
  - Tolérance d'arrivée/départ (en minutes)
  - Seuil d'heures supplémentaires
  - Limite d'arrivée anticipée
  - Obligation de selfie ou code PIN
  - Liaison à un appareil (device binding)

---

## 5. Présence

- **Suivi en temps réel** de la présence des salariés
- Sous-onglets :
  - **Présence du jour** — Qui est présent, absent, en retard
  - **Retards** — Historique et détail des retards
  - **Heures supplémentaires** — Suivi et validation
  - **Synthèse** — Bilan consolidé par période

---

## 6. Paie

- **Calcul automatique des salaires** selon la législation française
- Prise en compte de :
  - Heures contractuelles vs heures effectuées
  - Heures supplémentaires (seuil hebdomadaire, semaine civile lundi→dimanche)
  - Absences (déduites au taux horaire opérationnel)
  - Congés payés (comptabilisés mais non déduits du salaire)
- Gestion des salaires brut, net et charges patronales
- Export et récapitulatifs mensuels

---

## 7. Congés & Absences

- **Gestion des demandes de congés** et suivi des absences
- Sous-onglets :
  - **Absences** — Déclaration et suivi des absences (maladie, sans justificatif…)
  - **CP** — Compteur de congés payés (N et N-1)
- Validation par le responsable ou l'administrateur

---

## 8. Gestion du Personnel

- **Administration avancée** des ressources humaines
- Gestion des rôles et permissions par salarié
- Suivi des documents administratifs
- Pass Navigo (suivi remboursement transport)

---

## 9. Caisse

- **Saisie quotidienne du chiffre d'affaires**
- Ventilation par mode de paiement :
  - Espèces
  - Carte bancaire
  - Courses (livraison)
  - Livraison
  - Maintenance
- Calcul automatique de l'écart de caisse
- Notes et commentaires par jour
- Sous-onglets :
  - **Saisie** — Formulaire du jour
  - **Historique** — Consultation des jours passés

---

## 10. Rapports

- **Tableaux de bord financiers et opérationnels**
- Analyse des coûts de personnel vs chiffre d'affaires
- Suivi des ratios clés (masse salariale, food cost…)
- Exports CSV

---

## 11. Produits

- **Catalogue complet des produits** de l'établissement
- Fiche produit : nom, catégorie, unité de mesure, prix d'achat
- Gestion des **unités de mesure** et des **conversions** (kg ↔ pièce, L ↔ cL…)
- Seuils d'alerte de stock minimum
- Import/export de produits

---

## 12. Fournisseurs

- **Répertoire des fournisseurs** de l'établissement
- Fiche fournisseur : nom, contact, adresse, SIRET
- Association produits ↔ fournisseurs avec prix unitaires
- Historique des achats par fournisseur

---

## 13. Commandes

- **Création et suivi des commandes fournisseurs**
- Cycle de vie complet :
  1. **Brouillon** → création de la commande
  2. **Envoyée** → transmission au fournisseur
  3. **Ouverte** → prise en charge par le fournisseur
  4. **Expédiée** → préparation et envoi
  5. **Reçue** → réception et vérification
  6. **Terminée** → clôture
- Gestion des **litiges** et **retours**
- Numéro de commande automatique
- Notes et commentaires
- **Commandes de plats** (B2B entre établissements) — même cycle

---

## 14. Inventaire

- **Gestion complète du stock physique**
- Sous-modules accessibles :
  - **Stock** — Consultation en temps réel du stock par produit, avec seuils d'alerte et zones de stockage
  - **Inventaire Produit** — Comptage physique par zone de stockage (sessions d'inventaire démarrable, pausable, complétable)
  - **Réception** — Entrée de marchandise (lié aux commandes ou saisie libre)
  - **Retrait** — Sortie de marchandise (retrait interne ou transfert inter-établissements avec bon de livraison)
  - **Alertes** — Produits sous le seuil minimum de stock
- Traçabilité complète : chaque mouvement de stock est enregistré (entrée, sortie, ajustement, inventaire)
- Gestion des **zones de stockage** (chambre froide, réserve sèche, etc.)
- Détection des écarts entre stock théorique et stock physique

---

## 15. DLC Critique

- **Surveillance des dates limites de consommation**
- Alertes sur les produits proches de la péremption
- Paramétrage des seuils d'alerte par catégorie de produit
- Suivi des actions correctives

---

## 16. Factures

- **Gestion documentaire des factures fournisseurs**
- Archivage et consultation
- Lien avec les commandes et les bons de livraison
- Onglets :
  - Factures classiques
  - Bons de livraison (BL réception)
  - BL retraits (sorties inter-établissements)

---

## 17. Scan Facture (IA) — Vision AI

- **Extraction automatique des données** d'une facture fournisseur par intelligence artificielle
- Reconnaissance des produits, quantités, prix, fournisseur
- Matching intelligent avec le catalogue produit existant
- Apprentissage progressif (THE BRAIN) pour améliorer la reconnaissance
- Détection d'anomalies :
  - Variation de prix anormale
  - Quantité inhabituelle
  - Prix manquant
  - Produit rarement acheté

---

## 18. Achats (Récapitulatif)

- **Synthèse mensuelle des achats** par fournisseur
- Vue consolidée des dépenses
- Comparaison mois par mois

---

## 19. Clients B2B

- **Espace fournisseur** pour gérer les partenariats inter-établissements
- Catalogue de recettes B2B (plats finis commercialisables)
- Gestion des partenariats : invitation par code, activation, archivage
- Partage optionnel du stock avec les clients
- Vue commerciale uniquement (composition des recettes protégée)

---

## 20. Plats Fournisseurs

- **Espace client** pour consulter les recettes suivies d'un fournisseur partenaire
- Vue des plats disponibles : nom commercial, type, prix B2B, portions
- Commande de plats B2B intégrée au cycle de commandes

---

## 21. Recettes

- **Fiches techniques des recettes** du restaurant
- Composition : ingrédients, quantités, unités
- Calcul automatique du coût de revient
- Gestion des types de recettes
- Publication vers le catalogue B2B (optionnel)

---

## 22. Food Cost

- **Analyse du coût matière** par recette et par période
- Ratio food cost vs prix de vente
- Suivi de la rentabilité des plats

---

## 23. Plat du Jour

- **Planification du plat du jour**
- Sélection depuis les recettes existantes
- Affichage pour l'équipe

---

## 24. Pertes & Casse

- **Déclaration et suivi des pertes**
- Raisons : péremption, casse, vol, erreur…
- Impact automatique sur le stock
- Historique consultable

---

## 25. Marchandise (Finance)

- **Suivi de la consommation de marchandise** entre deux inventaires
- Calcul : Stock début + Entrées - Stock fin = Consommation
- Vue financière en euros

---

## 26. Alertes & Notifications

- **Centre de notifications** centralisé
- Alertes automatiques :
  - Stock sous seuil minimum
  - Commande à traiter
  - Facture en attente
  - DLC proche
  - Retards de pointage
- Notifications push (mobile)

---

## 27. Contexte & Événements

- **Gestion des événements** impactant l'activité
- Jours fériés, événements spéciaux, fermetures exceptionnelles
- Impact sur le planning et les prévisions

---

## 28. Assistant IA

- **Assistant intelligent** pour aide à la décision
- Analyse des données de l'établissement
- Recommandations opérationnelles

---

## 29. THE BRAIN (Moteur d'apprentissage)

- **Système d'apprentissage** intégré à l'extraction de factures
- Mémorisation des corrections utilisateur
- Règles automatiques de matching produit ↔ ligne facture
- Confirmations et corrections comptabilisées pour fiabiliser la reconnaissance

---

## Fonctionnalités transversales

### Multi-établissements
- Gestion de **plusieurs restaurants** dans une même organisation
- Basculement rapide entre établissements
- Données isolées par établissement, consolidables au niveau organisation

### Gestion des rôles et permissions
- Rôles personnalisables par établissement (Administrateur, Directeur, Salarié, Caissier, Inventaire, Responsable commande…)
- Permissions granulaires par module : aucun accès / lecture / écriture
- Périmètre configurable : soi-même / équipe / établissement / organisation
- Masquage de modules par rôle sur mobile

### Mobile
- **Application mobile complète** (web responsive + Capacitor pour natif)
- Interface adaptée tactile
- Vue simplifiée pour les salariés (grille d'icônes sans sidebar)
- Vue complète pour les administrateurs (sidebar + sections)
- Notifications push
- Mode hors-ligne partiel

### Horaires d'ouverture
- Configuration des horaires d'ouverture par jour de la semaine
- Gestion des exceptions (fermetures exceptionnelles, horaires modifiés)
- Jour de service avec heure de coupure configurable

### Pauses
- Politique de pause configurable par établissement
- Déduction automatique selon les règles définies

### Sécurité
- Chiffrement des données sensibles (IBAN, numéro de sécurité sociale)
- Contrôle d'accès par ligne (RLS) sur toutes les tables
- Authentification par email avec vérification
- Journal d'audit des actions sensibles

---

## Résumé des modules

| # | Module | Description courte |
|---|--------|-------------------|
| 1 | Dashboard | Tableau de bord synthétique |
| 2 | Planning | Planification des horaires |
| 3 | Salariés | Fiches et données employés |
| 4 | Badgeuse | Pointage entrée/sortie |
| 5 | Présence | Suivi temps réel |
| 6 | Paie | Calcul des salaires |
| 7 | Congés & Absences | Demandes et suivi |
| 8 | Gestion du Personnel | Administration RH avancée |
| 9 | Caisse | Chiffre d'affaires quotidien |
| 10 | Rapports | Analyses financières |
| 11 | Produits | Catalogue articles |
| 12 | Fournisseurs | Répertoire fournisseurs |
| 13 | Commandes | Commandes fournisseurs |
| 14 | Inventaire | Stock, comptage, réception, retrait |
| 15 | DLC Critique | Surveillance péremptions |
| 16 | Factures | Gestion documentaire |
| 17 | Vision AI | Scan factures par IA |
| 18 | Achats | Récapitulatif mensuel |
| 19 | Clients B2B | Partenariats fournisseur |
| 20 | Plats Fournisseurs | Catalogue recettes B2B |
| 21 | Recettes | Fiches techniques |
| 22 | Food Cost | Coût matière |
| 23 | Plat du Jour | Menu du jour |
| 24 | Pertes & Casse | Déclaration pertes |
| 25 | Marchandise | Consommation inter-inventaires |
| 26 | Alertes | Centre de notifications |
| 27 | Contexte | Événements et exceptions |
| 28 | Assistant IA | Aide à la décision |
| 29 | THE BRAIN | Apprentissage automatique |
