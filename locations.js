// Paquets de lieux, en français.
// - spyfall1 : les 27 lieux officiels de la 1re édition (7 rôles officiels)
// - spyfall2 : les 25 lieux officiels de Spyfall 2 (10 rôles officiels)
// - delire   : 70 lieux originaux taillés pour le roleplay (9 rôles chacun)
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
    roles: ["Pilote qui rassure un peu trop", "Hôtesse à bout de nerfs", "Passager qui applaudit à l'atterrissage", "Passager du siège du milieu", "Influenceur qui filme « sa première classe »", "Passager au bagage très limite", "Mamie qui offre des bonbons à tout l'avion", "Steward qui vend des billets à gratter", "Passager qui n'a pas payé le supplément bagage"],
  },
  {
    name: "Covoiturage de 8 heures",
    theme: T.transport,
    roles: ["Conducteur fier de sa playlist douteuse", "Passager qui parle depuis Lyon", "Passagère qui fait semblant de dormir", "Étudiant fauché", "Passager qui mange un kebab", "Copilote autoproclamé du GPS", "Passagère avec un chat pas prévu", "Passager qui propose de « mettre un son »", "Passager qui critique la conduite en silence (mais fort)"],
  },
  {
    name: "Croisière du troisième âge",
    theme: T.transport,
    roles: ["Animateur sous pression", "Capitaine en fin de carrière", "Retraitée reine du buffet", "Couple qui se dispute depuis l'embarquement", "Magicien has-been", "Serveur trop bronzé", "Jeune monté sur le mauvais bateau", "Prof de danse de salon très demandé", "Veuve très entourée"],
  },
  {
    name: "Téléphérique bloqué",
    theme: T.transport,
    roles: ["Technicien qui répète que « c'est normal »", "Touriste qui panique", "Guide de montagne très zen", "Enfant absolument ravi", "Couple en lune de miel", "Influenceuse qui filme tout", "Skieur qui rate son après-midi", "Passager qui avait justement très envie de faire pipi", "Papy qui raconte la panne de 1987"],
  },
  {
    name: "Aire d'autoroute un 15 août",
    theme: T.transport,
    roles: ["Pompiste débordé", "Père de famille au bord du craquage", "Enfant momentanément égaré", "Routier philosophe", "Caissière blasée", "Motard en combinaison intégrale", "Vacancier dans la file des toilettes", "Ado scotché à la machine à pinces", "Chauffeur de colonie qui recompte les enfants"],
  },
  {
    name: "Taxi de nuit",
    theme: T.transport,
    roles: ["Chauffeur philosophe", "Client de fin de soirée", "Couple qui se dispute à l'arrière", "Touriste qui surveille le compteur", "Stagiaire en retard pour son premier jour", "DJ avec tout son matos", "Client qui a oublié son portefeuille", "Cliente qui raconte toute sa vie", "Client persuadé de connaître un raccourci"],
  },
  {
    name: "Vol en montgolfière",
    theme: T.transport,
    roles: ["Pilote étrangement calme", "Passager avec le vertige", "Photographe de paysages", "Amoureux qui prépare sa demande", "Gagnante d'un concours", "Instructeur bavard", "Enfant qui veut toucher les nuages", "Passager qui demande où sont les toilettes", "Contrôleur aérien à la retraite très stressé"],
  },

  // 🌴 Nature & vacances
  {
    name: "Camping municipal",
    theme: T.nature,
    roles: ["Gérant tatillon sur le règlement", "Campeur installé là depuis 1998", "Famille sous l'orage", "Animateur du tournoi de pétanque", "Ado en quête de wifi", "Voisin de tente bruyant", "Randonneur qui s'est trompé de camping", "Roi du barbecue autoproclamé", "Gamin à vélo dès 6 h du matin"],
  },
  {
    name: "Club de vacances tout inclus",
    theme: T.nature,
    roles: ["Animateur survolté", "Stratège du buffet", "Maître-nageur dragueur", "Enfant roi du mini-club", "DJ de la piscine", "Retraité au transat dès 6 h", "Serveur de cocktails à fleurs", "Champion contesté du tournoi de fléchettes", "Touriste qui réserve les transats à la serviette"],
  },
  {
    name: "Randonnée en haute montagne",
    theme: T.nature,
    roles: ["Guide trop optimiste", "Randonneur suréquipé", "Randonneur en tongs", "Berger pas impressionné", "Influenceuse en legging", "Secouriste de permanence", "Retardataire du groupe", "Papa qui jure que « c'est plus très loin »", "Traileur qui double tout le monde en courant"],
  },
  {
    name: "Île déserte après naufrage",
    theme: T.nature,
    roles: ["Capitaine déchu", "Survivaliste secrètement ravi", "Touriste qui bronze quand même", "Cuisinier sans rien à cuisiner", "Optimiste qui construit un radeau", "Pessimiste officiel du groupe", "Naufragé qui parle à une noix de coco", "Influenceuse qui poste sans réseau", "Comptable qui fait l'inventaire des bananes"],
  },
  {
    name: "Jardin partagé du quartier",
    theme: T.nature,
    roles: ["Président du jardin un peu tyrannique", "Mamie aux tomates légendaires", "Passionné de permaculture", "Voleur de courgettes", "Enfant qui piétine les semis", "Apiculteur anxieux", "Membre qui n'a jamais rien planté", "Retraité qui arrose même quand il pleut", "Ado en travaux d'intérêt général pas concerné"],
  },
  {
    name: "Safari photo",
    theme: T.nature,
    roles: ["Guide qui exagère chaque anecdote", "Touriste imprudent", "Photographe professionnel", "Enfant qui veut caresser les lions", "Chauffeur de 4x4", "Influenceur déçu par le réseau", "Ranger fatigué des touristes", "Mamie qui trouve que « le lion a l'air gentil »", "Stagiaire vétérinaire émerveillée"],
  },
  {
    name: "Station de ski en plein redoux",
    theme: T.nature,
    roles: ["Moniteur qui garde le sourire", "Skieur débutant", "Snowboardeur fanfaron", "Vendeur de forfaits embarrassé", "Pisteur fataliste", "Touriste en doudoune léopard", "Enfant échappé de la garderie", "Skieur en jean", "DJ de l'après-ski"],
  },

  // 🎉 Fête & soirée
  {
    name: "Enterrement de vie de garçon",
    theme: T.fete,
    roles: ["Futur marié déguisé en licorne", "Témoin organisateur dépassé", "Pote relou", "Pote raisonnable qui surveille tout", "Inconnu incrusté au groupe", "Pote qui filme absolument tout", "Serveur complice", "Pote qui a « un plan »", "Chauffeur de limousine blasé"],
  },
  {
    name: "Réveillon du Nouvel An",
    theme: T.fete,
    roles: ["Hôte stressé par son four", "Invité déjà ivre à 22 h", "Moitié de couple qui attend minuit", "Personne qui appelle sa mère à 00 h 01", "DJ amateur à la playlist contestée", "Voisin venu se plaindre, resté pour le buffet", "Enfant caché sous la table", "Invité qui lance le débat politique", "Cousin venu avec un tupperware vide"],
  },
  {
    name: "Anniversaire surprise raté",
    theme: T.fete,
    roles: ["Organisatrice paniquée", "Fêté pas surpris du tout", "Invité arrivé trop tôt", "Pote qui a vendu la mèche", "Livreur de gâteau en retard", "Ex pas invité mais présent", "Cousin éloigné que personne ne reconnaît", "Pote caché derrière le canapé depuis 40 minutes", "Maître du chien qui a goûté le gâteau"],
  },
  {
    name: "Soirée jeux de société",
    theme: T.fete,
    roles: ["Maître du jeu tyrannique", "Mauvais perdant notoire", "Tricheur en exercice", "Débutante qui gagne tout", "Celui qui lit les règles à voix haute", "Spectateur qui commente sans jouer", "Invité venu juste pour discuter", "Joueur qui « connaît une variante »", "Moitié de couple qui règle ses comptes via le jeu"],
  },
  {
    name: "Karaoké de quartier",
    theme: T.fete,
    roles: ["Patron mélomane", "Étoile déchue du dimanche", "Groupe d'enterrement de vie de jeune fille", "Habitué de la même chanson depuis dix ans", "Couple en duo dramatique", "Client qui attend son tour depuis deux heures", "Serveur aux bouchons d'oreilles", "Type qui prend Bohemian Rhapsody en entier", "Inconnu étonnamment doué"],
  },
  {
    name: "Festival de musique sous la boue",
    theme: T.fete,
    roles: ["Festivalier prévoyant en bottes", "Festivalier en claquettes", "Vendeur de ponchos en or", "Agent de sécurité stoïque", "Chanteur de la scène secondaire", "Égaré qui cherche ses potes depuis hier", "Ingé son sous la pluie", "Festivalier qui a perdu une botte", "Couple qui s'est rencontré ici l'an dernier"],
  },
  {
    name: "Crémaillère dans 20 m²",
    theme: T.fete,
    roles: ["Hôte très fier de son studio", "Invitée coincée dans la kitchenette", "Pote qui offre une plante", "Voisin curieux", "Couple assis sur le lit", "Pote qui a ramené six inconnus", "Invité qui remonte déjà l'étagère", "Ex du propriétaire venue « en amie »", "Pote qui calcule le loyer au m²"],
  },

  // 💼 Boulot & commerce
  {
    name: "Réunion qui aurait pu être un mail",
    theme: T.boulot,
    roles: ["Manager à slides", "Stagiaire qui note tout", "Collègue qui pose LA question à 17 h 59", "Dormeur discret du fond", "Collègue en visio figée", "RH enthousiaste", "Consultant en buzzwords", "Collègue qui répète ce qu'on vient de dire, en plus fort", "Responsable du vidéoprojecteur qui ne marche pas"],
  },
  {
    name: "Start-up en levée de fonds",
    theme: T.boulot,
    roles: ["CEO visionnaire", "CTO épuisé", "Stagiaire payé en tickets resto", "Investisseur sceptique", "Growth hacker mystérieux", "Office manager du baby-foot", "Employé qui ignore ce que fait la boîte", "Coach agile", "Dev qui déploie en prod un vendredi"],
  },
  {
    name: "Marché du dimanche",
    theme: T.boulot,
    roles: ["Maraîcher gouailleur", "Fromager généreux en échantillons", "Mamie qui négocie tout", "Touriste qui photographie les légumes", "Poissonnier tonitruant", "Cliente au panier en osier", "Goûteur professionnel jamais acheteur", "Vendeur d'olives qui fait goûter de force", "Élu local en tournée de poignées de main"],
  },
  {
    name: "Magasin de meubles suédois",
    theme: T.boulot,
    roles: ["Vendeur introuvable", "Couple au bord de la rupture", "Enfant perdu dans les showrooms", "Client qui teste tous les canapés", "Pro des raccourcis du magasin", "Client venu juste pour les boulettes", "Étudiant qui meuble son premier appart", "Couple qui teste le lit trop longtemps", "Vendeur de hot-dogs de la sortie"],
  },
  {
    name: "Centre d'appels",
    theme: T.boulot,
    roles: ["Téléconseiller zen", "Nouveau qui découvre le script", "Collègue en pause café permanente", "Manager motivationnel", "Téléconseillère vedette du plateau", "Stagiaire au casque cassé", "Syndicaliste vigilant", "Conseiller qui change d'accent à chaque appel", "Employé du mois depuis quatorze mois"],
  },
  {
    name: "Salon de coiffure de quartier",
    theme: T.boulot,
    roles: ["Coiffeuse bavarde", "Client qui voulait « juste les pointes »", "Mamie sous le casque", "Apprenti au balai", "Client endormi", "Cliente à la couleur ratée", "Habitué du samedi matin", "Représentant en shampoings", "Client qui montre une photo de footballeur"],
  },
  {
    name: "Vide-grenier",
    theme: T.boulot,
    roles: ["Organisateur au mégaphone", "Vendeur trop attaché à ses objets", "Acheteuse négociatrice impitoyable", "Collectionneur de vinyles", "Enfant qui vend ses jouets à contrecœur", "Brocanteur pro déguisé en amateur", "Voisin qui vend les affaires de son ex", "Vendeur d'un seul objet : un jacuzzi", "Chineuse arrivée à 6 h avec une lampe frontale"],
  },

  // 🎭 Culture & spectacle
  {
    name: "Tournage de télé-réalité",
    theme: T.culture,
    roles: ["Candidat stratège", "Candidate venue « pour l'aventure »", "Caméraman blasé", "Producteur machiavélique", "Éliminé qui traîne encore sur le plateau", "Psy de production", "Monteur qui invente l'histoire", "Candidat qui parle de lui à la troisième personne", "Infirmier du plateau"],
  },
  {
    name: "Vernissage d'art contemporain",
    theme: T.culture,
    roles: ["Artiste incompris", "Critique en écharpe", "Invité venu pour le buffet", "Collectionneur snob", "Galeriste en pleine vente", "Visiteur qui hoche la tête sans comprendre", "Agent d'entretien qui a failli jeter l'œuvre", "Mécène qui admire l'extincteur", "Stagiaire qui ressert le champagne trop vite"],
  },
  {
    name: "Plateau de cinéma de série Z",
    theme: T.culture,
    roles: ["Réalisateur passionné", "Acteur principal cabotin", "Cascadeuse sous-payée", "Maquilleur d'effets douteux", "Figurant zombie", "Producteur fauché", "Perchman maudit", "Acteur dans le costume du monstre en mousse", "Scripte qui a renoncé à la cohérence"],
  },
  {
    name: "Escape game",
    theme: T.culture,
    roles: ["Game master au micro", "Joueur qui fouille même le plafond", "Joueuse qui a déjà tout résolu", "Paniqué des pièces fermées", "Celui qui casse le décor", "Collègue en team building forcé", "Couple en rendez-vous galant", "Joueur qui demande un indice toutes les 30 secondes", "Claustrophobe qui l'a découvert trop tard"],
  },
  {
    name: "Scène ouverte de stand-up",
    theme: T.culture,
    roles: ["Humoriste qui débute", "Humoriste qui « teste du nouveau matériel »", "Patron du bar", "Spectatrice du premier rang", "Chahuteur professionnel", "Pote venu soutenir", "Serveuse qui a tout entendu cent fois", "Humoriste qui ne parle que de son ex", "Vidéaste qui filme « pour les réseaux »"],
  },
  {
    name: "Émission de cuisine en direct",
    theme: T.culture,
    roles: ["Chef juré impitoyable", "Candidat au bord des larmes", "Candidate beaucoup trop sûre d'elle", "Présentateur survolté", "Caméraman affamé", "Coach culinaire en coulisses", "Plongeur du studio", "Candidat qui refait un flan pour la troisième fois", "Nutritionniste de plateau jamais écoutée"],
  },
  {
    name: "Opéra",
    theme: T.culture,
    roles: ["Diva", "Ténor enrhumé", "Chef d'orchestre", "Spectateur endormi au premier acte", "Mécène du premier rang", "Ouvreuse", "Critique impitoyable", "Spectateur dont le téléphone sonne", "Doublure qui attend son heure depuis vingt ans"],
  },

  // ⚽ Sport & loisirs
  {
    name: "Salle de sport en janvier",
    theme: T.sport,
    roles: ["Coach débordant de motivation", "Résolutionnaire du 1er janvier", "Bodybuilder fasciné par le miroir", "Squatteuse du seul rameur", "Nouveau complètement perdu", "Vendeur de protéines", "Habitué qui ne range jamais ses poids", "Couple qui s'entraîne en synchronisé", "Type qui filme chaque série"],
  },
  {
    name: "Match de foot de district",
    theme: T.sport,
    roles: ["Arbitre contesté", "Gardien poète", "Buteur vétéran", "Parent ultra en tribune", "Coach en survêtement intégral", "Remplaçant frigorifié", "Responsable de la buvette", "Attaquant qui réclame un penalty à chaque contact", "Mascotte du club en costume de blaireau"],
  },
  {
    name: "Tournoi d'échecs",
    theme: T.sport,
    roles: ["Grand maître arrogant", "Prodige de neuf ans", "Joueur qui réfléchit quarante minutes", "Arbitre du silence", "Parent plus stressé que l'enfant", "Joueur qui propose nulle à tout le monde", "Spectateur qui n'y comprend rien", "Joueur qui mange des chips très fort", "Streameuse qui commente en chuchotant"],
  },
  {
    name: "Laser game d'anniversaire",
    theme: T.sport,
    roles: ["Gamin tireur d'élite", "Papa beaucoup trop investi", "Ado blasé", "Animateur du briefing", "Campeur assumé", "Joueur qui a oublié ses lunettes", "Équipier traître", "Gamine qui connaît tous les recoins", "Tonton qui transpire dès le briefing"],
  },
  {
    name: "Piscine municipale",
    theme: T.sport,
    roles: ["Maître-nageur au sifflet facile", "Tyran du couloir de nage", "Star de l'aquagym", "Enfant du grand plongeoir", "Ado qui parade", "Caissière des entrées", "Baigneur au bonnet réglementaire", "Champion local de la bombe", "Prof d'aquabike sur son podium"],
  },
  {
    name: "Marathon",
    theme: T.sport,
    roles: ["Coureur déguisé en banane", "Athlète d'élite", "Coureur qui marche dès le 3e kilomètre", "Bénévole du ravitaillement", "Supporter à pancarte", "Médecin de course", "Journaliste essoufflé", "Coureur inscrit à cause d'un pari", "Papy qui finit toujours, peu importe l'heure"],
  },
  {
    name: "Bowling",
    theme: T.sport,
    roles: ["Champion de la ligue locale", "Abonné de la gouttière", "Enfant avec la rampe", "Serveur de nachos", "Joueur venu avec sa propre boule", "Couple en premier rendez-vous", "Technicien des quilles", "Joueur qui danse après chaque strike", "Animateur de l'anniversaire de la piste 4"],
  },

  // 🏛️ Institutions & public
  {
    name: "Guichet de la préfecture",
    theme: T.public,
    roles: ["Agent du guichet 4", "Usager au mauvais guichet", "Détenteur du ticket 842", "Stagiaire de la préfecture", "Vigile", "Usager endormi", "Dame qui a « juste une petite question »", "Usager à qui il manque LA photocopie", "Agent qui part en pause à 11 h 58"],
  },
  {
    name: "Cabinet de dentiste",
    theme: T.public,
    roles: ["Dentiste qui pose des questions la bouche pleine", "Patient terrorisé", "Assistante dentaire", "Enfant venu pour l'autocollant", "Patient qui jure ne pas avoir mal", "Commercial en matériel dentaire", "Patiente très en retard", "Patient qui répond la bouche grande ouverte", "Enfant qui mord"],
  },
  {
    name: "Examen du permis de conduire",
    theme: T.public,
    roles: ["Inspecteur impassible", "Candidat à la cinquième tentative", "Candidate trop confiante", "Moniteur fataliste", "Élève du créneau éternel", "Secrétaire de l'auto-école", "Candidat qui cale au rond-point", "Inspecteur qui freine de son côté", "Candidate qui remercie à chaque stop"],
  },
  {
    name: "Tribunal pour litige de voisinage",
    theme: T.public,
    roles: ["Juge fatigué", "Plaignant de la haie de thuyas", "Accusé du barbecue dominical", "Avocat commis d'office", "Témoin mythomane", "Greffière imperturbable", "Voisin venu pour le spectacle", "Expert assermenté en haies de thuyas", "Maire venu témoigner pour les deux camps"],
  },
  {
    name: "Caserne de pompiers",
    theme: T.public,
    roles: ["Capitaine", "Jeune recrue zélée", "Cuisinier de la caserne", "Pompier du calendrier", "Standardiste du 18", "Vétéran nostalgique", "Élève en visite scolaire", "Propriétaire du chat coincé dans l'arbre", "Photographe du calendrier"],
  },
  {
    name: "Mairie un jour de mariage",
    theme: T.public,
    roles: ["Maire à l'écharpe", "Adjoint qui remplace au pied levé", "Marié pressé", "Témoin en retard", "Photographe officiel", "Employée de l'état civil", "Invité resté du mariage précédent", "Mamie qui pleure dès le couloir", "Enfant d'honneur qui a perdu les alliances"],
  },
  {
    name: "Salle d'attente des urgences",
    theme: T.public,
    roles: ["Infirmier d'accueil", "Patient au doigt d'une couleur étrange", "Hypocondriaque de garde", "Enfant avec un Lego dans le nez", "Médecin à sa 36e heure", "Patient qui attend « depuis six heures »", "Vigile de nuit", "Blessé déguisé en Superman", "Patiente qui diagnostique tout le monde grâce à Internet"],
  },

  // ⚔️ Aventure & extrême
  {
    name: "Base secrète de super-vilain",
    theme: T.aventure,
    roles: ["Vilain mégalomane", "Bras droit incompétent", "Scientifique kidnappé", "Stagiaire du mal", "Garde n°7", "Espion infiltré (un autre)", "Technicienne de surface du volcan", "Responsable du bassin à requins", "Stagiaire qui a laissé la porte du hangar ouverte"],
  },
  {
    name: "Expédition sur Mars",
    theme: T.aventure,
    roles: ["Commandante", "Botaniste optimiste", "Ingénieur qui répare tout au scotch", "Touriste milliardaire", "Géologue émerveillé", "Médecin de mission", "Passager clandestin inexplicable", "Astronaute qui a le mal de l'espace", "Community manager de la mission"],
  },
  {
    name: "Château hanté",
    theme: T.aventure,
    roles: ["Fantôme du comte", "Chasseuse de fantômes suréquipée", "Médium approximative", "Héritier sceptique", "Majordome centenaire", "Touriste à caméra thermique", "Guide de la visite nocturne", "Fantôme timide qui n'ose pas hanter", "Agent immobilier qui tente quand même de vendre"],
  },
  {
    name: "Donjon médiéval-fantastique",
    theme: T.aventure,
    roles: ["Chevalier niveau 1", "Magicienne à court de mana", "Nain grognon", "Barde inutile mais motivé", "Gobelin syndiqué", "Marchand ambulant des couloirs", "Voleuse du groupe", "Paladin au code d'honneur encombrant", "Squelette réceptionniste"],
  },
  {
    name: "Camp d'entraînement de ninjas",
    theme: T.aventure,
    roles: ["Maître zen", "Élève très bruyant pour un ninja", "Ninja vedette du dojo", "Cuisinier du camp", "Espion d'un clan rival", "Inscrit qui croyait à un cours de yoga", "Forgeron de shurikens", "Ninja qui fait craquer toutes les lattes du plancher", "Vendeur de fumigènes"],
  },
  {
    name: "Saloon du Far West",
    theme: T.aventure,
    roles: ["Shérif", "Hors-la-loi recherché", "Barman qui essuie toujours le même verre", "Pianiste qui s'arrête quand quelqu'un entre", "Chercheuse d'or", "Joueur de poker tricheur", "Croque-mort optimiste", "Cowboy qui rate le crachoir", "Chanteuse de saloon"],
  },
  {
    name: "Supermarché barricadé en pleine apocalypse zombie",
    theme: T.aventure,
    roles: ["Chef autoproclamé", "Survivante pragmatique", "Mordu qui le cache", "Ado qui gaspille les munitions", "Mamie d'un calme olympien", "Scientifique en quête de remède", "Pillard repenti", "Type qui veut « juste discuter » avec les zombies", "Gérant qui fait encore payer aux caisses"],
  },

  // 🍕 Bouffe & boisson
  {
    name: "Kebab à 3 h du matin",
    theme: T.bouffe,
    roles: ["Patron philosophe", "Client affamé post-soirée", "Duo en train de devenir un couple", "Client qui pleure sur ses frites", "Livreur en pause", "Habitué du « comme d'habitude »", "Végétarien arrivé là par erreur", "Videur du bar d'à côté en pause", "Cliente qui jure qu'elle ne boira plus jamais"],
  },
  {
    name: "Restaurant gastronomique étoilé",
    theme: T.bouffe,
    roles: ["Chef tyrannique", "Critique incognito", "Client qui ne comprend pas le menu", "Sommelier lyrique", "Plongeur philosophe", "Serveur au ballet millimétré", "Client qui demande du ketchup", "Deuxième inspecteur incognito (ils s'ignorent)", "Cliente qui photographie chaque micro-portion"],
  },
  {
    name: "Cours de cuisine",
    theme: T.bouffe,
    roles: ["Chef pédagogue", "Élève qui brûle tout", "Élève qui a « déjà fait mieux »", "Moitié de couple en activité imposée", "Mamie meilleure que le chef", "Élève qui goûte trop la pâte", "Assistant qui nettoie en silence", "Élève qui filme sa story au lieu de cuisiner", "Voisin attiré par l'odeur"],
  },
  {
    name: "Dégustation dans une cave à vin",
    theme: T.bouffe,
    roles: ["Œnologue lyrique", "Client qui recrache", "Client qui ne recrache jamais", "Novice qui trouve que « ça sent le vin »", "Sommelière", "Propriétaire du domaine", "Acheteur professionnel", "Client qui détecte « des notes de banane »", "Chauffeur désigné au regard triste"],
  },
  {
    name: "Fast-food à minuit",
    theme: T.bouffe,
    roles: ["Équipier étudiant", "Manager de 22 ans", "Client perdu devant la borne", "Table d'anniversaire tardive", "Livreur qui attend la commande 847", "Client qui réclame le menu du matin", "Habitué du drive… à pied", "Équipe de basket au complet", "Client qui philosophe au comptoir"],
  },
  {
    name: "Buffet à volonté",
    theme: T.bouffe,
    roles: ["Gérant inquiet", "Stratège de l'assiette niveau 9", "Enfant lâché au bar à desserts", "Cuisinier qui regarnit sans fin", "Cliente au septième passage", "Moitié de couple officiellement au régime", "Inspecteur d'hygiène en visite", "Papy qui emporte des crevettes en douce", "Ado lancé dans le défi du bar à piments"],
  },
  {
    name: "Boulangerie du village",
    theme: T.bouffe,
    roles: ["Boulanger debout depuis 4 h", "Vendeuse au sourire commercial", "Mamie de 7 h 02 précises", "Client de la baguette « bien cuite »", "Touriste qui veut un croissant à 17 h", "Apprenti enfariné", "Représentant en farine", "Enfant envoyé avec la monnaie comptée", "Cliente du dimanche aux douze croissants"],
  },

  // 🤪 Insolite & imaginaire
  {
    name: "Convention de sosies d'Elvis",
    theme: T.insolite,
    roles: ["Sosie vétéran", "Sosie débutant", "Sosie qui ne ressemble à rien", "Organisateur en costume à paillettes", "Fan de la première heure", "Juge du concours", "Vendeur de perruques", "Sosie de Johnny qui s'est trompé de salon", "Coiffeur spécialiste de la banane"],
  },
  {
    name: "Réunion secrète des Illuminati",
    theme: T.insolite,
    roles: ["Grand Maître", "Nouveau qui a mal lu l'invitation", "Trésorier des fonds secrets", "Complotiste infiltré absolument ravi", "Stagiaire en charge des bougies", "Membre au déguisement de lézard douteux", "Secrétaire qui rédige le compte rendu du complot", "Livreur de pizzas assermenté", "Membre qui pose beaucoup trop de questions"],
  },
  {
    name: "Village viking",
    theme: T.insolite,
    roles: ["Jarl", "Berserker très doux", "Forgeronne", "Explorateur obsédé par l'ouest", "Druide météorologue", "Rameur fatigué", "Poète scalde envahissant", "Viking végétarien", "Capitaine de drakkar qui a le mal de mer"],
  },
  {
    name: "Maison de retraite pour super-héros",
    theme: T.insolite,
    roles: ["Ex-justicier nostalgique", "Infirmière blindée", "Super-vilain réconcilié", "Héros au pouvoir en panne", "Acolyte devenu directeur", "Fan en visite", "Journaliste en quête de scoop", "Kiné spécialiste des super-dos", "Ancien méchant qui anime le loto"],
  },
  {
    name: "Cours de yoga pour chiens",
    theme: T.insolite,
    roles: ["Prof d'un calme absolu", "Chienne star d'Instagram", "Maître plus stressé que son chien", "Carlin qui dort depuis le début", "Berger allemand premier de la classe", "Débutant traîné par sa compagne", "Chat infiltré", "Chihuahua anxieux", "Stagiaire préposé aux petits accidents"],
  },
  {
    name: "Bureau des objets trouvés",
    theme: T.insolite,
    roles: ["Fonctionnaire du rayon parapluies", "Client qui cherche son dentier", "Détective des valises orphelines", "Collectionneur un peu suspect", "Touriste qui a absolument tout perdu", "Employé qui garde les objets cool", "Enfant venu pour son doudou", "Musicien qui a perdu son tuba", "Dame venue « juste regarder »"],
  },
  {
    name: "Concours du plus gros légume",
    theme: T.insolite,
    roles: ["Juré de la foire agricole", "Agriculteur favori du concours", "Rival jaloux", "Mamie aux citrouilles suspectes", "Journaliste de la gazette locale", "Maire qui remet le prix", "Inspecteur anti-dopage végétal", "Reporter radio en direct", "Petit-fils qui s'ennuie fermement"],
  },
];

// ─── Délire 2 (corsé/adulte) ───────────────────────────────────────────────
// Deuxième paquet, thèmes propres à ce pack. Doublons retirés :
// « Réunion secrète des Illuminati » (déjà dans Délire), « Cirque » (≈ Chapiteau
// de cirque), « Test permis » (≈ Examen du permis), « Compétition d'esport »
// (fondu dans « Finale d'esport en LAN »), « L'Arche de Noé » (fondu dans
// « Arche de Noé — choix des animaux »).
const T2 = {
  sulfureux: "🔞 Sulfureux",
  sombre: "💀 Sombre & glauque",
  crime: "🔫 Crime & clandestin",
  histoire: "🏛️ Histoire & grandes aventures",
  audela: "⚡ Mythes & au-delà",
  malaise: "😬 Malaise social",
  jeux: "🎮 Jeux & compétition",
  fete: "🎤 Fête survoltée",
  galere: "🚦 Galères du quotidien",
  absurde: "🤪 Absurde & fantastique",
};

const delire2 = [
  { name: "Char de Gay Pride", theme: T2.fete, roles: ["Drag queen sur talons de 30 cm", "DJ torse nu", "Go-go danseur sur le toit du char", "Militant à pancarte", "Maman qui soutient son fils", "Photographe de presse", "Touriste un peu perdu", "Policier qui tape discrètement du pied", "Chauffeur du char qui ne voit rien"] },
  { name: "Coffee shop d'Amsterdam", theme: T2.sulfureux, roles: ["Touriste qui a abusé du space cake", "Gérant très zen", "Habitué local blasé", "Étudiant en Erasmus", "Novice qui tousse", "Vendeur expert en variétés", "Couple en mode philosophe", "Touriste qui cherche juste un vrai café", "Chat du coffee shop, très détendu"] },
  { name: "Caves d'un squat punk à chien", theme: T2.fete, roles: ["Punk à chien et son clébard", "Chanteur qui hurle dans le micro", "Tatoueur amateur du fond", "Mec qui fait un feu dans un bidon", "Vendeur de bière tiède", "Anarchiste théoricien", "Fugueur de 16 ans", "Voisin venu se plaindre", "Le chien, vraie star des lieux"] },
  { name: "Strip club", theme: T2.sulfureux, roles: ["Danseuse vedette", "Videur impassible", "Client beaucoup trop généreux", "Enterrement de vie de garçon au complet", "DJ", "Patron un peu louche", "Serveuse qui esquive", "Client qui pleure au bar", "Habitué qui connaît tous les prénoms"] },
  { name: "Club échangiste & BDSM", theme: T2.sulfureux, roles: ["Maître de cérémonie en cuir", "Couple débutant intimidé", "Habitué très à l'aise", "Videur en harnais", "Curieux venu juste regarder", "Dominatrice professionnelle", "Soumis volontaire", "Barman en tenue minimale", "Personne qui croyait à une soirée normale"] },
  { name: "Camp naturiste", theme: T2.sulfureux, roles: ["Animateur tout nu et fier", "Nouveau qui garde sa serviette", "Retraité parfaitement à l'aise", "Joueur de pétanque dévêtu", "Famille décomplexée", "Photographe aussitôt viré", "Maître-nageur", "Touriste profondément choqué", "Vendeur de crème solaire très demandé"] },
  { name: "Tribunal d'un condamné à mort", theme: T2.sombre, roles: ["Juge solennel", "Condamné qui plaisante nerveusement", "Avocat dépassé", "Procureur théâtral", "Juré qui s'endort", "Mère du condamné en larmes", "Journaliste avide", "Bourreau venu en avance", "Greffier imperturbable"] },
  { name: "Bateau d'immigrants sans papiers", theme: T2.sombre, roles: ["Passeur peu rassurant", "Famille avec tous ses espoirs", "Marin qui écope sans cesse", "Optimiste du groupe", "Pessimiste officiel", "Bébé qui pleure", "Vieil homme qui prie", "Faux guide qui s'est trompé de bateau", "Mouette opportuniste"] },
  { name: "Titanic", theme: T2.histoire, roles: ["Capitaine bien trop sûr de lui", "Violoniste qui joue jusqu'au bout", "Passager de première classe hautain", "Passager de troisième classe enfermé", "Vigie qui a vu l'iceberg trop tard", "Couple façon Jack & Rose", "Steward faussement rassurant", "Milliardaire qui exige un canot", "Iceberg (incognito)"] },
  { name: "Tribu aztèque", theme: T2.histoire, roles: ["Grand prêtre", "Guerrier jaguar", "Astronome du calendrier", "Paysan du maïs", "Sculpteur de pyramides", "Marchand de cacao", "Sacrifice désigné (pas ravi)", "Conquistador infiltré", "Enfant qui pose trop de questions"] },
  { name: "Tournage de film X", theme: T2.sulfureux, roles: ["Réalisateur très exigeant", "Acteur principal stressé", "Actrice pro et blasée", "Preneur de son gêné", "Maquilleuse qui a tout vu", "Producteur radin", "Livreur de pizza au pire moment", "Régisseur qui crie « moteur »", "Stagiaire qui regrette son choix"] },
  { name: "Rue des lanternes rouges d'Amsterdam", theme: T2.sulfureux, roles: ["Travailleuse en vitrine", "Touriste qui photographie (interdit)", "Rabatteur insistant", "Groupe d'EVG bruyant", "Habitant excédé", "Vendeur de frites", "Policier en patrouille", "Couple de touristes gênés", "Guide touristique embarrassé"] },
  { name: "Enquête sur une scène de meurtre", theme: T2.crime, roles: ["Inspecteur blasé", "Légiste bavard", "Photographe de scène", "Premier témoin sous le choc", "Suspect trop calme", "Voisin curieux", "Stagiaire qui touche à tout", "Journaliste déjà sur place", "Le coupable, qui aide gentiment"] },
  { name: "Alcatraz", theme: T2.crime, roles: ["Gardien-chef", "Détenu modèle (en apparence)", "Évadé en pleine préparation", "Cuisinier de la cantine", "Nouveau prisonnier terrifié", "Directeur de la prison", "Détenu qui dresse des souris", "Avocat en visite", "Gardien corrompu"] },
  { name: "Prise d'otage dans une banque", theme: T2.crime, roles: ["Braqueur nerveux", "Cerveau du braquage", "Otage qui négocie trop", "Directeur de la banque", "Négociateur au téléphone", "Otage qui s'évanouit", "Caissière courageuse", "Client venu juste déposer un chèque", "Sniper sur le toit"] },
  { name: "Labo de meth façon Breaking Bad", theme: T2.crime, roles: ["Prof de chimie reconverti", "Apprenti turbulent", "Dealer intermédiaire", "Comptable du cartel", "Nettoyeur professionnel", "Voisin qui ne se doute de rien", "Client fidèle", "Agent infiltré de la brigade", "Cuisinier qui a raté le mélange"] },
  { name: "Fight club clandestin", theme: T2.crime, roles: ["Maître des lieux (première règle : chut)", "Bagarreur sanguin", "Bookmaker", "Bizut à son premier combat", "Médecin improvisé", "Spectateur surexcité", "Videur", "Preneur de paris", "Recrue qui parle beaucoup trop"] },
  { name: "Tripot de jeu clandestin", theme: T2.crime, roles: ["Patron du tripot", "Croupier nerveux", "Gros joueur endetté", "Videur armé", "Tricheur professionnel", "Serveuse qui voit tout", "Flic ripou en pause", "Nouveau venu naïf", "Prêteur sur gages"] },
  { name: "Battle de hip-hop", theme: T2.fete, roles: ["MC qui clashe", "Beatboxer", "DJ aux platines", "Danseur de breakdance", "Juge à la mine fermée", "Fan qui filme tout", "Outsider venu défier le champion", "Vendeur de boissons", "Vieux qui kiffe étonnamment"] },
  { name: "Mosh pit d'un concert de metal", theme: T2.fete, roles: ["Chanteur en growl", "Stage diver", "Guerrier du circle pit", "Fan qui récupère sa chaussure", "Agent de sécurité débordé", "Photographe de fosse", "Headbanger du premier rang", "Type qui sauve son verre coûte que coûte", "Novice un peu perdu"] },
  { name: "Boîte de nuit à Vegas, 5 h du matin", theme: T2.fete, roles: ["Videur épuisé", "DJ qui range ses platines", "Dernier client qui refuse de partir", "Serveuse qui compte les heures", "Couple qui vient de se marier", "Type qui a tout perdu au casino", "Agent de nettoyage qui débute sa journée", "Fêtarde qui cherche ses chaussures", "Gérant qui fait les comptes"] },
  { name: "Anniversaire de gamins de 6 ans", theme: T2.fete, roles: ["Clown au bord du burn-out", "Roi de la fête bourré de sucre", "Parent organisateur dépassé", "Gamin qui pleure pour un ballon", "Magicien dont les tours ratent", "Mamie qui filme tout", "Enfant qui mange le gâteau avant l'heure", "Animateur de la structure gonflable", "Parent venu déposer… et resté"] },
  { name: "Finale d'esport en LAN", theme: T2.jeux, roles: ["Joueur pro sous pression", "Caster surexcité", "Coach qui hurle des consignes", "Fan en cosplay", "Arbitre technique", "Streamer qui commente", "Remplaçant frustré sur le banc", "Technicien réseau qui prie", "Spectateur qui lit l'écran d'en face"] },
  { name: "Tournoi de Magic", theme: T2.jeux, roles: ["Juge en chemise rayée", "Joueur au deck imbattable", "Collectionneur de cartes rares", "Débutant noyé dans les règles", "Vendeur de la boutique", "Joueur qui prend trois heures par tour", "Spectateur par-dessus l'épaule", "Tricheur aux cartes cachées", "Organisateur stressé"] },
  { name: "Secte apocalyptique", theme: T2.malaise, roles: ["Gourou charismatique", "Adepte du premier cercle", "Nouveau recruté plein d'espoir", "Trésorier qui ramasse les dons", "Sceptique infiltré", "Préposé aux robes blanches", "Adepte qui doute en secret", "Garde du corps du gourou", "Type venu pour le buffet gratuit"] },
  { name: "Sacrifice rituel maya", theme: T2.histoire, roles: ["Grand prêtre au couteau", "Volontaire (pas si volontaire)", "Astronome qui a fixé la date", "Joueur de tambour rituel", "Foule en transe", "Sculpteur du temple", "Roi qui observe d'en haut", "Esclave porteur", "Touriste du futur égaré"] },
  { name: "Témoins de Jéhovah en porte-à-porte", theme: T2.malaise, roles: ["Ancien zélé", "Recrue timide avec ses brochures", "Habitant qui fait le mort", "Chien qui aboie sans cesse", "Voisin qui les invite à entrer (piège)", "Duo bien rodé", "Athée qui veut débattre", "Mamie ravie d'avoir de la visite", "Facteur coincé dans la conversation"] },
  { name: "Salle d'autopsie", theme: T2.sombre, roles: ["Médecin légiste bavard", "Assistant au bord du malaise", "Inspecteur qui prend des notes", "Stagiaire en médecine", "Le « client » sur la table", "Photographe médico-légal", "Étudiant en visite", "Technicien des instruments", "Veuf venu identifier"] },
  { name: "Asile psychiatrique", theme: T2.sombre, roles: ["Psychiatre fatigué", "Patient persuadé d'être Napoléon", "Infirmier costaud", "Nouvel interne", "Patient étonnamment lucide", "Visiteur égaré", "Patient collectionneur de cuillères", "Aide-soignant zen", "Directeur qui veut tout étouffer"] },
  { name: "Métro parisien aux heures de pointe", theme: T2.galere, roles: ["Musicien du wagon", "Contrôleur qui surgit", "Touriste au plan à l'envers", "Pickpocket discret", "Cadre pressé en costume", "Personne au sandwich qui sent fort", "Ado qui met sa musique à fond", "Conducteur invisible", "Mendiant qui fait son discours"] },
  { name: "Bloc opératoire en urgence", theme: T2.sombre, roles: ["Chirurgien sous adrénaline", "Anesthésiste qui surveille les chiffres", "Infirmière instrumentiste", "Interne qui tient l'écarteur", "Patient à moitié réveillé", "Externe qui regarde par-dessus", "Cadre de bloc", "Aide-soignant qui court", "Brancardier en attente"] },
  { name: "Banque de sperme", theme: T2.sulfureux, roles: ["Donneur intimidé", "Réceptionniste pince-sans-rire", "Médecin qui explique la procédure", "Couple en salle d'attente", "Technicien de laboratoire", "Donneur beaucoup trop sûr de lui", "Agent d'entretien qui frappe avant d'entrer", "Comptable des stocks", "Livreur d'azote liquide"] },
  { name: "Plateforme pétrolière en pleine mer", theme: T2.histoire, roles: ["Chef de plateforme", "Foreur couvert de cambouis", "Cuisinier du mess", "Soudeur en hauteur", "Géologue", "Nouveau qui a le mal de mer", "Responsable sécurité", "Pilote d'hélico", "Mouette du large"] },
  { name: "Yacht de milliardaire russe", theme: T2.fete, roles: ["Oligarque méfiant", "Garde du corps en costume", "Hôtesse multilingue", "Capitaine discret", "Invitée mannequin", "DJ privé", "Chef étoilé à bord", "Comptable des sociétés offshore", "Passager clandestin dans la soute"] },
  { name: "Cour d'un roi médiéval", theme: T2.histoire, roles: ["Roi capricieux", "Bouffon qui ose tout", "Reine intrigante", "Chevalier loyal", "Conseiller manipulateur", "Servante qui entend tout", "Ménestrel", "Ambassadeur étranger", "Goûteur officiel (inquiet)"] },
  { name: "Championnat de lancer de nains", theme: T2.jeux, roles: ["Lanceur professionnel", "Le projectile casqué et consentant", "Arbitre au mètre ruban", "Bookmaker", "Public bien alcoolisé", "Médecin de sécurité", "Commentateur surexcité", "Organisateur douteux", "Militant venu protester"] },
  { name: "Combat de MMA en cage", theme: T2.jeux, roles: ["Combattant tatoué", "Arbitre dans la cage", "Coach qui hurle au bord", "Ring girl", "Médecin de bord de cage", "Commentateur", "Parieur fébrile", "Cut man qui soigne les coupures", "Spectateur du premier rang éclaboussé"] },
  { name: "Réunion des Alcooliques Anonymes", theme: T2.malaise, roles: ["Animateur qui partage son parcours", "Nouveau qui n'ose pas parler", "Vétéran des réunions", "Personne en rechute honteuse", "Parrain bienveillant", "Préposé au café (rôle crucial)", "Sceptique envoyé par le tribunal", "Personne qui pleure", "Type qui cherchait le club de bridge"] },
  { name: "Contrôle technique auto", theme: T2.galere, roles: ["Contrôleur méticuleux", "Propriétaire qui prie pour son épave", "Mécano du garage d'à côté", "Client à la voiture douteuse", "Secrétaire de l'accueil", "Client qui conteste tout", "Apprenti", "Commercial qui propose des réparations", "Voiture qui ne passera jamais"] },
  { name: "Cabinet de voyance", theme: T2.absurde, roles: ["Voyante mystérieuse", "Client crédule", "Sceptique venu la tester", "Chat noir de la maison", "Client en plein chagrin d'amour", "Assistante qui prend les rendez-vous", "Habituée qui revient chaque semaine", "Journaliste en enquête", "Esprit invoqué (incognito)"] },
  { name: "Convention de tatouage", theme: T2.fete, roles: ["Tatoueur star", "Client à sa toute première fois", "Modèle entièrement tatoué", "Vendeur de matériel", "Organisateur badge VIP", "Curieux qui regarde et grimace", "Juge du concours", "Apprenti qui s'entraîne sur un pamplemousse", "Client qui regrette déjà"] },
  { name: "Bunker d'une secte le jour de l'apocalypse", theme: T2.malaise, roles: ["Gourou qui a prédit la date", "Adepte qui a vendu sa maison", "Responsable des réserves de conserves", "Sceptique enfermé là par sa famille", "Enfant qui s'ennuie ferme", "Garde de la porte blindée", "Adepte qui fixe sa montre (rien ne vient)", "Trésorier de la secte", "Livreur arrivé au pire moment"] },
  { name: "Salle de torture médiévale", theme: T2.sombre, roles: ["Bourreau consciencieux", "Prisonnier qui avoue déjà", "Inquisiteur patient", "Apprenti bourreau", "Scribe qui note les aveux", "Geôlier", "Noble accusé de sorcellerie", "Médecin qui maintient en vie", "Rat des cachots"] },
  { name: "Ascension de l'Everest", theme: T2.histoire, roles: ["Sherpa surchargé", "Alpiniste épuisé mais fier", "Guide expérimenté", "Touriste fortuné mal préparé", "Médecin d'altitude", "Caméraman de documentaire", "Grimpeur qui veut faire demi-tour", "Cuisinier du camp", "Yéti (incognito)"] },
  { name: "Camp de base sur Mars", theme: T2.histoire, roles: ["Commandant de mission", "Botaniste qui sauve des patates", "Ingénieur scotch-et-débrouille", "Médecin de l'équipage", "Géologue émerveillé", "Touriste milliardaire", "Communicant de l'agence spatiale", "Recrue claustrophobe", "Forme de vie martienne (incognito)"] },
  { name: "Poudlard, école de sorciers", theme: T2.absurde, roles: ["Directeur à la longue barbe", "Élève élu malgré lui", "Professeur de potions sévère", "Concierge aigri et son chat", "Fantôme du château", "Élève de la maison rivale", "Demi-géant garde-chasse", "Préfète à cheval sur le règlement", "Hibou postier"] },
  { name: "Salle d'attente du Paradis", theme: T2.audela, roles: ["Saint à l'accueil, liste en main", "Âme stressée par son bilan", "Ange administratif débordé", "Âme persuadée de mériter le haut", "Petit diable venu négocier", "Musicien à la harpe", "Âme arrivée bien trop tôt", "Agent qui tamponne les dossiers", "Nuage de service"] },
  { name: "Salle d'embarquement, vol annulé", theme: T2.galere, roles: ["Agent de la compagnie qui esquive", "Passager furieux", "Famille aux enfants en pleurs", "Voyageur d'affaires au téléphone", "Personne qui dort sur trois sièges", "Steward qui annonce « encore du retard »", "Touriste zen malgré tout", "Vendeur du duty free", "Passager qui réclame un bon repas"] },
  { name: "Chantier des pyramides d'Égypte", theme: T2.histoire, roles: ["Architecte royal", "Ouvrier qui tire les blocs", "Contremaître au fouet", "Scribe qui compte les pierres", "Prêtre superviseur", "Esclave épuisé", "Tailleur de pierre", "Pharaon en visite", "Porteur d'eau"] },
  { name: "Combat de gladiateurs au Colisée", theme: T2.histoire, roles: ["Gladiateur vedette", "Empereur au pouce décisif", "Bête fauve affamée", "Organisateur des jeux", "Médecin de l'arène", "Esclave qui ratisse le sable", "Spectateur assoiffé de sang", "Vestale dans les gradins", "Gladiateur débutant terrifié"] },
  { name: "Premier voyage de Christophe Colomb", theme: T2.histoire, roles: ["Colomb obsédé par l'ouest", "Marin qui veut rentrer", "Mousse de 14 ans", "Cartographe complètement perdu", "Cuisinier à court de vivres", "Vigie qui crie « Terre ! »", "Prêtre du bord", "Marin superstitieux", "Passager clandestin"] },
  { name: "Duel au pistolet à midi pile", theme: T2.histoire, roles: ["Pistolero arrogant", "Adversaire qui tremble", "Témoin qui compte les pas", "Shérif qui surveille", "Croque-mort déjà prêt", "Fille de saloon qui regarde", "Médecin de la ville", "Parieur du coin", "Vieux qui a déjà tout vu"] },
  { name: "Speakeasy de la Prohibition", theme: T2.histoire, roles: ["Barman qui sert dans des tasses", "Gangster en costume rayé", "Chanteuse de jazz", "Client qui connaît le mot de passe", "Flic ripou", "Contrebandier d'alcool", "Pianiste", "Indic discret", "Touriste qui a trouvé la porte par hasard"] },
  { name: "Repas de famille avec son ex", theme: T2.malaise, roles: ["Hôte mal à l'aise", "L'ex venu « en ami »", "Nouveau partenaire tendu", "Mère qui relance le sujet", "Oncle qui ne sait rien et demande", "Enfant qui dit la vérité tout fort", "Cousin qui filme la gêne", "Grand-mère qui prend parti", "Chien qui détend l'atmosphère"] },
  { name: "Séminaire d'un gourou du développement personnel", theme: T2.malaise, roles: ["Gourou ultra-positif", "Disciple qui note frénétiquement", "Sceptique tout au fond", "Vendeur de la formation à 2000 €", "Participant qui pleure de joie", "Coach assistant", "Personne venue pour le buffet", "Photographe pour les réseaux", "Type qui cherche juste les toilettes"] },
  { name: "Accouchement dans un taxi coincé dans les bouchons", theme: T2.galere, roles: ["Chauffeur en pleine panique", "Future maman qui pousse", "Futur papa qui s'évanouit", "Passant médecin par chance", "Standardiste du SAMU au téléphone", "Automobiliste qui klaxonne derrière", "Mamie passagère qui « a déjà vu ça »", "Motard qui ouvre la voie", "Bébé pressé"] },
  { name: "Bureau de réincarnation", theme: T2.audela, roles: ["Fonctionnaire des affectations", "Âme qui négocie sa prochaine vie", "Âme déçue d'être un escargot", "Conseiller karma", "Stagiaire qui mélange les dossiers", "Âme VIP qui exige un upgrade", "Gardien de la file d'attente", "Âme amnésique", "Chat qui en est à sa 9e vie"] },
  { name: "Standard téléphonique de Dieu", theme: T2.audela, roles: ["Standardiste débordé", "Ange superviseur", "Fidèle qui prie pour le loto", "Pécheur qui négocie", "Stagiaire céleste", "Plaignant qui veut « parler au responsable »", "Saint en pause café", "Démon sur la ligne piratée", "Personne qui a fait un faux numéro"] },
  { name: "Perquisition fiscale", theme: T2.crime, roles: ["Inspecteur des impôts implacable", "Patron qui transpire à grosses gouttes", "Comptable qui planque des classeurs", "Avocat fiscaliste", "Secrétaire qui broie du papier", "Agent qui ouvre tous les tiroirs", "Associé qui balance tout", "Stagiaire terrifié", "Femme de ménage qui passe l'aspirateur"] },
  { name: "Thérapie de groupe pour héros grecs", theme: T2.audela, roles: ["Thérapeute olympien", "Héros au talon fragile", "Demi-dieu colérique", "Roi maudit qui pousse un rocher", "Guerrier hanté par la guerre", "Héros narcissique", "Aède qui chante les exploits", "Oracle pessimiste", "Mortel qui s'est trompé de groupe"] },
  { name: "Chaîne de production des éclairs de Zeus", theme: T2.audela, roles: ["Contremaître cyclope", "Ouvrier forgeron", "Contrôleur qualité des foudres", "Apprenti qui s'électrocute", "Livreur vers l'Olympe", "Comptable des stocks d'éclairs", "Zeus en inspection surprise", "Délégué syndical des forges", "Stagiaire qui a grillé un lot"] },
  { name: "Réunion marketing des bâtisseurs de pyramides", theme: T2.absurde, roles: ["Directeur com' du pharaon", "Architecte créatif", "Comptable du budget faramineux", "Esclave consultant malgré lui", "Prêtre chargé du branding divin", "Stagiaire qui propose « plus de triangles »", "Responsable des délais (4000 ans)", "Scribe en réunion", "Pharaon impatient"] },
  { name: "Cathédrale Notre-Dame en feu", theme: T2.histoire, roles: ["Pompier dans la fumée", "Recteur effondré", "Touriste qui filme au lieu de fuir", "Gardien des reliques", "Architecte des charpentes", "Journaliste en direct", "Badaud sur le pont", "Restaurateur d'art en larmes", "Gargouille spectatrice"] },
  { name: "Stands d'un Grand Prix de F1", theme: T2.jeux, roles: ["Mécano du changement de pneus", "Pilote dans le cockpit", "Ingénieur radio", "Directeur d'écurie", "Hôtesse de grille", "Commentateur surexcité", "Sponsor en visite VIP", "Ravitailleur", "Spectateur aux bouchons d'oreilles"] },
  { name: "Porte de l'avion juste avant le saut en parachute", theme: T2.histoire, roles: ["Moniteur qui pousse gentiment", "Débutant pétrifié en tandem", "Vidéaste en chute libre", "Para expérimenté blasé", "Pilote qui crie « go »", "Type inscrit là sur un pari", "Plieur de parachute qu'on espère sérieux", "Passager qui veut faire demi-tour", "Oiseau franchement étonné"] },
  { name: "Dépôt de plainte au commissariat", theme: T2.galere, roles: ["Agent d'accueil blasé", "Plaignant remonté", "Voisin venu pour du bruit", "Victime d'un vol de vélo", "Stagiaire qui tape lentement", "Personne qui a « juste une question »", "Témoin beaucoup trop bavard", "Brigadier en pause", "Suspect qui passe par là"] },
  { name: "Casting de télé-réalité", theme: T2.malaise, roles: ["Directeur de casting cynique", "Candidat survolté", "Candidate « là pour les bonnes raisons »", "Psychologue de production", "Caméraman qui cadre les larmes", "Candidat qui clashe déjà", "Assistant au clap", "Producteur en quête de drama", "Recalé qui s'accroche"] },
  { name: "Casting porno", theme: T2.sulfureux, roles: ["Réalisateur très direct", "Candidat trop confiant", "Candidate pro et carrée", "Assistante au formulaire", "Preneur de son", "Producteur pressé", "Médecin qui vérifie les tests", "Stagiaire rouge de gêne", "Livreur (encore lui) au mauvais moment"] },
  { name: "Grève SNCF, quai bondé", theme: T2.galere, roles: ["Contrôleur qui annonce l'annulation", "Voyageur au bord de la crise", "Gréviste à pancarte", "Touriste qui ne comprend rien", "Cadre en télétravail forcé sur le quai", "Famille campée sur ses valises", "Vendeur de sandwichs hors de prix", "Agent qui esquive les questions", "Pigeon du quai"] },
  { name: "Championnat du monde de pierre-feuille-ciseaux", theme: T2.jeux, roles: ["Champion en titre concentré", "Arbitre solennel", "Commentateur qui dramatise tout", "Outsider venu de loin", "Coach mental", "Spectateur passionné", "Statisticien des coups", "Débutant chanceux", "Tricheur au dixième de seconde"] },
  { name: "Club très sélect des gens toujours en retard", theme: T2.absurde, roles: ["Président arrivé bon dernier", "Membre qui s'excuse platement", "Nouveau venu en avance (gros malaise)", "Secrétaire qui n'a jamais vu l'ordre du jour", "Membre qui accuse les transports", "Serveur qui attend depuis 2 h", "Membre qui repart déjà", "Conférencier qui a renoncé", "Horloge murale moqueuse"] },
  { name: "Assemblée de copropriété", theme: T2.galere, roles: ["Syndic qui lit l'ordre du jour", "Copropriétaire procédurier", "Voisin du dessus accusé du bruit", "Retraité qui veut repeindre la cage", "Propriétaire absent représenté", "Gardien convoqué", "Couple qui conteste les charges", "Président de séance dépassé", "Voisin qui s'endort"] },
  { name: "Covoiturage de 800 km (côté chauffeur)", theme: T2.galere, roles: ["Chauffeur fier de sa playlist", "Passager qui parle sans fin", "Passagère qui dort tout le trajet", "Passager qui a réservé mais ne paie pas", "Passager qui mange bruyamment", "Passager qui critique la conduite", "Auto-stoppeur ramassé en route", "Passager pressé qui stresse le chauffeur", "GPS qui se trompe de sortie"] },
  { name: "Élection de Miss Camping", theme: T2.fete, roles: ["Maîtresse de cérémonie en paillettes", "Candidate favorite", "Candidate rivale", "Juré du camping", "Gérant du camping très fier", "Animateur au micro", "Maman-coach surinvestie", "Technicien sono", "Campeur venu pour l'apéro"] },
  { name: "Congrès des sosies ratés de Johnny Hallyday", theme: T2.absurde, roles: ["Sosie qui y croit dur comme fer", "Sosie qui ne ressemble à rien", "Organisateur en banane de cuir", "Fan inconditionnelle", "Juge du concours", "Sosie de Sardou complètement égaré", "Coiffeur spécialiste de la banane", "Vendeur de lunettes noires", "Sosie qui ne sait pas chanter"] },
  { name: "Mariage où tout le monde a couché avec l'ex d'un autre", theme: T2.malaise, roles: ["Marié au passé compliqué", "Mariée nerveuse", "Ex présent « par politesse »", "Témoin au courant de tout", "Invité qui calcule les liaisons", "Tante aux sous-entendus", "DJ qui sent la tension", "Cousin qui drague déjà", "Photographe qui capte les regards"] },
  { name: "Repas de famille où le testament vient d'être lu", theme: T2.malaise, roles: ["Notaire mal à l'aise", "Héritier gâté", "Héritier déshérité furieux", "Cousin surgi de nulle part", "Veuve digne", "Frère qui compte déjà", "Enfant qui hérite du chat", "Beau-frère très intéressé", "Avocat de la famille"] },
  { name: "Mariage blanc contrôlé par l'administration", theme: T2.malaise, roles: ["Inspecteur de l'immigration soupçonneux", "Marié qui récite ses fiches", "Mariée qui oublie la date de naissance", "Témoin complice qui improvise", "Fonctionnaire tatillon", "Voisin appelé à témoigner", "Organisateur du faux couple", "Traducteur embarrassé", "Vrai amoureux caché"] },
  { name: "Open space d'une boîte de dropshipping spirituel", theme: T2.absurde, roles: ["CEO en quête de « mindset »", "Commercial des bracelets énergétiques", "Community manager en burn-out", "Stagiaire payé « en expérience »", "Coach bien-être maison", "Comptable inquiet", "Client en litige au téléphone", "Développeur du site bancal", "Plante verte, seule chose authentique"] },
  { name: "Pool party chez un influenceur fauché", theme: T2.fete, roles: ["Influenceur qui simule la richesse", "Invité en quête du buffet (vide)", "Photographe pour le feed", "Abonné venu en vrai", "Voisin dérangé par la musique", "Faux ami sponsorisé", "DJ payé « en visibilité »", "Invité qui squatte le transat", "Maître-nageur de la piscine gonflable"] },
  { name: "Parloir de prison le jour de la Saint-Valentin", theme: T2.malaise, roles: ["Détenu amoureux", "Visiteuse fidèle", "Gardien qui surveille les mains", "Détenu sans visite, jaloux", "Avocat venu au mauvais jour", "Couple qui se dispute à travers la vitre", "Surveillant-chef", "Nouveau détenu intimidé", "Mamie venue voir son petit-fils"] },
  { name: "Repère de super-vilains en burn-out", theme: T2.absurde, roles: ["Méchant qui n'y croit plus", "Coach en reconversion héroïque", "Acolyte épuisé", "Savant fou en pleine dépression", "Garde du corps syndiqué", "Ancien némésis venu prendre des nouvelles", "Comptable du repaire", "Stagiaire du mal désabusé", "Robot domestique en panne"] },
  { name: "Salle de poker illégale dans l'arrière-boutique d'un fleuriste", theme: T2.crime, roles: ["Fleuriste qui fait le guet", "Croupier discret", "Gros bras à l'entrée", "Joueur lourdement endetté", "Habitué qui mise gros", "Client venu vraiment acheter des fleurs", "Tricheur planqué sous les roses", "Flic en civil", "Livreur de bouquets (la couverture)"] },
  { name: "Réunion marketing d'une nouvelle religion", theme: T2.absurde, roles: ["Fondateur « visionnaire »", "Responsable du logo divin", "Comptable des dîmes", "Community manager des miracles", "Sceptique du conseil", "Recruteur de fidèles", "Designer des robes", "Stagiaire au buffet sacré", "Investisseur qui veut du retour"] },
  { name: "Arche de Noé, le jour du choix des animaux", theme: T2.audela, roles: ["Noé débordé par la liste", "Couple de lions impatient", "Animal recalé furieux", "Fils de Noé qui range la cale", "Licorne qui a raté le coche", "Moustique dont on conteste l'utilité", "Mouette qui squatte le pont", "Inspecteur des espèces", "Escargot arrivé en retard"] },
  { name: "Vestiaire des gladiateurs avant le combat", theme: T2.histoire, roles: ["Vétéran qui rassure les bleus", "Gladiateur débutant qui vomit", "Entraîneur (lanista) sévère", "Médecin qui panse les plaies", "Forgeron qui affûte les glaives", "Esclave porteur d'armes", "Gladiateur star adulé", "Prêtre qui bénit les combattants", "Parieur infiltré"] },
  { name: "Réunion de pirates pour partager un trésor maudit", theme: T2.histoire, roles: ["Capitaine avide", "Quartier-maître qui compte les parts", "Pirate superstitieux", "Mousse qui n'a droit à rien", "Perroquet beaucoup trop bavard", "Pirate déjà frappé par la malédiction", "Cartographe du butin", "Traître qui prépare son coup", "Cuisinier borgne"] },
  { name: "Morgue qui a mélangé les étiquettes", theme: T2.sombre, roles: ["Légiste paniqué", "Assistant qui a tout inversé", "Famille perplexe venue identifier", "Directeur des pompes funèbres furieux", "Stagiaire fautif", "Inspecteur qui enquête", "Employé de nuit", "Veuf devant le mauvais cercueil", "Corps qui n'est pas à sa place"] },
  { name: "Cantine d'une école de sorciers", theme: T2.absurde, roles: ["Cuisinier qui fait léviter les plats", "Élève affamé", "Dame de cantine ensorcelée", "Préfet qui surveille", "Fantôme qui traverse les tables", "Élève allergique aux potions", "Elfe de cuisine surmené", "Professeur de passage", "Plat qui parle"] },
  { name: "Couloir de la mort pendant une panne d'électricité", theme: T2.sombre, roles: ["Condamné qui reprend espoir", "Gardien à la lampe torche", "Aumônier qui prie", "Directeur qui appelle le technicien", "Détenu voisin qui hurle", "Bourreau qui patiente", "Avocat au téléphone en urgence", "Technicien qui cherche le disjoncteur", "Journaliste témoin"] },
  { name: "Guillotine en panne pendant la Révolution française", theme: T2.histoire, roles: ["Bourreau gêné devant la foule", "Condamné qui reprend espoir", "Révolutionnaire impatient", "Charpentier appelé en urgence", "Tricoteuse du premier rang", "Officier qui s'impatiente", "Prêtre réfractaire, suivant sur la liste", "Crieur public", "Aristocrate qui ironise"] },
];

module.exports = {
  spyfall1: { label: "Spyfall 1", locations: spyfall1 },
  spyfall2: { label: "Spyfall 2", locations: spyfall2 },
  both: { label: "Spyfall 1 + 2", locations: [...spyfall1, ...spyfall2] },
  delire: { label: "Délire (RP)", locations: delire },
  delire2: { label: "Délire 2 (corsé) 🔞", locations: delire2 },
  delireBoth: { label: "Délire + Délire 2 🔞", locations: [...delire, ...delire2] },
  tout: { label: "Tout", locations: [...spyfall1, ...spyfall2, ...delire, ...delire2] },
};
