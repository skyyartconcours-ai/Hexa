# Builds the Crystal Ball page from the validated contenders data and the pem.lol cross-check.
import json, re, sys, os
cont, pem, out = sys.argv[1], sys.argv[2], sys.argv[3]
TITLES = {
 'CB-1': 'Champion avec la plus forte présence', 'CB-2': 'Champion avec le meilleur winrate (5+ games)', 'CB-3': 'Champion avec le plus de morts par game (5+ games)',
 'CB-4': 'Joueur avec le meilleur KDA', 'CB-5': 'Joueur avec le plus de dégâts par game', 'CB-6': 'Joueur avec la meilleure participation aux kills',
 'CB-7': 'Peyz ou Gumayusi : qui fera le plus de kills ?', 'CB-8': 'Faker atteindra-t-il 700 kills en carrière aux Worlds ?',
 'CB-9': 'Teemo sera-t-il pické au moins une fois ?', 'CB-10': 'Combien de champions différents seront pickés ?', 'CB-11': 'Plus de games avant ou après 32 minutes ?',
 'CB-12': 'Un joueur fera-t-il 15 kills dans une game ?', 'CB-13': 'Un joueur atteindra-t-il 450 CS dans une game ?',
 'CB-14': 'Rôle du MVP de la finale', 'CB-15': 'Combien de régions en Knockouts ?', 'CB-16': 'Une équipe LCS atteindra-t-elle les Knockouts ?',
 'CB-17': 'HLE ou T1 : qui finira le mieux classé ?', 'CB-18': 'Équipe qui gagnera la game la plus courte',
}
NOTES = {
 'CB-1': "Fearless Draft : un champion joué dans une game ne peut plus être pické ni banni dans les games suivantes de la série. Ces games comptent quand même dans le total, donc un champion joué tôt perd de la présence. Un champion qu'on bannit à chaque game peut monter à 100 % sur la série. Il vaut donc mieux viser un champion surtout banni, comme Cassiopeia en playoffs LCK (35 bans, 2 picks sur 41 games). Les Bo1 du Swiss se jouent en draft classique.",
 'CB-10': "Les tranches de réponse affichées par le client ne sont pas connues : celles-ci sont des suppositions. Choisis dans le client la tranche qui contient le chiffre recommandé.",
}
c = json.load(open(cont)); c = c.get('result', c)
p = json.load(open(pem)); p = p.get('result', p)
pemq = {q['id'].split()[0]: q for b in p['blocks'] for q in (b.get('questions') or b.get('data', {}).get('questions', []))}
qs = []
for b in c['blocks']:
  for q in b['data']['questions']:
    qid = re.match(r'CB-\d+', q['id']).group(0)
    cs = q['contenders']
    kinds = {x['kind'] for x in cs}
    typ = 'duel' if len(cs) == 2 else ('pick' if kinds & {'champion', 'joueur', 'équipe'} and 'option' not in kinds else 'range')
    for x in cs:
      x['label'] = re.sub(r'\s*\((tranche supposée|Teemo pické)\)', '', x['name'])
      x['label'] = re.sub(r'\s*\(LCK \+ LPL seulement\)?', ' (LCK + LPL)', x['label'])
    pm = pemq.get(qid)
    qs.append({**q, 'id': qid, 'block': b['block'], 'type': typ, 'title': TITLES.get(qid, q['question']), 'note': NOTES.get(qid, ''),
               'pem': {'links': [l for l in (pm or {}).get('links', []) if l.get('url', '').startswith('http')]} if pm else None})
qs.sort(key=lambda q: int(q['id'][3:]))
data = {'questions': qs, 'lockAt': '2026-10-15T18:00:00Z', 'images': {},
        'footer': ["Méthode : 1 agent spécialiste et 1 agent adversaire, en boucle jusqu'à validation sur chaque bloc. Stats tirées de gol.gg (playoffs LCK, LPL, LEC et LCS 2026, MSI, EWC, Worlds précédents), recoupées avec pem.lol.",
                   "Les extraits viennent des résultats de recherche (les pages n'ont pas pu être ouvertes directement). Les probabilités sont des estimations. Vérifie les options exactes dans le client avant de valider.",
                   "Projet de fan, non affilié à Riot Games."]}
if len(sys.argv) > 4 and os.path.exists(sys.argv[4]): data['images'] = json.load(open(sys.argv[4]))
tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crystal.html')).read()
open(out, 'w').write(tpl.replace('/*__DATA__*/', json.dumps(data, ensure_ascii=False).replace('</', '<\\/')))
print('ok', out, os.path.getsize(out), [(q['id'], q['type']) for q in qs])
