const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const planner = require('../sistema-balcao/kids-team-balance.js');
function fixture({failApply = false, failPreview = false, email = 'adm@alvo.com'} = {}) {
    const teams = ['a','b'].map(id=>({id,tipo_evento:'ACAMPA_KIDS',nome_time:`Time <${id}>`,ativo:true}));
    let kids = Array.from({length:8},(_,i)=>({id:`k${i}`,tipo_evento:'ACAMPA_KIDS',nome_crianca:`Teen <${i}>`,sexo:i<4?'MASCULINO':'FEMININO',idade:5+i%4,equipe_id:'a',status:'ATIVO',funcao:'PARTICIPANTE',valor_pago:'100,00'}));
    const elements = new Map(), calls=[], notices=[];
    const doc = {getElementById(id) {
        if(!elements.has(id)) elements.set(id,{style:{display:'none'},innerHTML:'',textContent:'',value:'',disabled:false,classList:{toggle(){}}});
        return elements.get(id);
    }};
    const context={document:doc,console,window:{KidsTeamBalance:planner,getCurrentUserBalcao:()=>({email}),showNotification:(...args)=>notices.push(args),supabaseBalcao:{
        async rpc(name,args) {
            calls.push({name,args});
            if(name==='kids_preparar_equilibrio') return failPreview?{error:{code:'PGRST202'}}:{data:{equipes:teams,participantes:kids,assinatura:'snapshot'}};
            if(failApply) return {error:{message:'Os dados mudaram. Gere uma nova prévia antes de aplicar.'}};
            kids=kids.map(k=>({...k,equipe_id:args.p_distribuicao.find(d=>d.id===k.id).equipe_id}));
            return {data:4};
        },
        from(table) {
            const q={select(){return q},eq(){return q},order(){return q},async range(from,to){return {data:(table==='equipes_kids'?teams:kids).slice(from,to+1)}}};
            return q;
        }
    }}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../sistema-balcao/kids.js'),'utf8'),context);
    return {api:context.window.KidsModule,doc,calls,notices};
}
test('prévia não aplica mudanças e exibe antes/depois, idades, trocas e nomes escapados',async()=>{
    const {api,doc,calls}=fixture();
    await api.previewTeamsBalance();
    assert.equal(calls.length,1); assert.equal(calls[0].name,'kids_preparar_equilibrio');
    const html=doc.getElementById('kids-balance-content').innerHTML;
    for(const text of ['Antes:','Depois:','Idades depois','Mudanças propostas','Teen &lt;','Time &lt;']) assert(html.includes(text),text);
    assert.equal(doc.getElementById('kids-balance-modal').style.display,'flex');
    api.closeTeamsBalance();
    await api.applyTeamsBalance(); assert.equal(calls.length,1,'Fechar deve descartar a proposta');
});
test('aplicar envia a assinatura e a distribuição uma única vez e atualiza a tela',async()=>{
    const {api,doc,calls,notices}=fixture();
    await api.previewTeamsBalance();
    await Promise.all([api.applyTeamsBalance(),api.applyTeamsBalance()]);
    const applies=calls.filter(c=>c.name==='kids_aplicar_equilibrio');
    assert.equal(applies.length,1); assert.equal(applies[0].args.p_assinatura,'snapshot');
    assert.equal(applies[0].args.p_distribuicao.length,8);
    assert.equal(doc.getElementById('kids-balance-modal').style.display,'none');
    assert(notices.some(n=>n[0].includes('Times equilibrados!')));
});
test('erro ao aplicar descarta a prévia e exige nova consulta',async()=>{
    const {api,doc,calls}=fixture({failApply:true});
    await api.previewTeamsBalance(); await api.applyTeamsBalance(); await api.applyTeamsBalance();
    assert.equal(calls.filter(c=>c.name==='kids_aplicar_equilibrio').length,1);
    assert(doc.getElementById('kids-balance-error').textContent.includes('nova prévia'));
    assert.equal(doc.getElementById('kids-balance-apply-btn').disabled,true);
    assert.equal(doc.getElementById('kids-balance-close-btn').disabled,false);
});
test('migration ausente tem mensagem clara e atendente não acessa a função',async()=>{
    const missing=fixture({failPreview:true}); await missing.api.previewTeamsBalance();
    assert(missing.notices.some(n=>n[0].includes('ainda não foi ativado')));
    const denied=fixture({email:'atendente@alvo.com'}); await denied.api.previewTeamsBalance(); await denied.api.applyTeamsBalance();
    assert.equal(denied.calls.length,0);
});
