const {test} = require('node:test');
const assert = require('node:assert/strict');
const {plan, eligible} = require('../sistema-balcao/kids-team-balance.js');
const event = 'BROTHERS_CAMP';
const teams = Array.from({length: 4}, (_, i) => ({id: `team-${i}`, tipo_evento: event, ativo: true}));
const kid = (id, sexo, idade, equipe_id = null, extra = {}) => ({id: String(id), sexo, idade, equipe_id,
    tipo_evento: event, status: 'ATIVO', funcao: 'PARTICIPANTE', valor_pago: '100,00', ...extra});
function verify(availableTeams, kids) {
    const result = plan(availableTeams, kids);
    const ids = new Set(result.map(d => d.id));
    const included = kids.filter(k => k.tipo_evento === event && eligible(k));
    assert.equal(result.length, included.length);
    assert.equal(ids.size, result.length);
    assert.deepEqual([...ids].sort(), included.map(k => k.id).sort());
    const lookup = new Map(kids.map(k => [k.id, k]));
    const groups = availableTeams.filter(t => t.ativo !== false).map(t => result.filter(d => d.equipe_id === t.id).map(d => lookup.get(d.id)));
    for (const sex of [null, 'MASCULINO', 'FEMININO']) {
        const counts = groups.map(g => g.filter(k => !sex || k.sexo === sex).length);
        assert(Math.max(...counts) - Math.min(...counts) <= 1, `Cotas desequilibradas: ${counts}`);
    }
    assert.deepEqual(result, plan(availableTeams, kids), 'A prévia deve ser determinística');
    return {result, groups};
}
test('cenário da imagem: 34 meninos e 46 meninas ficam em quatro times de 20', () => {
    const kids = [];
    [[10,10],[6,14],[8,12],[10,10]].forEach(([boys, girls], t) => {
        for (let i=0; i<boys+girls; i++) kids.push(kid(kids.length, i<boys?'MASCULINO':'FEMININO', 10+i%5, teams[t].id));
    });
    const {groups} = verify(teams, kids);
    assert(groups.every(g => g.length === 20));
    assert.deepEqual(groups.map(g => g.filter(k=>k.sexo==='MASCULINO').length).sort(), [8,8,9,9]);
    assert(groups.every(g => Math.min(...g.map(k=>k.idade)) === 10 && Math.max(...g.map(k=>k.idade)) === 14));
});
test('idades e gêneros iguais são distribuídos entre os times', () => {
    const kids=[];
    for(const sex of ['MASCULINO','FEMININO']) for(let age=10;age<=14;age++) for(let i=0;i<8;i++) kids.push(kid(kids.length,sex,age));
    const {groups}=verify(teams,kids);
    for(const g of groups) for(const sex of ['MASCULINO','FEMININO']) for(let age=10;age<=14;age++) {
        assert.equal(g.filter(k=>k.sexo===sex&&k.idade===age).length,2);
    }
});
test('respeita evento, pagamento mínimo, cancelamentos e equipe de trabalho', () => {
    const kids=[kid('pago','MASCULINO',12),kid('sem-entrada','FEMININO',12,null,{valor_pago:'99,99'}),
        kid('ja-no-time','FEMININO',13,'team-0',{valor_pago:'0'}),
        kid('cancelado','MASCULINO',14,null,{status:'CANCELADO'}),
        kid('trabalho','MASCULINO',30,null,{funcao:'TRABALHO'}),
        kid('outro','MASCULINO',8,null,{tipo_evento:'ACAMPA_KIDS'})];
    const {result}=verify(teams,kids);
    assert.deepEqual(result.map(d=>d.id).sort(),['ja-no-time','pago']);
});
test('bases pequenas, gênero único e equipes inativas', () => {
    verify(teams,[]);
    for(let n=1;n<=17;n++) verify([...teams,{id:'inactive',tipo_evento:event,ativo:false}],Array.from({length:n},(_,i)=>kid(i,'FEMININO',10+i%5)));
    assert.throws(()=>plan(teams.slice(0,1),[]),/dois times/);
    assert.throws(()=>plan(teams,[kid('erro','MASCULINO',null)]),/inválidos/);
});
test('mantém uma distribuição já equilibrada e corrige concentrações de idade', () => {
    const balanced = Array.from({length:80},(_,i)=>kid(i,i%2?'MASCULINO':'FEMININO',12,teams[Math.floor(i/20)].id));
    const {result}=verify(teams,balanced);
    assert(result.every(d=>balanced.find(k=>k.id===d.id).equipe_id===d.equipe_id));
    const concentrated=Array.from({length:80},(_,i)=>kid(i,'MASCULINO',10+Math.floor(i/20),teams[Math.floor(i/20)].id));
    const {groups}=verify(teams,concentrated);
    for(const group of groups) for(let age=10;age<14;age++) assert.equal(group.filter(k=>k.idade===age).length,5);
});
test('propriedades das cotas em 150 cenários de 2 a 8 times', () => {
    let seed=314159;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    for(let run=0;run<150;run++) {
        const available=Array.from({length:2+run%7},(_,i)=>({id:`t${i}`,tipo_evento:event,ativo:true}));
        const kids=Array.from({length:Math.floor(random()*180)},(_,i)=>kid(i,random()<0.43?'MASCULINO':'FEMININO',10+Math.floor(random()*5),available[Math.floor(random()*available.length)].id));
        verify(available,kids);
    }
});
