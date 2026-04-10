# Restaurant OS — Présentation de l'Application SaaS

> Document non technique — Description fonctionnelle complète de la plateforme

---

## 1. Vision & Identité

**Restaurant OS** est une plateforme SaaS tout-en-un dédiée à la **gestion complète d'un restaurant** (ou d'un réseau de restaurants). Elle couvre l'ensemble des besoins opérationnels, RH, financiers et d'approvisionnement d'un établissement de restauration.

**Problème résolu** : Aujourd'hui, un restaurateur jongle entre 5 à 10 outils différents (planning papier, tableur Excel pour la paie, logiciel de caisse séparé, gestion des fournisseurs par email, inventaire sur papier…). Restaurant OS **centralise tout** dans une seule application accessible sur ordinateur et mobile.

**Public cible** :
- Restaurateurs indépendants (1 à 5 établissements)
- Groupes de restauration (multi-établissements, multi-organisations)
- Gérants, directeurs, responsables RH, responsables achats
- Employés (consultation planning, pointage)

---

## 2. Architecture Organisationnelle

L'application repose sur une structure hiérarchique claire :

| Niveau | Description |
|--------|-------------|
| **Organisation** | L'entité juridique ou le groupe (ex : « Groupe Dupont Restauration ») |
| **Établissement** | Chaque restaurant physique rattaché à l'organisation |
| **Équipes** | Cuisine, Salle, Plonge, Pizza… au sein de chaque établissement |
| **Employés** | Rattachés à un ou plusieurs établissements, avec rôles et permissions |

Un administrateur peut gérer plusieurs établissements depuis un **Dashboard Organisation** global, avec une vue consolidée des indicateurs clés.

---

## 3. Les Modules — Vue d'ensemble

### 🗂️ Catégorie RH (Ressources Humaines)

#### 3.1 Planning
- Création du planning hebdomadaire par équipe (Cuisine, Salle, Plonge, Pizza…)
- Création, modification, suppression de shifts (créneaux horaires)
- Copie de semaine entière (réutiliser un planning existant)
- Navigation rapide entre les semaines
- Visualisation par équipe ou vue globale
- Publication du planning aux employés
- Validation de semaine
- Gestion des conflits (chevauchement de shifts, employé déjà planifié ailleurs)
- Publication automatique programmable

#### 3.2 Salariés
- Fiche complète de chaque employé : nom, prénom, contact, adresse
- Informations contractuelles : type de contrat (CDI, CDD, extra…), date de début/fin, heures contractuelles
- Informations sensibles chiffrées : IBAN, numéro de sécurité sociale
- Documents employé (pièces d'identité, contrats, attestations)
- Archivage des anciens salariés
- Gestion du pass Navigo

#### 3.3 Badgeuse (Pointage)
- Pointage d'entrée et de sortie par les employés
- Comparaison automatique avec le planning prévu
- Détection des retards (arrivée après l'heure prévue)
- Détection des départs anticipés
- Calcul du temps effectif travaillé
- Tolérance configurable (minutes d'arrivée/départ)
- Option de binding par appareil (un employé ne peut pointer que depuis son téléphone enregistré)
- Possibilité d'exiger un code PIN
- Archivage des doublons de pointage

#### 3.4 Présence
- Vue en temps réel : qui est présent aujourd'hui, qui est absent, qui est en retard
- Onglet « Extra » : heures supplémentaires détectées automatiquement via la badgeuse
- Onglet « Retard » : liste des retards du jour/période
- Onglet « Absence » : absences constatées (non pointé alors que planifié)
- Validation des extras par le manager

#### 3.5 Paie
- Calcul automatique de la paie mensuelle selon le droit du travail français
- Heures supplémentaires calculées par semaine civile (lundi → dimanche)
- Déduction des absences
- Gestion des congés payés (CP N et CP N-1) : comptés mais non déduits du salaire
- Salaire brut, net et total (charges comprises)
- Taux horaire opérationnel pour le calcul des absences
- Export possible pour transmission au cabinet comptable
- Constante légale : 52/12 semaines par mois

#### 3.6 Gestion du Personnel
- Vue consolidée de l'équipe : contrats en cours, postes, disponibilités
- Gestion des rôles et permissions (qui peut voir quoi, modifier quoi)
- Système RBAC complet (contrôle d'accès par rôle et par module)

#### 3.7 Congés & Absences
- Demande de congés par les employés
- Validation/refus par le manager
- Types d'absence : congé payé, maladie, absence injustifiée, congé sans solde…
- Impact automatique sur le planning et la paie
- Solde de congés visible (CP acquis, CP restants)

---

### 💰 Catégorie Finance

#### 3.8 Caisse
- Saisie quotidienne du rapport de caisse
- Ventilation : espèces, carte bancaire, livraison, courses, maintenance
- Calcul automatique du total et de l'écart de caisse
- Vue mensuelle avec historique et tendances
- Ajout de notes par jour

#### 3.9 Pertes & Casse
- Enregistrement des pertes de marchandise (casse, péremption, vol…)
- Suivi par produit et par période
- Impact visible sur les rapports financiers

#### 3.10 Rapports
- Rapports consolidés multi-dimensions
- Vue par période (jour, semaine, mois)
- Indicateurs clés : chiffre d'affaires, masse salariale, coûts matière
- Export des données

#### 3.11 Marchandise (Consommation inter-inventaires)
- Calcul de la consommation réelle de marchandise entre deux inventaires
- Croisement avec les achats et les ventes
- Base du calcul du food cost réel

---

### 📦 Catégorie Stock & Achats

#### 3.12 Produits (Catalogue V2)
- Référentiel unique de tous les produits achetés par l'établissement
- Catégorisation (fruits & légumes, viandes, boissons, épicerie…)
- Unités de mesure canoniques (kg, L, pièce…) avec système de conversion
- Prix d'achat de référence
- Rattachement aux fournisseurs
- Produit actif / archivé

#### 3.13 Fournisseurs
- Fiche fournisseur complète : nom, contact, conditions
- Historique des achats par fournisseur
- Rattachement des produits à chaque fournisseur

#### 3.14 Clients B2B
- Pour les établissements qui sont aussi **fournisseurs** d'autres restaurants
- Système de partenariat B2B entre établissements
- Catalogue partagé entre fournisseur et client
- Codes d'invitation pour établir un partenariat
- Gestion du partage de stock entre partenaires

#### 3.15 Commandes
- Création de bons de commande vers les fournisseurs
- Suivi du statut : brouillon → envoyée → expédiée → reçue
- Lignes de commande avec quantité, unité, prix unitaire
- Réception partielle ou totale
- Numéro de commande automatique

#### 3.16 DLC Critique (Dates Limites de Consommation)
- Surveillance des dates de péremption des produits en stock
- Alertes configurables par catégorie de produit
- Seuils d'alerte personnalisables (ex : alerter 3 jours avant pour le frais, 30 jours pour l'épicerie)

#### 3.17 Inventaire
- Sessions d'inventaire par zone de stockage (chambre froide, réserve sèche, cave…)
- Comptage produit par produit avec unité préférée
- Progression en temps réel (X/Y produits comptés)
- Historique des inventaires passés
- Détection des écarts entre stock théorique et stock réel
- Mutualisation d'inventaire (regrouper des produits similaires pour un comptage unique)
- Pause/reprise de session

#### 3.18 Achats (Synthèse mensuelle)
- Vue récapitulative des achats par fournisseur et par mois
- Montants totaux, nombre de factures
- Comparaison mois par mois

#### 3.19 Factures
- Gestion documentaire des factures fournisseurs
- Upload de PDF (factures, bons de livraison, relevés)
- Classification automatique du type de document
- Suivi du statut de paiement
- Suppression avec double confirmation
- Onglet « Paiement » (module PayLedger) :
  - Suivi des échéances de paiement par fournisseur
  - Calcul automatique des dates d'échéance selon les règles fournisseur (M+1, jour fixe, échéancier…)
  - Indicateur d'urgence : en retard, bientôt dû, à venir
  - Paiement global par fournisseur (FIFO mensuel) ou facture par facture
  - Historique des paiements (timeline)
  - Mode automatique ou manuel
  - Gestion des acomptes et paiements partiels

#### 3.20 Vision AI — Scan intelligent de factures
- Upload d'une photo ou d'un PDF de facture
- **Extraction automatique par intelligence artificielle** :
  - Nom du fournisseur
  - Numéro de facture
  - Date
  - Montant total
  - Lignes de produits (nom, quantité, prix unitaire, total ligne)
- Matching automatique avec les fournisseurs existants
- Matching automatique avec les produits du catalogue
- Correction manuelle possible avant validation
- Sauvegarde en un clic dans le système de factures
- Historique des extractions récentes
- Paramètres d'extraction configurables :
  - Tolérance de variation de prix
  - Détection de quantités anormales
  - Alerte sur produits rarement achetés
  - Filtrage des produits déjà en catalogue

#### 3.21 BL Réception (Bons de Livraison)
- Réception des marchandises avec vérification par rapport à la commande
- Création de documents BL liés au stock
- Corrections possibles après réception
- Impact direct sur le stock

#### 3.22 BL Retraits
- Gestion des sorties de stock inter-établissements
- Bon de retrait avec destination
- Impact sur le stock du fournisseur interne

---

### 🍽️ Catégorie Vente & Menu

#### 3.23 Recettes
- Fiches recettes avec ingrédients et quantités
- Base du calcul du food cost théorique

#### 3.24 Food Cost
- Calcul du coût matière par plat
- Comparaison food cost théorique vs réel
- Objectif de rentabilité par carte

#### 3.25 Plat du Jour
- Gestion du plat du jour / suggestions
- Lien avec les produits en stock (utiliser ce qui doit partir)

---

### 🧠 Catégorie Pilotage Intelligent

#### 3.26 The Brain (Moteur d'apprentissage)
- Système d'apprentissage qui observe les actions récurrentes
- Crée des « règles » automatiques basées sur l'historique
- Exemples : « Ce fournisseur livre toujours le mardi », « Ce produit est toujours commandé en cartons de 6 »
- Confirmations et corrections par l'utilisateur renforcent les règles
- Événements tracés : extraction de facture, correction de prix, annulation…

#### 3.27 Alertes & Notifications
- Alertes de stock bas
- Alertes de prix (variation anormale d'un fournisseur)
- Notifications push configurables
- Centre de notifications dans l'app

#### 3.28 Contexte & Événements
- Enregistrement des événements qui impactent l'activité (match de foot, fête locale, météo…)
- Corrélation future avec les données de vente et de stock

#### 3.29 Assistant IA
- Interface conversationnelle pour interroger ses données
- Questions en langage naturel sur les achats, le stock, la paie…

---

### ⚙️ Catégorie Paramètres & Administration

#### 3.30 Paramètres
- Configuration de l'établissement : nom, adresse, horaires d'ouverture
- Profil établissement : SIRET, coordonnées, logo
- Horaires d'ouverture par jour de la semaine
- Exceptions d'ouverture (jours fériés, fermetures exceptionnelles)
- Parties de journée configurables (service midi, service soir…)
- Politique de pause configurable
- Heure de coupure du « jour de service » (ex : 3h du matin)
- Configuration de la navigation mobile par rôle

#### 3.31 Administration (Admin uniquement)
- Gestion des organisations et établissements
- Gestion des utilisateurs et de leurs rôles
- Activation/désactivation de modules par établissement
- Logs d'activité et audit trail
- Vue plateforme globale (multi-organisations)
- Diagnostics et monitoring

#### 3.32 Système de permissions (RBAC)
- Chaque module peut être activé ou désactivé par établissement
- Chaque rôle a des permissions granulaires : lecture seule, écriture, admin
- La navigation s'adapte automatiquement aux permissions de l'utilisateur
- Un employé ne voit que ce à quoi il a droit

---

## 4. Fonctionnalités Transversales

| Fonctionnalité | Description |
|----------------|-------------|
| **Multi-établissements** | Un compte peut gérer plusieurs restaurants avec vue consolidée |
| **Multi-organisations** | Support de plusieurs entités juridiques indépendantes |
| **Responsive mobile** | Interface adaptée mobile avec navigation dédiée (grille de tuiles, bottom nav) |
| **Application mobile (Capacitor)** | Encapsulation en app mobile native (iOS/Android) |
| **Mode sombre** | Thème clair et sombre |
| **Temps réel** | Mises à jour en temps réel sur 13 canaux (planning, présence, stock…) |
| **Sécurité des données** | Chiffrement des données sensibles (IBAN, n° sécu), RLS sur 100% des tables |
| **Audit trail** | Journalisation des actions critiques |
| **RGPD** | Politique de suppression des données, export DSAR |
| **Publication automatique** | Le planning peut être publié automatiquement à une heure configurée |

---

## 5. Problèmes Résolus

| Problème du restaurateur | Solution Restaurant OS |
|--------------------------|----------------------|
| Planning sur papier ou tableau blanc | Planning digital collaboratif avec copie de semaine et publication |
| Pointage sur feuille de présence | Badgeuse digitale avec détection automatique retards/extras |
| Paie calculée à la main ou par le comptable seul | Calcul automatique conforme au droit français, export prêt |
| Factures perdues ou en vrac dans un tiroir | Scan IA + archivage structuré + suivi des paiements |
| Inventaire sur papier puis ressaisie | Inventaire digital par zone avec progression en temps réel |
| Pas de visibilité sur les achats | Synthèse mensuelle par fournisseur avec alertes de prix |
| Commandes par téléphone/SMS sans trace | Bons de commande digitaux avec suivi de statut |
| Pas de suivi des congés | Module congés avec soldes, demandes et validation |
| Aucune vue consolidée multi-restaurants | Dashboard organisation avec indicateurs clés |
| Dépendance à plusieurs logiciels coûteux | Tout-en-un dans une seule plateforme |

---

## 6. Axes d'Amélioration Proposés — Vers une App SaaS Intelligente de Référence

Pour concurrencer les leaders du marché (Lightspeed, Toast, 7shifts, MarketMan, Apicbase, Combo…), voici les axes stratégiques recommandés :

---

### 🔴 AXE 1 — Intelligence Prédictive (le vrai différenciateur)

**Objectif** : Passer d'un outil de gestion **réactif** à un outil **prédictif**.

| Fonctionnalité | Impact |
|----------------|--------|
| **Prévision de fréquentation** | Croiser historique de caisse + événements contextuels + météo pour prédire le nombre de couverts |
| **Planning intelligent** | Proposer automatiquement un planning optimal basé sur la fréquentation prévue, les contrats et les disponibilités |
| **Commande automatique** | Suggérer les quantités à commander basées sur le stock actuel, la consommation prévue et les DLC |
| **Alerte de rupture prédictive** | Prévenir AVANT la rupture de stock, pas après |
| **Scoring fournisseur** | Évaluer automatiquement chaque fournisseur (prix, fiabilité, délais) et recommander des alternatives |

> **Pourquoi c'est clé** : Aucun concurrent français ne propose un vrai moteur prédictif intégré à la gestion quotidienne. The Brain est déjà une base — il faut l'amplifier.

---

### 🟠 AXE 2 — Expérience Employé (Employee Self-Service)

**Objectif** : Donner aux employés une vraie app mobile qu'ils VEULENT utiliser.

| Fonctionnalité | Impact |
|----------------|--------|
| **Mon planning** | Vue personnalisée du planning de l'employé avec notifications push |
| **Demande d'échange de shift** | Un employé peut proposer un échange, le collègue accepte, le manager valide |
| **Demande de disponibilité** | L'employé déclare ses créneaux disponibles/indisponibles |
| **Mon compteur** | Heures travaillées, heures sup, solde de congés — en temps réel |
| **Mes fiches de paie** | Consultation des bulletins directement dans l'app |
| **Messagerie interne** | Communication équipe sans passer par WhatsApp |

> **Pourquoi c'est clé** : 7shifts et Combo misent massivement sur l'employee experience. Un restaurateur choisit aussi son outil en fonction de l'adoption par son équipe.

---

### 🟡 AXE 3 — Intégration Caisse & POS

**Objectif** : Connecter la caisse enregistreuse pour automatiser le flux de données.

| Fonctionnalité | Impact |
|----------------|--------|
| **Import automatique des ventes** | Plus de saisie manuelle du rapport de caisse |
| **Food cost en temps réel** | Chaque plat vendu décrémente automatiquement le stock théorique |
| **Analyse des ventes par plat** | Savoir quels plats se vendent, quels plats sont peu rentables |
| **Rapprochement automatique** | Ventes vs achats vs stock = triangle de cohérence automatique |

> **Pourquoi c'est clé** : Lightspeed et Toast sont d'abord des POS. Sans intégration caisse, Restaurant OS reste un outil « back-office ». Avec, il devient un outil de pilotage complet.

---

### 🟢 AXE 4 — Tableaux de Bord Décisionnels Avancés

**Objectif** : Donner au dirigeant une vision stratégique, pas juste opérationnelle.

| Fonctionnalité | Impact |
|----------------|--------|
| **Dashboard P&L temps réel** | Chiffre d'affaires - coûts matière - masse salariale = résultat en un coup d'œil |
| **Benchmark inter-établissements** | Comparer les performances entre restaurants du groupe |
| **Tendances et saisonnalité** | Visualiser les tendances sur 12 mois glissants |
| **Objectifs et alertes** | Fixer des objectifs (food cost < 30%, masse salariale < 35%) et être alerté en cas de dépassement |
| **Export comptable automatisé** | Génération des fichiers d'export pour le logiciel comptable (FEC, format cabinet) |

---

### 🔵 AXE 5 — Mode Offline & Fiabilité Terrain

**Objectif** : L'app doit fonctionner même sans réseau (cave, chambre froide, zones blanches).

| Fonctionnalité | Impact |
|----------------|--------|
| **Inventaire offline** | Compter en cave sans réseau, synchroniser en remontant |
| **Pointage offline** | Badge même en cas de coupure internet |
| **File d'attente de mutations** | Les actions en attente se synchronisent automatiquement au retour du réseau |
| **Indicateur de connexion** | L'utilisateur sait toujours s'il est en ligne ou hors ligne |

---

### 🟣 AXE 6 — Marketplace Fournisseurs

**Objectif** : Devenir la plateforme qui connecte restaurateurs et fournisseurs.

| Fonctionnalité | Impact |
|----------------|--------|
| **Annuaire de fournisseurs** | Découvrir de nouveaux fournisseurs locaux |
| **Comparateur de prix** | Comparer les prix d'un même produit entre fournisseurs |
| **Commande multi-fournisseurs** | Un seul panier, dispatch automatique vers chaque fournisseur |
| **Notation et avis** | Communauté de restaurateurs qui évaluent leurs fournisseurs |
| **Facturation intégrée côté fournisseur** | Le fournisseur émet sa facture dans la plateforme → elle arrive directement chez le restaurateur |

> **Pourquoi c'est clé** : C'est le modèle qui crée un **effet de réseau**. Plus il y a de restaurateurs, plus les fournisseurs veulent être présents, et inversement. C'est le meilleur moat concurrentiel possible.

---

### ⚪ AXE 7 — Conformité & Réglementaire

**Objectif** : Devenir l'outil qui sécurise le restaurateur sur le plan légal.

| Fonctionnalité | Impact |
|----------------|--------|
| **Registre HACCP digital** | Relevés de température, traçabilité, fiches de contrôle |
| **Registre du personnel légal** | Génération automatique conforme au Code du travail |
| **Alertes réglementaires** | Notification quand un contrat arrive à échéance, quand un document expire |
| **Archivage légal** | Conservation des documents selon les durées légales obligatoires |
| **Conformité URSSAF** | Alertes sur les seuils d'heures supplémentaires, repos obligatoires |

---

## 7. Positionnement Concurrentiel

| Critère | Restaurant OS | Combo | 7shifts | Lightspeed | MarketMan |
|---------|:---:|:---:|:---:|:---:|:---:|
| Planning | ✅ | ✅ | ✅ | ❌ | ❌ |
| Pointage / Badgeuse | ✅ | ✅ | ✅ | ❌ | ❌ |
| Paie France | ✅ | ✅ | ❌ | ❌ | ❌ |
| Gestion stock | ✅ | ❌ | ❌ | ⚠️ | ✅ |
| Scan facture IA | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| Commandes fournisseurs | ✅ | ❌ | ❌ | ⚠️ | ✅ |
| B2B inter-établissements | ✅ | ❌ | ❌ | ❌ | ❌ |
| Food cost | 🔜 | ❌ | ❌ | ⚠️ | ✅ |
| Caisse intégrée | ⚠️ | ❌ | ❌ | ✅ | ❌ |
| IA prédictive | 🔜 | ❌ | ❌ | ❌ | ❌ |
| Multi-établissements | ✅ | ✅ | ✅ | ✅ | ✅ |
| App mobile | ✅ | ✅ | ✅ | ✅ | ✅ |

**Avantage unique** : Restaurant OS est le seul outil qui couvre **RH + Stock + Achats + Finance + IA** dans une plateforme unifiée, avec un moteur d'apprentissage (The Brain) et un scan de factures par IA intégré.

---

## 8. Résumé

Restaurant OS n'est pas un simple outil de planning ou de stock. C'est une **plateforme de gestion intelligente** qui ambitionne de devenir le **système d'exploitation du restaurant** — là où toute l'information converge, où chaque action alimente l'intelligence du système, et où le restaurateur prend de meilleures décisions grâce à ses propres données.

Les fondations sont solides. Les modules critiques sont en place. La prochaine étape est de passer de **l'outil de gestion** à **l'assistant intelligent** qui anticipe, recommande et automatise.

---

*Document généré le 8 mars 2026 — Restaurant OS*
