// Paquets de lieux, en français.
// - spyfall1 : les 27 lieux officiels de la 1re édition (7 rôles officiels)
// - spyfall2 : les 25 lieux officiels de Spyfall 2 (10 rôles officiels)
// - delire   : 70 lieux originaux taillés pour le roleplay, classés par thème
// Chaque lieu porte un `theme` utilisé par les filtres d'élimination en jeu.
// Les rôles en double sur certaines cartes de Spyfall 2 sont d'origine.

const T = {
  transport: "🚗 Transports",
  nature: "🌴 Nature & vacances",
  fete: "🎉 Fête & soirée",
  boulot: "💼 Boulot & commerce",
  culture: "🎭 Culture & spectacle",
  sport: "⚽ Sport & loisirs",
  public: "🏛️ Institutions & public",
  aventure: "⚔️ Aventure & extrême",
  bouffe: "🍕 Bouffe & boisson",
  insolite: "🤪 Insolite & imaginaire",
};

const spyfall1 = [
  {
    name: "Avion",
    theme: T.transport,
    roles: ["Commandant de bord", "Copilote", "Hôtesse de l'air", "Mécanicien", "Agent de sûreté", "Passager en première classe", "Passager en classe éco"],
  },
  {
    name: "Banque",
    theme: T.boulot,
    roles: ["Directeur d'agence", "Guichetier", "Consultant", "Agent de sécurité", "Convoyeur de fonds", "Braqueur", "Client"],
  },
  {
    name: "Plage",
    theme: T.nature,
    roles: ["Maître-nageur", "Kitesurfeur", "Serveuse de plage", "Photographe de plage", "Vendeur de glaces", "Vacancier", "Voleur"],
  },
  {
    name: "Casino",
    theme: T.fete,
    roles: ["Croupier", "Directeur", "Chef de la sécurité", "Videur", "Barman", "Arnaqueur", "Joueur"],
  },
  {
    name: "Cathédrale",
    theme: T.culture,
    roles: ["Prêtre", "Choriste", "Mécène", "Fidèle", "Touriste", "Mendiant", "Pécheur"],
  },
  {
    name: "Chapiteau de cirque",
    theme: T.culture,
    roles: ["Acrobate", "Dompteur", "Magicien", "Cracheur de feu", "Clown", "Jongleur", "Spectateur"],
  },
  {
    name: "Soirée d'entreprise",
    theme: T.fete,
    roles: ["Patron", "Manager", "Comptable", "Secrétaire", "Animateur", "Livreur", "Invité indésirable"],
  },
  {
    name: "Armée des croisés",
    theme: T.aventure,
    roles: ["Chevalier", "Archer", "Évêque", "Moine", "Écuyer", "Serviteur", "Sarrasin prisonnier"],
  },
  {
    name: "Spa",
    theme: T.nature,
    roles: ["Masseuse", "Styliste", "Manucure", "Maquilleuse", "Dermatologue", "Esthéticienne", "Client"],
  },
  {
    name: "Ambassade",
    theme: T.public,
    roles: ["Ambassadeur", "Diplomate", "Secrétaire", "Agent de sécurité", "Fonctionnaire", "Touriste", "Réfugié"],
  },
  {
    name: "Hôpital",
    theme: T.public,
    roles: ["Chirurgien", "Médecin", "Infirmière", "Interne", "Anesthésiste", "Thérapeute", "Patient"],
  },
  {
    name: "Hôtel",
    theme: T.nature,
    roles: ["Directeur", "Portier", "Groom", "Femme de chambre", "Barman", "Agent de sécurité", "Client"],
  },
  {
    name: "Base militaire",
    theme: T.aventure,
    roles: ["Colonel", "Officier", "Soldat", "Tireur d'élite", "Médecin militaire", "Mécanicien de char", "Déserteur"],
  },
  {
    name: "Studio de cinéma",
    theme: T.culture,
    roles: ["Réalisateur", "Producteur", "Acteur", "Cascadeur", "Cadreur", "Ingénieur du son", "Costumier"],
  },
  {
    name: "Paquebot de croisière",
    theme: T.transport,
    roles: ["Capitaine", "Cuisinier", "Barman", "Serveur", "Musicien", "Mécanicien", "Passager fortuné"],
  },
  {
    name: "Train de voyageurs",
    theme: T.transport,
    roles: ["Conducteur", "Mécanicien", "Chauffeur de chaudière", "Agent de bord", "Garde-frontière", "Chef du wagon-restaurant", "Passager"],
  },
  {
    name: "Bateau pirate",
    theme: T.aventure,
    roles: ["Vaillant capitaine", "Canonnier", "Matelot", "Mousse", "Cuisinier", "Esclave", "Prisonnier ligoté"],
  },
  {
    name: "Station polaire",
    theme: T.aventure,
    roles: ["Chef d'expédition", "Météorologue", "Biologiste", "Géologue", "Hydrologue", "Radio-opérateur", "Médecin"],
  },
  {
    name: "Commissariat de police",
    theme: T.public,
    roles: ["Inspecteur", "Policier de patrouille", "Expert en criminalistique", "Archiviste", "Avocat", "Journaliste", "Criminel"],
  },
  {
    name: "Restaurant",
    theme: T.bouffe,
    roles: ["Chef cuisinier", "Maître d'hôtel", "Serveur", "Videur", "Musicien", "Critique gastronomique", "Client"],
  },
  {
    name: "École",
    theme: T.public,
    roles: ["Directeur", "Prof de gym", "Surveillant", "Concierge", "Cantinière", "Agent d'entretien", "Élève"],
  },
  {
    name: "Station-service",
    theme: T.transport,
    roles: ["Gérant", "Mécanicien auto", "Spécialiste des pneus", "Électricien", "Laveur de voitures", "Motard", "Automobiliste"],
  },
  {
    name: "Station spatiale",
    theme: T.aventure,
    roles: ["Commandant", "Ingénieur", "Scientifique", "Pilote", "Médecin de bord", "Touriste spatial", "Extraterrestre"],
  },
  {
    name: "Sous-marin",
    theme: T.aventure,
    roles: ["Commandant", "Navigateur", "Sonariste", "Technicien électronique", "Radio-opérateur", "Cuisinier", "Matelot"],
  },
  {
    name: "Supermarché",
    theme: T.boulot,
    roles: ["Caissier", "Boucher", "Magasinier", "Démonstratrice", "Agent d'entretien", "Agent de sécurité", "Client"],
  },
  {
    name: "Théâtre",
    theme: T.culture,
    roles: ["Metteur en scène", "Acteur", "Souffleur", "Machiniste", "Caissier", "Dame du vestiaire", "Spectateur"],
  },
  {
    name: "Université",
    theme: T.public,
    roles: ["Doyen", "Professeur", "Doctorant", "Psychologue", "Bibliothécaire", "Concierge", "Étudiant"],
  },
];

const spyfall2 = [
  {
    name: "Parc d'attractions",
    theme: T.sport,
    roles: ["Opérateur de manège", "Parent", "Vendeur de snacks", "Caissier", "Enfant ravi", "Enfant pénible", "Adolescent", "Agent d'entretien", "Agent de sécurité", "Parent"],
  },
  {
    name: "Musée d'art",
    theme: T.culture,
    roles: ["Vendeur de billets", "Étudiant", "Visiteur", "Professeur", "Agent de sécurité", "Peintre", "Collectionneur d'art", "Critique d'art", "Photographe", "Touriste"],
  },
  {
    name: "Fabrique de bonbons",
    theme: T.bouffe,
    roles: ["Rouquin farfelu", "Pâtissier", "Visiteur", "Goûteur", "Fabricant de truffes", "Goûteur", "Magasinier", "Oompa Loompa", "Inspecteur", "Opérateur de machine"],
  },
  {
    name: "Concours félin",
    theme: T.insolite,
    roles: ["Juge", "Présentateur de chats", "Vétérinaire", "Agent de sécurité", "Dresseur de chats", "Folle aux chats", "Ami des bêtes", "Propriétaire de chat", "Chat", "Chat"],
  },
  {
    name: "Cimetière",
    theme: T.public,
    roles: ["Prêtre", "Gothique", "Pilleur de tombes", "Poète", "Personne en deuil", "Gardien", "Défunt", "Proche du défunt", "Vendeur de fleurs", "Fossoyeur"],
  },
  {
    name: "Mine de charbon",
    theme: T.boulot,
    roles: ["Inspecteur de sécurité", "Mineur", "Contremaître", "Conducteur de tombereau", "Foreur", "Coordinateur", "Artificier", "Mineur", "Ingénieur des déchets", "Ouvrier"],
  },
  {
    name: "Chantier de construction",
    theme: T.boulot,
    roles: ["Bambin échappé", "Entrepreneur", "Grutier", "Intrus", "Responsable sécurité", "Électricien", "Ingénieur", "Architecte", "Ouvrier du bâtiment", "Ouvrier du bâtiment"],
  },
  {
    name: "Salon du jeu vidéo",
    theme: T.sport,
    roles: ["Blogueur", "Cosplayeur", "Joueur", "Exposant", "Collectionneur", "Enfant", "Agent de sécurité", "Geek", "Timide", "Célébrité"],
  },
  {
    name: "Station-essence",
    theme: T.transport,
    roles: ["Passionné d'autos", "Pompiste", "Vendeur de la boutique", "Client", "Laveur de voitures", "Caissier", "Client", "Militant écologiste", "Pompiste", "Gérant"],
  },
  {
    name: "Docks du port",
    theme: T.transport,
    roles: ["Docker", "Vieux loup de mer", "Capitaine", "Matelot", "Docker", "Pêcheur", "Exportateur", "Superviseur du fret", "Inspecteur du fret", "Contrebandier"],
  },
  {
    name: "Stade de hockey",
    theme: T.sport,
    roles: ["Fan de hockey", "Médecin", "Joueur de hockey", "Vendeur de snacks", "Agent de sécurité", "Gardien de but", "Entraîneur", "Arbitre", "Spectateur", "Joueur de hockey"],
  },
  {
    name: "Prison",
    theme: T.public,
    roles: ["Condamné à tort", "Opérateur de vidéosurveillance", "Gardien", "Visiteur", "Avocat", "Agent d'entretien", "Directeur de la prison", "Criminel", "Surveillant pénitentiaire", "Détenu fou"],
  },
  {
    name: "Club de jazz",
    theme: T.fete,
    roles: ["Videur", "Batteur", "Pianiste", "Saxophoniste", "Chanteur", "Passionné de jazz", "Danseur", "Barman", "VIP", "Serveur"],
  },
  {
    name: "Bibliothèque",
    theme: T.culture,
    roles: ["Vieil homme", "Journaliste", "Auteur", "Bénévole", "Monsieur je-sais-tout", "Étudiant", "Bibliothécaire", "Bavard bruyant", "Dévoreur de livres", "Intello"],
  },
  {
    name: "Boîte de nuit",
    theme: T.fete,
    roles: ["Habitué", "Barman", "Agent de sécurité", "Danseur", "Dragueur", "Fêtarde", "Mannequin", "Costaud", "Personne ivre", "Timide"],
  },
  {
    name: "Circuit de course",
    theme: T.sport,
    roles: ["Propriétaire d'écurie", "Pilote", "Ingénieur", "Spectateur", "Commissaire de course", "Mécanicien", "Vendeur de snacks", "Commentateur", "Bookmaker", "Spectateur"],
  },
  {
    name: "Maison de retraite",
    theme: T.public,
    roles: ["Proche en visite", "Joueur de cartes", "Personne âgée", "Infirmière", "Agent d'entretien", "Cuisinier", "Aveugle", "Psychologue", "Personne âgée", "Infirmière"],
  },
  {
    name: "Concert de rock",
    theme: T.fete,
    roles: ["Danseur", "Chanteur", "Fan", "Guitariste", "Batteur", "Roadie", "Adepte du stage diving", "Agent de sécurité", "Bassiste", "Technicien"],
  },
  {
    name: "Bus touristique",
    theme: T.transport,
    roles: ["Vieil homme", "Touriste solitaire", "Chauffeur", "Enfant pénible", "Touriste", "Guide", "Photographe", "Touriste", "Personne perdue", "Touriste"],
  },
  {
    name: "Stade d'athlétisme",
    theme: T.sport,
    roles: ["Médecin", "Lanceur de marteau", "Athlète", "Commentateur", "Spectateur", "Agent de sécurité", "Arbitre", "Vendeur de snacks", "Sauteur en hauteur", "Sprinteur"],
  },
  {
    name: "Métro",
    theme: T.transport,
    roles: ["Touriste", "Conducteur de rame", "Contrôleur", "Femme enceinte", "Pickpocket", "Agent de nettoyage", "Homme d'affaires", "Vendeur de tickets", "Vieille dame", "Aveugle"],
  },
  {
    name: "L'ONU",
    theme: T.public,
    roles: ["Diplomate", "Interprète", "Beau parleur", "Touriste", "Délégué assoupi", "Journaliste", "Secrétaire d'État", "Orateur", "Secrétaire général", "Lobbyiste"],
  },
  {
    name: "Vignoble",
    theme: T.bouffe,
    roles: ["Jardinier", "Guide gastronomique", "Vigneron", "Exportateur", "Majordome", "Dégustateur", "Sommelier", "Riche propriétaire", "Régisseur du domaine", "Œnologue"],
  },
  {
    name: "Mariage",
    theme: T.fete,
    roles: ["Porteur d'alliances", "Marié", "Mariée", "Officiant", "Photographe", "Bouquetière", "Père de la mariée", "Invité incrusté", "Témoin", "Proche"],
  },
  {
    name: "Zoo",
    theme: T.nature,
    roles: ["Soigneur", "Visiteur", "Photographe", "Enfant", "Vétérinaire", "Touriste", "Vendeur de snacks", "Caissier", "Soigneur", "Chercheur"],
  },
];

const delire = [
  // 🚗 Transports
  {
    name: "Vol low-cost",
    theme: T.transport,
    roles: ["Pilote qui rassure un peu trop", "Hôtesse à bout de nerfs", "Passager qui applaudit à l'atterrissage", "Passager du siège du milieu", "Influenceur qui filme « sa première classe »", "Passager au bagage très limite", "Mamie qui offre des bonbons à tout l'avion"],
  },
  {
    name: "Covoiturage de 8 heures",
    theme: T.transport,
    roles: ["Conducteur fier de sa playlist douteuse", "Passager qui parle depuis Lyon", "Passagère qui fait semblant de dormir", "Étudiant fauché", "Passager qui mange un kebab", "Copilote autoproclamé du GPS", "Passagère avec un chat pas prévu"],
  },
  {
    name: "Croisière du troisième âge",
    theme: T.transport,
    roles: ["Animateur sous pression", "Capitaine en fin de carrière", "Retraitée reine du buffet", "Couple qui se dispute depuis l'embarquement", "Magicien has-been", "Serveur trop bronzé", "Jeune monté sur le mauvais bateau"],
  },
  {
    name: "Téléphérique bloqué",
    theme: T.transport,
    roles: ["Technicien qui répète que « c'est normal »", "Touriste qui panique", "Guide de montagne très zen", "Enfant absolument ravi", "Couple en lune de miel", "Influenceuse qui filme tout", "Skieur qui rate son après-midi"],
  },
  {
    name: "Aire d'autoroute un 15 août",
    theme: T.transport,
    roles: ["Pompiste débordé", "Père de famille au bord du craquage", "Enfant momentanément égaré", "Routier philosophe", "Caissière blasée", "Motard en combinaison intégrale", "Vacancier dans la file des toilettes"],
  },
  {
    name: "Taxi de nuit",
    theme: T.transport,
    roles: ["Chauffeur philosophe", "Client de fin de soirée", "Couple qui se dispute à l'arrière", "Touriste qui surveille le compteur", "Stagiaire en retard pour son premier jour", "DJ avec tout son matos", "Client qui a oublié son portefeuille"],
  },
  {
    name: "Vol en montgolfière",
    theme: T.transport,
    roles: ["Pilote étrangement calme", "Passager avec le vertige", "Photographe de paysages", "Amoureux qui prépare sa demande", "Gagnante d'un concours", "Instructeur bavard", "Enfant qui veut toucher les nuages"],
  },

  // 🌴 Nature & vacances
  {
    name: "Camping municipal",
    theme: T.nature,
    roles: ["Gérant tatillon sur le règlement", "Campeur installé là depuis 1998", "Famille sous l'orage", "Animateur du tournoi de pétanque", "Ado en quête de wifi", "Voisin de tente bruyant", "Randonneur qui s'est trompé de camping"],
  },
  {
    name: "Club de vacances tout inclus",
    theme: T.nature,
    roles: ["Animateur survolté", "Stratège du buffet", "Maître-nageur dragueur", "Enfant roi du mini-club", "DJ de la piscine", "Retraité au transat dès 6 h", "Serveur de cocktails à fleurs"],
  },
  {
    name: "Randonnée en haute montagne",
    theme: T.nature,
    roles: ["Guide trop optimiste", "Randonneur suréquipé", "Randonneur en tongs", "Berger pas impressionné", "Influenceuse en legging", "Secouriste de permanence", "Retardataire du groupe"],
  },
  {
    name: "Île déserte après naufrage",
    theme: T.nature,
    roles: ["Capitaine déchu", "Survivaliste secrètement ravi", "Touriste qui bronze quand même", "Cuisinier sans rien à cuisiner", "Optimiste qui construit un radeau", "Pessimiste officiel du groupe", "Naufragé qui parle à une noix de coco"],
  },
  {
    name: "Jardin partagé du quartier",
    theme: T.nature,
    roles: ["Président du jardin un peu tyrannique", "Mamie aux tomates légendaires", "Passionné de permaculture", "Voleur de courgettes", "Enfant qui piétine les semis", "Apiculteur anxieux", "Membre qui n'a jamais rien planté"],
  },
  {
    name: "Safari photo",
    theme: T.nature,
    roles: ["Guide qui exagère chaque anecdote", "Touriste imprudent", "Photographe professionnel", "Enfant qui veut caresser les lions", "Chauffeur de 4x4", "Influenceur déçu par le réseau", "Ranger fatigué des touristes"],
  },
  {
    name: "Station de ski en plein redoux",
    theme: T.nature,
    roles: ["Moniteur qui garde le sourire", "Skieur débutant", "Snowboardeur fanfaron", "Vendeur de forfaits embarrassé", "Pisteur fataliste", "Touriste en doudoune léopard", "Enfant échappé de la garderie"],
  },

  // 🎉 Fête & soirée
  {
    name: "Enterrement de vie de garçon",
    theme: T.fete,
    roles: ["Futur marié déguisé en licorne", "Témoin organisateur dépassé", "Pote relou", "Pote raisonnable qui surveille tout", "Inconnu incrusté au groupe", "Pote qui filme absolument tout", "Serveur complice"],
  },
  {
    name: "Réveillon du Nouvel An",
    theme: T.fete,
    roles: ["Hôte stressé par son four", "Invité déjà ivre à 22 h", "Moitié de couple qui attend minuit", "Personne qui appelle sa mère à 00 h 01", "DJ amateur à la playlist contestée", "Voisin venu se plaindre, resté pour le buffet", "Enfant caché sous la table"],
  },
  {
    name: "Anniversaire surprise raté",
    theme: T.fete,
    roles: ["Organisatrice paniquée", "Fêté pas surpris du tout", "Invité arrivé trop tôt", "Pote qui a vendu la mèche", "Livreur de gâteau en retard", "Ex pas invité mais présent", "Cousin éloigné que personne ne reconnaît"],
  },
  {
    name: "Soirée jeux de société",
    theme: T.fete,
    roles: ["Maître du jeu tyrannique", "Mauvais perdant notoire", "Tricheur en exercice", "Débutante qui gagne tout", "Celui qui lit les règles à voix haute", "Spectateur qui commente sans jouer", "Invité venu juste pour discuter"],
  },
  {
    name: "Karaoké de quartier",
    theme: T.fete,
    roles: ["Patron mélomane", "Étoile déchue du dimanche", "Groupe d'enterrement de vie de jeune fille", "Habitué de la même chanson depuis dix ans", "Couple en duo dramatique", "Client qui attend son tour depuis deux heures", "Serveur aux bouchons d'oreilles"],
  },
  {
    name: "Festival de musique sous la boue",
    theme: T.fete,
    roles: ["Festivalier prévoyant en bottes", "Festivalier en claquettes", "Vendeur de ponchos en or", "Agent de sécurité stoïque", "Chanteur de la scène secondaire", "Égaré qui cherche ses potes depuis hier", "Ingé son sous la pluie"],
  },
  {
    name: "Crémaillère dans 20 m²",
    theme: T.fete,
    roles: ["Hôte très fier de son studio", "Invitée coincée dans la kitchenette", "Pote qui offre une plante", "Voisin curieux", "Couple assis sur le lit", "Pote qui a ramené six inconnus", "Invité qui remonte déjà l'étagère"],
  },

  // 💼 Boulot & commerce
  {
    name: "Réunion qui aurait pu être un mail",
    theme: T.boulot,
    roles: ["Manager à slides", "Stagiaire qui note tout", "Collègue qui pose LA question à 17 h 59", "Dormeur discret du fond", "Collègue en visio figée", "RH enthousiaste", "Consultant en buzzwords"],
  },
  {
    name: "Start-up en levée de fonds",
    theme: T.boulot,
    roles: ["CEO visionnaire", "CTO épuisé", "Stagiaire payé en tickets resto", "Investisseur sceptique", "Growth hacker mystérieux", "Office manager du baby-foot", "Employé qui ignore ce que fait la boîte"],
  },
  {
    name: "Marché du dimanche",
    theme: T.boulot,
    roles: ["Maraîcher gouailleur", "Fromager généreux en échantillons", "Mamie qui négocie tout", "Touriste qui photographie les légumes", "Poissonnier tonitruant", "Cliente au panier en osier", "Goûteur professionnel jamais acheteur"],
  },
  {
    name: "Magasin de meubles suédois",
    theme: T.boulot,
    roles: ["Vendeur introuvable", "Couple au bord de la rupture", "Enfant perdu dans les showrooms", "Client qui teste tous les canapés", "Pro des raccourcis du magasin", "Client venu juste pour les boulettes", "Étudiant qui meuble son premier appart"],
  },
  {
    name: "Centre d'appels",
    theme: T.boulot,
    roles: ["Téléconseiller zen", "Nouveau qui découvre le script", "Collègue en pause café permanente", "Manager motivationnel", "Téléconseillère vedette du plateau", "Stagiaire au casque cassé", "Syndicaliste vigilant"],
  },
  {
    name: "Salon de coiffure de quartier",
    theme: T.boulot,
    roles: ["Coiffeuse bavarde", "Client qui voulait « juste les pointes »", "Mamie sous le casque", "Apprenti au balai", "Client endormi", "Cliente à la couleur ratée", "Habitué du samedi matin"],
  },
  {
    name: "Vide-grenier",
    theme: T.boulot,
    roles: ["Organisateur au mégaphone", "Vendeur trop attaché à ses objets", "Acheteuse négociatrice impitoyable", "Collectionneur de vinyles", "Enfant qui vend ses jouets à contrecœur", "Brocanteur pro déguisé en amateur", "Voisin qui vend les affaires de son ex"],
  },

  // 🎭 Culture & spectacle
  {
    name: "Tournage de télé-réalité",
    theme: T.culture,
    roles: ["Candidat stratège", "Candidate venue « pour l'aventure »", "Caméraman blasé", "Producteur machiavélique", "Éliminé qui traîne encore sur le plateau", "Psy de production", "Monteur qui invente l'histoire"],
  },
  {
    name: "Vernissage d'art contemporain",
    theme: T.culture,
    roles: ["Artiste incompris", "Critique en écharpe", "Invité venu pour le buffet", "Collectionneur snob", "Galeriste en pleine vente", "Visiteur qui hoche la tête sans comprendre", "Agent d'entretien qui a failli jeter l'œuvre"],
  },
  {
    name: "Plateau de cinéma de série Z",
    theme: T.culture,
    roles: ["Réalisateur passionné", "Acteur principal cabotin", "Cascadeuse sous-payée", "Maquilleur d'effets douteux", "Figurant zombie", "Producteur fauché", "Perchman maudit"],
  },
  {
    name: "Escape game",
    theme: T.culture,
    roles: ["Game master au micro", "Joueur qui fouille même le plafond", "Joueuse qui a déjà tout résolu", "Paniqué des pièces fermées", "Celui qui casse le décor", "Collègue en team building forcé", "Couple en rendez-vous galant"],
  },
  {
    name: "Scène ouverte de stand-up",
    theme: T.culture,
    roles: ["Humoriste qui débute", "Humoriste qui « teste du nouveau matériel »", "Patron du bar", "Spectatrice du premier rang", "Chahuteur professionnel", "Pote venu soutenir", "Serveuse qui a tout entendu cent fois"],
  },
  {
    name: "Émission de cuisine en direct",
    theme: T.culture,
    roles: ["Chef juré impitoyable", "Candidat au bord des larmes", "Candidate beaucoup trop sûre d'elle", "Présentateur survolté", "Caméraman affamé", "Coach culinaire en coulisses", "Plongeur du studio"],
  },
  {
    name: "Opéra",
    theme: T.culture,
    roles: ["Diva", "Ténor enrhumé", "Chef d'orchestre", "Spectateur endormi au premier acte", "Mécène du premier rang", "Ouvreuse", "Critique impitoyable"],
  },

  // ⚽ Sport & loisirs
  {
    name: "Salle de sport en janvier",
    theme: T.sport,
    roles: ["Coach débordant de motivation", "Résolutionnaire du 1er janvier", "Bodybuilder fasciné par le miroir", "Squatteuse du seul rameur", "Nouveau complètement perdu", "Vendeur de protéines", "Habitué qui ne range jamais ses poids"],
  },
  {
    name: "Match de foot de district",
    theme: T.sport,
    roles: ["Arbitre contesté", "Gardien poète", "Buteur vétéran", "Parent ultra en tribune", "Coach en survêtement intégral", "Remplaçant frigorifié", "Responsable de la buvette"],
  },
  {
    name: "Tournoi d'échecs",
    theme: T.sport,
    roles: ["Grand maître arrogant", "Prodige de neuf ans", "Joueur qui réfléchit quarante minutes", "Arbitre du silence", "Parent plus stressé que l'enfant", "Joueur qui propose nulle à tout le monde", "Spectateur qui n'y comprend rien"],
  },
  {
    name: "Laser game d'anniversaire",
    theme: T.sport,
    roles: ["Gamin tireur d'élite", "Papa beaucoup trop investi", "Ado blasé", "Animateur du briefing", "Campeur assumé", "Joueur qui a oublié ses lunettes", "Équipier traître"],
  },
  {
    name: "Piscine municipale",
    theme: T.sport,
    roles: ["Maître-nageur au sifflet facile", "Tyran du couloir de nage", "Star de l'aquagym", "Enfant du grand plongeoir", "Ado qui parade", "Caissière des entrées", "Baigneur au bonnet réglementaire"],
  },
  {
    name: "Marathon",
    theme: T.sport,
    roles: ["Coureur déguisé en banane", "Athlète d'élite", "Coureur qui marche dès le 3e kilomètre", "Bénévole du ravitaillement", "Supporter à pancarte", "Médecin de course", "Journaliste essoufflé"],
  },
  {
    name: "Bowling",
    theme: T.sport,
    roles: ["Champion de la ligue locale", "Abonné de la gouttière", "Enfant avec la rampe", "Serveur de nachos", "Joueur venu avec sa propre boule", "Couple en premier rendez-vous", "Technicien des quilles"],
  },

  // 🏛️ Institutions & public
  {
    name: "Guichet de la préfecture",
    theme: T.public,
    roles: ["Agent du guichet 4", "Usager au mauvais guichet", "Détenteur du ticket 842", "Stagiaire de la préfecture", "Vigile", "Usager endormi", "Dame qui a « juste une petite question »"],
  },
  {
    name: "Cabinet de dentiste",
    theme: T.public,
    roles: ["Dentiste qui pose des questions la bouche pleine", "Patient terrorisé", "Assistante dentaire", "Enfant venu pour l'autocollant", "Patient qui jure ne pas avoir mal", "Commercial en matériel dentaire", "Patiente très en retard"],
  },
  {
    name: "Examen du permis de conduire",
    theme: T.public,
    roles: ["Inspecteur impassible", "Candidat à la cinquième tentative", "Candidate trop confiante", "Moniteur fataliste", "Élève du créneau éternel", "Secrétaire de l'auto-école", "Candidat qui cale au rond-point"],
  },
  {
    name: "Tribunal pour litige de voisinage",
    theme: T.public,
    roles: ["Juge fatigué", "Plaignant de la haie de thuyas", "Accusé du barbecue dominical", "Avocat commis d'office", "Témoin mythomane", "Greffière imperturbable", "Voisin venu pour le spectacle"],
  },
  {
    name: "Caserne de pompiers",
    theme: T.public,
    roles: ["Capitaine", "Jeune recrue zélée", "Cuisinier de la caserne", "Pompier du calendrier", "Standardiste du 18", "Vétéran nostalgique", "Élève en visite scolaire"],
  },
  {
    name: "Mairie un jour de mariage",
    theme: T.public,
    roles: ["Maire à l'écharpe", "Adjoint qui remplace au pied levé", "Marié pressé", "Témoin en retard", "Photographe officiel", "Employée de l'état civil", "Invité resté du mariage précédent"],
  },
  {
    name: "Salle d'attente des urgences",
    theme: T.public,
    roles: ["Infirmier d'accueil", "Patient au doigt d'une couleur étrange", "Hypocondriaque de garde", "Enfant avec un Lego dans le nez", "Médecin à sa 36e heure", "Patient qui attend « depuis six heures »", "Vigile de nuit"],
  },

  // ⚔️ Aventure & extrême
  {
    name: "Base secrète de super-vilain",
    theme: T.aventure,
    roles: ["Vilain mégalomane", "Bras droit incompétent", "Scientifique kidnappé", "Stagiaire du mal", "Garde n°7", "Espion infiltré (un autre)", "Technicienne de surface du volcan"],
  },
  {
    name: "Expédition sur Mars",
    theme: T.aventure,
    roles: ["Commandante", "Botaniste optimiste", "Ingénieur qui répare tout au scotch", "Touriste milliardaire", "Géologue émerveillé", "Médecin de mission", "Passager clandestin inexplicable"],
  },
  {
    name: "Château hanté",
    theme: T.aventure,
    roles: ["Fantôme du comte", "Chasseuse de fantômes suréquipée", "Médium approximative", "Héritier sceptique", "Majordome centenaire", "Touriste à caméra thermique", "Guide de la visite nocturne"],
  },
  {
    name: "Donjon médiéval-fantastique",
    theme: T.aventure,
    roles: ["Chevalier niveau 1", "Magicienne à court de mana", "Nain grognon", "Barde inutile mais motivé", "Gobelin syndiqué", "Marchand ambulant des couloirs", "Voleuse du groupe"],
  },
  {
    name: "Camp d'entraînement de ninjas",
    theme: T.aventure,
    roles: ["Maître zen", "Élève très bruyant pour un ninja", "Ninja vedette du dojo", "Cuisinier du camp", "Espion d'un clan rival", "Inscrit qui croyait à un cours de yoga", "Forgeron de shurikens"],
  },
  {
    name: "Saloon du Far West",
    theme: T.aventure,
    roles: ["Shérif", "Hors-la-loi recherché", "Barman qui essuie toujours le même verre", "Pianiste qui s'arrête quand quelqu'un entre", "Chercheuse d'or", "Joueur de poker tricheur", "Croque-mort optimiste"],
  },
  {
    name: "Supermarché barricadé en pleine apocalypse zombie",
    theme: T.aventure,
    roles: ["Chef autoproclamé", "Survivante pragmatique", "Mordu qui le cache", "Ado qui gaspille les munitions", "Mamie d'un calme olympien", "Scientifique en quête de remède", "Pillard repenti"],
  },

  // 🍕 Bouffe & boisson
  {
    name: "Kebab à 3 h du matin",
    theme: T.bouffe,
    roles: ["Patron philosophe", "Client affamé post-soirée", "Duo en train de devenir un couple", "Client qui pleure sur ses frites", "Livreur en pause", "Habitué du « comme d'habitude »", "Végétarien arrivé là par erreur"],
  },
  {
    name: "Restaurant gastronomique étoilé",
    theme: T.bouffe,
    roles: ["Chef tyrannique", "Critique incognito", "Client qui ne comprend pas le menu", "Sommelier lyrique", "Plongeur philosophe", "Serveur au ballet millimétré", "Client qui demande du ketchup"],
  },
  {
    name: "Cours de cuisine",
    theme: T.bouffe,
    roles: ["Chef pédagogue", "Élève qui brûle tout", "Élève qui a « déjà fait mieux »", "Moitié de couple en activité imposée", "Mamie meilleure que le chef", "Élève qui goûte trop la pâte", "Assistant qui nettoie en silence"],
  },
  {
    name: "Dégustation dans une cave à vin",
    theme: T.bouffe,
    roles: ["Œnologue lyrique", "Client qui recrache", "Client qui ne recrache jamais", "Novice qui trouve que « ça sent le vin »", "Sommelière", "Propriétaire du domaine", "Acheteur professionnel"],
  },
  {
    name: "Fast-food à minuit",
    theme: T.bouffe,
    roles: ["Équipier étudiant", "Manager de 22 ans", "Client perdu devant la borne", "Table d'anniversaire tardive", "Livreur qui attend la commande 847", "Client qui réclame le menu du matin", "Habitué du drive… à pied"],
  },
  {
    name: "Buffet à volonté",
    theme: T.bouffe,
    roles: ["Gérant inquiet", "Stratège de l'assiette niveau 9", "Enfant lâché au bar à desserts", "Cuisinier qui regarnit sans fin", "Cliente au septième passage", "Moitié de couple officiellement au régime", "Inspecteur d'hygiène en visite"],
  },
  {
    name: "Boulangerie du village",
    theme: T.bouffe,
    roles: ["Boulanger debout depuis 4 h", "Vendeuse au sourire commercial", "Mamie de 7 h 02 précises", "Client de la baguette « bien cuite »", "Touriste qui veut un croissant à 17 h", "Apprenti enfariné", "Représentant en farine"],
  },

  // 🤪 Insolite & imaginaire
  {
    name: "Convention de sosies d'Elvis",
    theme: T.insolite,
    roles: ["Sosie vétéran", "Sosie débutant", "Sosie qui ne ressemble à rien", "Organisateur en costume à paillettes", "Fan de la première heure", "Juge du concours", "Vendeur de perruques"],
  },
  {
    name: "Réunion secrète des Illuminati",
    theme: T.insolite,
    roles: ["Grand Maître", "Nouveau qui a mal lu l'invitation", "Trésorier des fonds secrets", "Complotiste infiltré absolument ravi", "Stagiaire en charge des bougies", "Membre au déguisement de lézard douteux", "Secrétaire qui rédige le compte rendu du complot"],
  },
  {
    name: "Village viking",
    theme: T.insolite,
    roles: ["Jarl", "Berserker très doux", "Forgeronne", "Explorateur obsédé par l'ouest", "Druide météorologue", "Rameur fatigué", "Poète scalde envahissant"],
  },
  {
    name: "Maison de retraite pour super-héros",
    theme: T.insolite,
    roles: ["Ex-justicier nostalgique", "Infirmière blindée", "Super-vilain réconcilié", "Héros au pouvoir en panne", "Acolyte devenu directeur", "Fan en visite", "Journaliste en quête de scoop"],
  },
  {
    name: "Cours de yoga pour chiens",
    theme: T.insolite,
    roles: ["Prof d'un calme absolu", "Chienne star d'Instagram", "Maître plus stressé que son chien", "Carlin qui dort depuis le début", "Berger allemand premier de la classe", "Débutant traîné par sa compagne", "Chat infiltré"],
  },
  {
    name: "Bureau des objets trouvés",
    theme: T.insolite,
    roles: ["Fonctionnaire du rayon parapluies", "Client qui cherche son dentier", "Détective des valises orphelines", "Collectionneur un peu suspect", "Touriste qui a absolument tout perdu", "Employé qui garde les objets cool", "Enfant venu pour son doudou"],
  },
  {
    name: "Concours du plus gros légume",
    theme: T.insolite,
    roles: ["Juré de la foire agricole", "Agriculteur favori du concours", "Rival jaloux", "Mamie aux citrouilles suspectes", "Journaliste de la gazette locale", "Maire qui remet le prix", "Inspecteur anti-dopage végétal"],
  },
];

module.exports = {
  spyfall1: { label: "Spyfall 1", locations: spyfall1 },
  spyfall2: { label: "Spyfall 2", locations: spyfall2 },
  both: { label: "Spyfall 1 + 2", locations: [...spyfall1, ...spyfall2] },
  delire: { label: "Délire (RP)", locations: delire },
  tout: { label: "Tout", locations: [...spyfall1, ...spyfall2, ...delire] },
};
