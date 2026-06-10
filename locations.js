// Les lieux officiels de Spyfall (1re édition, 27 lieux, 7 rôles) et de
// Spyfall 2 (25 lieux, 10 rôles — le jeu monte à 12 joueurs), en français.
// Les rôles en double sur certaines cartes de Spyfall 2 sont d'origine.
// L'espion ne reçoit aucun lieu.

const spyfall1 = [
  {
    name: "Avion",
    roles: ["Commandant de bord", "Copilote", "Hôtesse de l'air", "Mécanicien", "Agent de sûreté", "Passager en première classe", "Passager en classe éco"],
  },
  {
    name: "Banque",
    roles: ["Directeur d'agence", "Guichetier", "Consultant", "Agent de sécurité", "Convoyeur de fonds", "Braqueur", "Client"],
  },
  {
    name: "Plage",
    roles: ["Maître-nageur", "Kitesurfeur", "Serveuse de plage", "Photographe de plage", "Vendeur de glaces", "Vacancier", "Voleur"],
  },
  {
    name: "Casino",
    roles: ["Croupier", "Directeur", "Chef de la sécurité", "Videur", "Barman", "Arnaqueur", "Joueur"],
  },
  {
    name: "Cathédrale",
    roles: ["Prêtre", "Choriste", "Mécène", "Fidèle", "Touriste", "Mendiant", "Pécheur"],
  },
  {
    name: "Chapiteau de cirque",
    roles: ["Acrobate", "Dompteur", "Magicien", "Cracheur de feu", "Clown", "Jongleur", "Spectateur"],
  },
  {
    name: "Soirée d'entreprise",
    roles: ["Patron", "Manager", "Comptable", "Secrétaire", "Animateur", "Livreur", "Invité indésirable"],
  },
  {
    name: "Armée des croisés",
    roles: ["Chevalier", "Archer", "Évêque", "Moine", "Écuyer", "Serviteur", "Sarrasin prisonnier"],
  },
  {
    name: "Spa",
    roles: ["Masseuse", "Styliste", "Manucure", "Maquilleuse", "Dermatologue", "Esthéticienne", "Client"],
  },
  {
    name: "Ambassade",
    roles: ["Ambassadeur", "Diplomate", "Secrétaire", "Agent de sécurité", "Fonctionnaire", "Touriste", "Réfugié"],
  },
  {
    name: "Hôpital",
    roles: ["Chirurgien", "Médecin", "Infirmière", "Interne", "Anesthésiste", "Thérapeute", "Patient"],
  },
  {
    name: "Hôtel",
    roles: ["Directeur", "Portier", "Groom", "Femme de chambre", "Barman", "Agent de sécurité", "Client"],
  },
  {
    name: "Base militaire",
    roles: ["Colonel", "Officier", "Soldat", "Tireur d'élite", "Médecin militaire", "Mécanicien de char", "Déserteur"],
  },
  {
    name: "Studio de cinéma",
    roles: ["Réalisateur", "Producteur", "Acteur", "Cascadeur", "Cadreur", "Ingénieur du son", "Costumier"],
  },
  {
    name: "Paquebot de croisière",
    roles: ["Capitaine", "Cuisinier", "Barman", "Serveur", "Musicien", "Mécanicien", "Passager fortuné"],
  },
  {
    name: "Train de voyageurs",
    roles: ["Conducteur", "Mécanicien", "Chauffeur de chaudière", "Agent de bord", "Garde-frontière", "Chef du wagon-restaurant", "Passager"],
  },
  {
    name: "Bateau pirate",
    roles: ["Vaillant capitaine", "Canonnier", "Matelot", "Mousse", "Cuisinier", "Esclave", "Prisonnier ligoté"],
  },
  {
    name: "Station polaire",
    roles: ["Chef d'expédition", "Météorologue", "Biologiste", "Géologue", "Hydrologue", "Radio-opérateur", "Médecin"],
  },
  {
    name: "Commissariat de police",
    roles: ["Inspecteur", "Policier de patrouille", "Expert en criminalistique", "Archiviste", "Avocat", "Journaliste", "Criminel"],
  },
  {
    name: "Restaurant",
    roles: ["Chef cuisinier", "Maître d'hôtel", "Serveur", "Videur", "Musicien", "Critique gastronomique", "Client"],
  },
  {
    name: "École",
    roles: ["Directeur", "Prof de gym", "Surveillant", "Concierge", "Cantinière", "Agent d'entretien", "Élève"],
  },
  {
    name: "Station-service",
    roles: ["Gérant", "Mécanicien auto", "Spécialiste des pneus", "Électricien", "Laveur de voitures", "Motard", "Automobiliste"],
  },
  {
    name: "Station spatiale",
    roles: ["Commandant", "Ingénieur", "Scientifique", "Pilote", "Médecin de bord", "Touriste spatial", "Extraterrestre"],
  },
  {
    name: "Sous-marin",
    roles: ["Commandant", "Navigateur", "Sonariste", "Technicien électronique", "Radio-opérateur", "Cuisinier", "Matelot"],
  },
  {
    name: "Supermarché",
    roles: ["Caissier", "Boucher", "Magasinier", "Démonstratrice", "Agent d'entretien", "Agent de sécurité", "Client"],
  },
  {
    name: "Théâtre",
    roles: ["Metteur en scène", "Acteur", "Souffleur", "Machiniste", "Caissier", "Dame du vestiaire", "Spectateur"],
  },
  {
    name: "Université",
    roles: ["Doyen", "Professeur", "Doctorant", "Psychologue", "Bibliothécaire", "Concierge", "Étudiant"],
  },
];

const spyfall2 = [
  {
    name: "Parc d'attractions",
    roles: ["Opérateur de manège", "Parent", "Vendeur de snacks", "Caissier", "Enfant ravi", "Enfant pénible", "Adolescent", "Agent d'entretien", "Agent de sécurité", "Parent"],
  },
  {
    name: "Musée d'art",
    roles: ["Vendeur de billets", "Étudiant", "Visiteur", "Professeur", "Agent de sécurité", "Peintre", "Collectionneur d'art", "Critique d'art", "Photographe", "Touriste"],
  },
  {
    name: "Fabrique de bonbons",
    roles: ["Rouquin farfelu", "Pâtissier", "Visiteur", "Goûteur", "Fabricant de truffes", "Goûteur", "Magasinier", "Oompa Loompa", "Inspecteur", "Opérateur de machine"],
  },
  {
    name: "Concours félin",
    roles: ["Juge", "Présentateur de chats", "Vétérinaire", "Agent de sécurité", "Dresseur de chats", "Folle aux chats", "Ami des bêtes", "Propriétaire de chat", "Chat", "Chat"],
  },
  {
    name: "Cimetière",
    roles: ["Prêtre", "Gothique", "Pilleur de tombes", "Poète", "Personne en deuil", "Gardien", "Défunt", "Proche du défunt", "Vendeur de fleurs", "Fossoyeur"],
  },
  {
    name: "Mine de charbon",
    roles: ["Inspecteur de sécurité", "Mineur", "Contremaître", "Conducteur de tombereau", "Foreur", "Coordinateur", "Artificier", "Mineur", "Ingénieur des déchets", "Ouvrier"],
  },
  {
    name: "Chantier de construction",
    roles: ["Bambin échappé", "Entrepreneur", "Grutier", "Intrus", "Responsable sécurité", "Électricien", "Ingénieur", "Architecte", "Ouvrier du bâtiment", "Ouvrier du bâtiment"],
  },
  {
    name: "Salon du jeu vidéo",
    roles: ["Blogueur", "Cosplayeur", "Joueur", "Exposant", "Collectionneur", "Enfant", "Agent de sécurité", "Geek", "Timide", "Célébrité"],
  },
  {
    name: "Station-essence",
    roles: ["Passionné d'autos", "Pompiste", "Vendeur de la boutique", "Client", "Laveur de voitures", "Caissier", "Client", "Militant écologiste", "Pompiste", "Gérant"],
  },
  {
    name: "Docks du port",
    roles: ["Docker", "Vieux loup de mer", "Capitaine", "Matelot", "Docker", "Pêcheur", "Exportateur", "Superviseur du fret", "Inspecteur du fret", "Contrebandier"],
  },
  {
    name: "Stade de hockey",
    roles: ["Fan de hockey", "Médecin", "Joueur de hockey", "Vendeur de snacks", "Agent de sécurité", "Gardien de but", "Entraîneur", "Arbitre", "Spectateur", "Joueur de hockey"],
  },
  {
    name: "Prison",
    roles: ["Condamné à tort", "Opérateur de vidéosurveillance", "Gardien", "Visiteur", "Avocat", "Agent d'entretien", "Directeur de la prison", "Criminel", "Surveillant pénitentiaire", "Détenu fou"],
  },
  {
    name: "Club de jazz",
    roles: ["Videur", "Batteur", "Pianiste", "Saxophoniste", "Chanteur", "Passionné de jazz", "Danseur", "Barman", "VIP", "Serveur"],
  },
  {
    name: "Bibliothèque",
    roles: ["Vieil homme", "Journaliste", "Auteur", "Bénévole", "Monsieur je-sais-tout", "Étudiant", "Bibliothécaire", "Bavard bruyant", "Dévoreur de livres", "Intello"],
  },
  {
    name: "Boîte de nuit",
    roles: ["Habitué", "Barman", "Agent de sécurité", "Danseur", "Dragueur", "Fêtarde", "Mannequin", "Costaud", "Personne ivre", "Timide"],
  },
  {
    name: "Circuit de course",
    roles: ["Propriétaire d'écurie", "Pilote", "Ingénieur", "Spectateur", "Commissaire de course", "Mécanicien", "Vendeur de snacks", "Commentateur", "Bookmaker", "Spectateur"],
  },
  {
    name: "Maison de retraite",
    roles: ["Proche en visite", "Joueur de cartes", "Personne âgée", "Infirmière", "Agent d'entretien", "Cuisinier", "Aveugle", "Psychologue", "Personne âgée", "Infirmière"],
  },
  {
    name: "Concert de rock",
    roles: ["Danseur", "Chanteur", "Fan", "Guitariste", "Batteur", "Roadie", "Adepte du stage diving", "Agent de sécurité", "Bassiste", "Technicien"],
  },
  {
    name: "Bus touristique",
    roles: ["Vieil homme", "Touriste solitaire", "Chauffeur", "Enfant pénible", "Touriste", "Guide", "Photographe", "Touriste", "Personne perdue", "Touriste"],
  },
  {
    name: "Stade d'athlétisme",
    roles: ["Médecin", "Lanceur de marteau", "Athlète", "Commentateur", "Spectateur", "Agent de sécurité", "Arbitre", "Vendeur de snacks", "Sauteur en hauteur", "Sprinteur"],
  },
  {
    name: "Métro",
    roles: ["Touriste", "Conducteur de rame", "Contrôleur", "Femme enceinte", "Pickpocket", "Agent de nettoyage", "Homme d'affaires", "Vendeur de tickets", "Vieille dame", "Aveugle"],
  },
  {
    name: "L'ONU",
    roles: ["Diplomate", "Interprète", "Beau parleur", "Touriste", "Délégué assoupi", "Journaliste", "Secrétaire d'État", "Orateur", "Secrétaire général", "Lobbyiste"],
  },
  {
    name: "Vignoble",
    roles: ["Jardinier", "Guide gastronomique", "Vigneron", "Exportateur", "Majordome", "Dégustateur", "Sommelier", "Riche propriétaire", "Régisseur du domaine", "Œnologue"],
  },
  {
    name: "Mariage",
    roles: ["Porteur d'alliances", "Marié", "Mariée", "Officiant", "Photographe", "Bouquetière", "Père de la mariée", "Invité incrusté", "Témoin", "Proche"],
  },
  {
    name: "Zoo",
    roles: ["Soigneur", "Visiteur", "Photographe", "Enfant", "Vétérinaire", "Touriste", "Vendeur de snacks", "Caissier", "Soigneur", "Chercheur"],
  },
];

module.exports = {
  spyfall1: { label: "Spyfall 1", locations: spyfall1 },
  spyfall2: { label: "Spyfall 2", locations: spyfall2 },
  both: { label: "Spyfall 1 + 2", locations: [...spyfall1, ...spyfall2] },
};
