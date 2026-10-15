import json, sys, os, base64, re
import argparse
ap = argparse.ArgumentParser(); ap.add_argument('res'); ap.add_argument('out'); ap.add_argument('--cb'); ap.add_argument('--shots'); ap.add_argument('--pem'); ap.add_argument('--cont'); ap.add_argument('--images'); ap.add_argument('--preview', action='store_true'); ap.add_argument('--note', action='append', default=[])
A = ap.parse_args(); res, out, shots_map = A.res, A.out, A.shots
r = json.load(open(res))
if 'result' in r: r = r['result']
h = r.get('history', [])
data = {
  'generated': '15/10/2026',
  'analysis': r['analysis'], 'dossier': r['dossier'],
  'lock': {'label': 'Fermeture Play-In + Crystal Ball (15/10, 20h00 Paris)', 'at': '2026-10-15T18:00:00Z'},
  'banner': None if r.get('passed') else {'title': 'Validation incomplète', 'text': 'Les adversaires ont encore signalé des points bloquants au dernier tour. Chaque preuve garde son statut : ne présentez comme certain que ce qui est corroboré.'},
  'method': [
    'Spécialiste #1 (data analyst) : playoffs 2026 LCK, LPL, LEC, LCS, format des Worlds, contexte international.',
    "Spécialiste #2 (stratège Pick'Ems) : un pick par question, confiance, alternatives, preuves.",
    'Adversaire #1 (fact-checker) : recoupe chaque affirmation dans les résultats de recherche. « Corroboré » signifie au moins 2 sources indépendantes.',
    'Adversaire #2 (critique logique) : questions manquantes, cohérence des picks, biais, infos périmées.',
    'Boucle : ' + ', '.join(f"tour {x['round']} : {x['blocking']} bloquant(s)" for x in h) + ('. Validé.' if r.get('passed') else '. Arrêt au nombre maximal de tours.'),
    "Les extraits entre guillemets sont recopiés depuis les résultats de recherche. Ce ne sont pas des captures d'écran : l'accès direct aux pages était bloqué dans cet environnement.",
  ],
  'shots': {},
}
if shots_map and os.path.exists(shots_map):
  for url, path in json.load(open(shots_map)).items():
    if os.path.exists(path):
      data['shots'][url] = 'data:image/jpeg;base64,' + base64.b64encode(open(path, 'rb').read()).decode()
  data['method'][-1] = "Les captures d'écran ont été prises sur les pages sources ; les extraits entre guillemets sont le texte qui prouve chaque point."
if A.cb:
  cb = json.load(open(A.cb)); cb = cb.get('result', cb)
  cbq = []; cb_hist = []
  for b in cb['blocks']:
    cb_hist.append(f"{b['block']} : " + ', '.join(f"tour {x['round']} = {x['blocking']} bloquant(s)" for x in b['history']) + (' (validé)' if b['passed'] else ' (non entièrement validé)'))
    dq = {q['id'].split()[0]: q for q in (b.get('data') or {}).get('questions', [])}
    for pq in (b.get('picks') or {}).get('questions', []):
      qid = pq['id'].split()[0]; d = dq.get(qid, {})
      stats = d.get('stats', [])
      ev = []
      for st in stats:
        srcs = st.get('sources', [])
        ev.append({'claim_id': st['id'], 'claim': f"{st['label']} : {st['value']}" + (f" ({st['scope']})" if st.get('scope') else ''), 'status': st['status'], 'golgg_url': st.get('golgg_url', ''), 'sources': srcs})
      sid = {st['id']: st for st in stats}
      hs = [{'label': sid[i]['label'], 'value': sid[i]['value'], 'claim_id': i, 'scope': sid[i].get('scope', ''), 'golgg_url': sid[i].get('golgg_url', '')} for i in pq.get('headline_stat_ids', []) if i in sid]
      if d.get('question_sources'):
        ev.insert(0, {'claim_id': qid + '-Q', 'claim': 'Formulation de la question : ' + d.get('exact_question', pq['question']), 'status': pq['question_status'], 'sources': d['question_sources']})
      cbq.append({**pq, 'id': qid, 'stage': 'Crystal Ball', 'block': b['block'], 'question': d.get('exact_question') or pq['question'], 'options': pq.get('options') or d.get('options', ''), 'headline_stats': hs, 'evidence': ev, 'tables': d.get('tables', [])})
  order = lambda q: int(''.join(c for c in q['id'] if c.isdigit()) or 0)
  cbq.sort(key=order)
  data['analysis']['questions'] = [q for q in data['analysis']['questions'] if q['stage'] != 'Crystal Ball'] + cbq
  data['cbIntro'] = "18 prédictions valables sur tout le tournoi, à verrouiller avant le premier match du Play-In. Chaque stat renvoie vers la page gol.gg correspondante : playoffs 2026 LCK, LPL, LEC, LCS, plus les Worlds et le MSI comme références."
  data['method'].insert(-1, 'Crystal Ball, boucle dédiée par bloc : ' + ' | '.join(cb_hist))
if A.cont:
  ct = json.load(open(A.cont)); ct = ct.get('result', ct)
  newq = {}; hist = []
  for b in ct['blocks']:
    hist.append(f"{b['block']} : " + (', '.join(f"tour {x['round']} = {x['blocking']} bloquant(s)" for x in b['history']) or 'en attente de l\'adversaire') + (' (validé)' if b['passed'] else ''))
    for q in (b.get('data') or {}).get('questions', []):
      qid = re.match(r'CB-\d+', q['id']).group(0)
      cs = sorted(q.get('contenders', []), key=lambda c: c.get('rank', 9))
      ev = []
      for c in cs:
        for st in c.get('stats', []):
          ev.append({'claim_id': '', 'claim': f"{c['name']} — {st['label']} : {st['value']} ({st['scope']})", 'status': st['status'], 'golgg_url': st['url'] if st['site'] == 'gol.gg' else '', 'sources': [{'name': st['site'], 'url': st['url'], 'snippet': st['snippet']}]})
      for st in q.get('context_stats', []):
        ev.append({'claim_id': '', 'claim': f"{st['label']} : {st['value']} ({st['scope']})", 'status': st['status'], 'golgg_url': st['url'] if st['site'] == 'gol.gg' else '', 'sources': [{'name': st['site'], 'url': st['url'], 'snippet': st['snippet']}]})
      newq[qid] = {'id': qid, 'stage': 'Crystal Ball', 'block': b['block'], 'question': q['question'], 'options': q.get('options', ''), 'question_status': q['question_status'],
                   'recommended_answer': q['recommended_answer'], 'confidence': q['confidence'], 'confidence_pct': q['confidence_pct'], 'reasoning': q['reasoning'], 'video_hook': q.get('video_hook', ''),
                   'alternatives': ', '.join(f"{c['name']} ({round(c['probability_pct'])}%)" for c in cs[1:]), 'contenders': cs, 'headline_stats': [], 'evidence': ev, 'verified': b['passed']}
  qs = data['analysis']['questions']
  for i, q in enumerate(qs):
    m = re.match(r'CB-\d+', q['id'])
    if m and m.group(0) in newq: qs[i] = newq.pop(m.group(0))
    elif q['stage'] == 'Crystal Ball' and m: q['block'] = q.get('block') or ('CHAMPIONS' if int(m.group(0)[3:]) <= 3 else 'JOUEURS' if int(m.group(0)[3:]) <= 8 else 'TOURNOI' if int(m.group(0)[3:]) <= 13 else 'EQUIPES')
  qs = [q for q in qs if not (q['stage'] == 'Crystal Ball' and 'contenders' not in q)]  # the general loop numbered CB questions differently: keep only the dedicated Crystal Ball data
  qs.extend(newq.values())
  num = lambda q: int(re.sub(r'\D', '', q['id']) or 0)
  cb = sorted([q for q in qs if q['stage'] == 'Crystal Ball'], key=num)
  data['analysis']['questions'] = [q for q in qs if q['stage'] != 'Crystal Ball'] + cb
  data['cbIntro'] = "18 prédictions valables sur tout le tournoi, à verrouiller avant le premier match du Play-In (15/10, 20h00 heure de Paris). Pour chaque question : les meilleurs prétendants classés, avec leur probabilité et des stats qui renvoient vers gol.gg et pem.lol."
  data['method'].insert(-1, 'Crystal Ball, meilleurs prétendants (1 spécialiste + 1 adversaire en boucle) : ' + ' | '.join(hist))
for n in A.note: data['method'].insert(-1, n)
if A.images and os.path.exists(A.images):
  data['images'] = json.load(open(A.images))
if A.preview:
  data['banner'] = {'title': 'Prévisualisation, vérification en cours', 'text': "Les agents adversaires n'ont pas encore validé toutes les questions. Cette page sera mise à jour à la même adresse."}
if A.pem:
  pm = json.load(open(A.pem)); pm = pm.get('result', pm)
  bad = set(); byid = {}
  for b in pm.get('blocks', []):
    bad |= set((b.get('review') or {}).get('removed_urls', []))
    for q in (b.get('questions') or (b.get('data') or {}).get('questions', [])):
      byid[q['id'].split()[0]] = q
  for q in data['analysis']['questions']:
    x = byid.get(q['id'])
    if x:
      links = [l for l in x.get('links', []) if l['url'] not in bad and l['url'].startswith('http')]
      q['pem'] = {'prediction': x.get('pem_prediction', ''), 'leaders': x.get('historical_leaders', ''), 'links': links, 'page': 'https://pem.lol/worlds/2026/pickems'}
  lk = pm.get('lock')
  if lk and lk.get('crystal_ball_lock_utc'):
    data['lock_info'] = lk
  data['method'].insert(-1, "pem.lol : collecte par bloc, puis contrôle adversarial des URLs ; " + str(len(bad)) + " URL(s) retirée(s).")
tpl = open(os.path.join(os.path.dirname(__file__), 'template.html')).read()
js = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
open(out, 'w').write(tpl.replace('/*__DATA__*/', js))
print('ok', out, os.path.getsize(out))
