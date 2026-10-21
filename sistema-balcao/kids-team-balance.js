// Planejador puro: não altera inscrições. A aplicação é feita em uma transação no banco.
(function (root) {
    'use strict';
    const SEXES = ['MASCULINO', 'FEMININO'];
    const paid = kid => Number(String(kid.valor_pago || '0').replace(',', '.')) >= 100;
    const eligible = kid => kid.status === 'ATIVO' && kid.funcao === 'PARTICIPANTE' && (kid.equipe_id != null || paid(kid));
    const compare = (a, b) => {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
        return 0;
    };

    function plan(teams, participants) {
        const sorted = [...teams].filter(t => t.ativo !== false).sort((a, b) => a.id.localeCompare(b.id));
        if (sorted.length < 2) throw new Error('Cadastre pelo menos dois times ativos para equilibrar.');
        const event = sorted[0].tipo_evento;
        if (sorted.some(t => t.tipo_evento !== event)) throw new Error('Selecione apenas times do mesmo evento.');
        const kids = participants.filter(k => k.tipo_evento === event && eligible(k));
        if (kids.some(k => !SEXES.includes(k.sexo) || !Number.isInteger(k.idade) || k.idade < 0)) {
            throw new Error('Corrija os cadastros com gênero ou idade inválidos antes de equilibrar.');
        }
        let states = sorted.map(team => ({team, quota: {}, members: [], ageSum: 0,
            bySex: Object.fromEntries(SEXES.map(s => [s, {count: 0, sum: 0, ages: {}}]))}));
        const quotas = states.map(() => 0);
        // As sobras de cada gênero vão para os times com menor cota total.
        // Isso garante diferença máxima de 1 tanto no total quanto em cada gênero.
        for (const sex of SEXES) {
            const group = kids.filter(k => k.sexo === sex);
            const base = Math.floor(group.length / states.length);
            states.forEach((s, i) => { s.quota[sex] = base; quotas[i] += base; });
            const order = states.map((s, i) => ({s, i,
                existing: group.filter(k => k.equipe_id === s.team.id).length}))
                .sort((a, b) => quotas[a.i] - quotas[b.i] || b.existing - a.existing || a.i - b.i);
            order.slice(0, group.length % states.length).forEach(({s, i}) => { s.quota[sex]++; quotas[i]++; });
        }
        function add(state, kid, direction) {
            const bucket = state.bySex[kid.sexo];
            bucket.count += direction;
            bucket.sum += kid.idade * direction;
            bucket.ages[kid.idade] = (bucket.ages[kid.idade] || 0) + direction;
            state.ageSum += kid.idade * direction;
        }
        const currentValid = kids.every(k => states.some(s => s.team.id === k.equipe_id)) &&
            states.every(s => SEXES.every(sex => kids.filter(k => k.equipe_id === s.team.id && k.sexo === sex).length === s.quota[sex]));
        for (const sex of SEXES) {
            const group = kids.filter(k => k.sexo === sex)
                .sort((a, b) => b.idade - a.idade || a.id.localeCompare(b.id));
            for (const kid of group) {
                const available = states.filter(s => s.bySex[sex].count < s.quota[sex]);
                const score = s => [s.bySex[sex].ages[kid.idade] || 0,
                    s.bySex[sex].sum, s.ageSum, kid.equipe_id === s.team.id ? 0 : 1];
                available.sort((a, b) => compare(score(a), score(b)) || a.team.id.localeCompare(b.team.id));
                available[0].members.push(kid);
                add(available[0], kid, 1);
            }
        }
        if (currentValid) {
            const current = states.map(s => ({team: s.team, quota: s.quota, members: [], ageSum: 0,
                bySex: Object.fromEntries(SEXES.map(sex => [sex, {count: 0, sum: 0, ages: {}}]))}));
            for (const kid of kids) {
                const state = current.find(s => s.team.id === kid.equipe_id);
                state.members.push(kid);
                add(state, kid, 1);
            }
            const quality = roster => [
                roster.reduce((sum, s) => sum + SEXES.reduce((n, sex) => n + Object.values(s.bySex[sex].ages).reduce((v, count) => v + count ** 2, 0), 0), 0),
                roster.reduce((sum, s) => sum + SEXES.reduce((n, sex) => n + s.bySex[sex].sum ** 2, 0), 0),
                roster.reduce((sum, s) => sum + s.ageSum ** 2, 0),
                roster.reduce((sum, s) => sum + s.members.filter(k => k.equipe_id !== s.team.id).length, 0)
            ];
            // Uma base que já está equilibrada nunca é substituída por outra pior.
            if (compare(quality(current), quality(states)) <= 0) states = current;
        }
        // Trocas do mesmo gênero preservam as cotas. Melhora primeiro a distribuição
        // por idade exata, depois as somas de idades por gênero e no total.
        // Empates favorecem manter a equipe original.
        const squareDelta = (a, b, d) => (a + d) ** 2 + (b - d) ** 2 - a ** 2 - b ** 2;
        for (let pass = 0; pass < 12; pass++) {
            let best = null;
            for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
                const a = states[i], b = states[j];
                for (let x = 0; x < a.members.length; x++) for (let y = 0; y < b.members.length; y++) {
                    const ka = a.members[x], kb = b.members[y];
                    if (ka.sexo !== kb.sexo) continue;
                    const sa = a.bySex[ka.sexo], sb = b.bySex[ka.sexo];
                    const d = kb.idade - ka.idade;
                    const histogram = d === 0 ? 0 :
                        squareDelta(sa.ages[ka.idade] || 0, sb.ages[ka.idade] || 0, -1) +
                        squareDelta(sa.ages[kb.idade] || 0, sb.ages[kb.idade] || 0, 1);
                    const moved = (k, t) => k.equipe_id === t.team.id ? 0 : 1;
                    const score = [histogram, squareDelta(sa.sum, sb.sum, d), squareDelta(a.ageSum, b.ageSum, d),
                        moved(ka, b) + moved(kb, a) - moved(ka, a) - moved(kb, b)];
                    if (compare(score, [0, 0, 0, 0]) < 0 && (!best || compare(score, best.score) < 0)) {
                        best = {a, b, x, y, ka, kb, score};
                    }
                }
            }
            if (!best) break;
            const {a, b, x, y, ka, kb} = best;
            add(a, ka, -1); add(b, kb, -1); add(a, kb, 1); add(b, ka, 1);
            a.members[x] = kb; b.members[y] = ka;
        }
        return states.flatMap(s => s.members.map(k => ({id: k.id, equipe_id: s.team.id})));
    }
    const api = {plan, eligible};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.KidsTeamBalance = api;
})(typeof window !== 'undefined' ? window : globalThis);
