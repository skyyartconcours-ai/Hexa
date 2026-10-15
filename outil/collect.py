# Assemble the latest available outputs from workflow journals (used for previews before the workflows finish)
import json, sys, re
W = '/root/.claude/projects/-home-user/46fe976d-d002-580c-b70b-85233d23bf62/subagents/workflows/'
def journal(wf):
    lab, res = {}, []
    for l in open(W + wf + '/journal.jsonl'):
        j = json.loads(l)
        if j.get('type') == 'started': lab[j['agentId']] = j['label']
        if j.get('type') == 'result': res.append((lab.get(j['agentId'], '?'), j.get('result')))
    return res
def latest(res, prefix):
    v = [r for l, r in res if l.startswith(prefix) and r]
    return v[-1] if v else None
out = sys.argv[1]
g = journal('wf_1c257c57-5c3')
hist = []
for l, r in g:
    m = re.match(r'(fact-checker|critique-logique):r(\d)', l)
    if m and r: hist.append((int(m.group(2)), m.group(1), sum(1 for i in r['issues'] if i['severity'] == 'blocking')))
rounds = {}
for rn, k, b in hist: rounds[rn] = rounds.get(rn, 0) + b
gen = {'passed': False, 'history': [{'round': k, 'blocking': v} for k, v in sorted(rounds.items())],
       'dossier': latest(g, 'data-analyst'), 'analysis': latest(g, 'stratege')}
json.dump(gen, open(out + '/gen.json', 'w'), ensure_ascii=False)
c = journal('wf_b8b21267-82d')
blocks = []
for b in ['CHAMPIONS', 'JOUEURS', 'TOURNOI', 'EQUIPES']:
    d = latest(c, f'specialiste:{b}')
    revs = [r for l, r in c if l.startswith(f'adversaire:{b}') and r]
    if d: blocks.append({'block': b, 'passed': bool(revs) and revs[-1]['verdict'] == 'pass' and len(revs) == len([1 for l, r in c if l.startswith(f'specialiste:{b}') and r]),
                         'history': [{'round': i + 1, 'blocking': sum(1 for x in r['issues'] if x['severity'] == 'blocking')} for i, r in enumerate(revs)], 'data': d})
json.dump({'blocks': blocks}, open(out + '/cont.json', 'w'), ensure_ascii=False)
print('gen', bool(gen['analysis']), 'blocks', [(b['block'], len(b['data']['questions']), b['passed']) for b in blocks])
