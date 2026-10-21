const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const {plan} = require('../sistema-balcao/kids-team-balance.js');
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const event = 'BROTHERS_CAMP';

test('funções SQL: prévia, aplicação atômica, permissões e atribuição incremental', async t => {
    const db = new PGlite();
    await db.exec(`
        create role anon; create role authenticated;
        create schema auth;
        create function auth.jwt() returns jsonb language sql as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
        create table equipes_kids (
            id uuid primary key, tipo_evento text not null, nome_time text,
            professores_responsaveis text, ativo boolean default true, criado_em timestamptz default now()
        );
        create table inscricoes_kids (
            id uuid primary key, tipo_evento text not null, nome_crianca text, sexo text,
            idade integer, equipe_id uuid references equipes_kids, valor_pago text,
            funcao text default 'PARTICIPANTE', status text default 'ATIVO',
            data_ultima_atualizacao timestamptz default now()
        );
    `);
    const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261021_kids_equilibrio_times.sql'),'utf8');
    await db.exec(migration);
    const jwt = email => db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({email})]);
    async function fixture() {
        await db.exec('truncate inscricoes_kids, equipes_kids');
        await jwt('adm@alvo.com');
        for(let i=0;i<4;i++) await db.query('insert into equipes_kids(id,tipo_evento,nome_time) values ($1,$2,$3)',[uuid(i+1),event,`Time ${i}`]);
        await db.query('insert into equipes_kids(id,tipo_evento,nome_time) values ($1,$2,$3)',[uuid(5),'ACAMPA_KIDS','Outro evento']);
        let id=100;
        for(const [team,boys] of [[1,10],[2,6],[3,8],[4,10]]) for(let i=0;i<20;i++) {
            await db.query(`insert into inscricoes_kids(id,tipo_evento,nome_crianca,sexo,idade,equipe_id,valor_pago)
                values ($1,$2,$3,$4,$5,$6,'100,00')`,[uuid(id++),event,`Teen ${id}`,i<boys?'MASCULINO':'FEMININO',10+i%5,uuid(team)]);
        }
        await db.query(`insert into inscricoes_kids(id,tipo_evento,nome_crianca,sexo,idade,valor_pago)
            values ($1,$2,'Sem entrada','FEMININO',12,'0,00')`,[uuid(300),event]);
    }
    async function snapshot() {
        return (await db.query('select kids_preparar_equilibrio($1) as data',[event])).rows[0].data;
    }
    const apply = (s, distribution=plan(s.equipes,s.participantes)) => db.query(
        'select kids_aplicar_equilibrio($1,$2,$3::jsonb) as changed',[event,s.assinatura,JSON.stringify(distribution)]);
    const assignments = async()=> (await db.query('select id,equipe_id from inscricoes_kids order by id')).rows;

    await t.test('migration é repetível e não redistribui automaticamente',async()=>{
        await fixture(); const before=await assignments();
        await db.exec(migration); assert.deepEqual(await assignments(),before);
    });
    await t.test('somente os administradores de equipes têm acesso à prévia e aplicação',async()=>{
        await fixture(); const s=await snapshot();
        for(const email of ['','atendente@alvo.com','karina@alvo.com']) {
            await jwt(email);
            await assert.rejects(snapshot,/Sem permissão/);
            await assert.rejects(()=>apply(s),/Sem permissão/);
        }
        await jwt('matheus@alvocuritiba.com.br'); await snapshot();
        const privileges=(await db.query(`select has_function_privilege('anon','kids_preparar_equilibrio(text)','EXECUTE') as preview,
            has_function_privilege('anon','kids_aplicar_equilibrio(text,text,jsonb)','EXECUTE') as apply`)).rows[0];
        assert.deepEqual(privileges,{preview:false,apply:false});
    });
    await t.test('plano incompleto, duplicado, de outro evento ou desequilibrado não altera ninguém',async()=>{
        await fixture(); const s=await snapshot(), good=plan(s.equipes,s.participantes), before=await assignments();
        const bad=[good.slice(1),good.map((d,i)=>i===0?good[1]:d),
            good.map((d,i)=>i===0?{...d,equipe_id:uuid(5)}:d),good.map(d=>({...d,equipe_id:uuid(1)}))];
        for(const distribution of bad) { await assert.rejects(()=>apply(s,distribution)); assert.deepEqual(await assignments(),before); }
        await assert.rejects(()=>apply({...s,assinatura:null}),/dados mudaram/);
    });
    await t.test('edições após a prévia invalidam a aplicação, inclusive pagamento de quem ainda não tem time',async()=>{
        for(const sql of ["update inscricoes_kids set idade=14 where id='"+uuid(100)+"'",
            "update inscricoes_kids set valor_pago='100,00' where id='"+uuid(300)+"'",
            "update equipes_kids set ativo=false where id='"+uuid(1)+"'"]) {
            await fixture(); const s=await snapshot(); await db.exec(sql); const before=await assignments();
            await assert.rejects(()=>apply(s),/dados mudaram/); assert.deepEqual(await assignments(),before);
        }
    });
    await t.test('aplica todas as trocas juntas e preserva participantes sem entrada',async()=>{
        await fixture(); const s=await snapshot(), distribution=plan(s.equipes,s.participantes);
        const response=await apply(s,distribution); assert(response.rows[0].changed>0);
        const actual=await assignments();
        for(const d of distribution) assert.equal(actual.find(k=>k.id===d.id).equipe_id,d.equipe_id);
        assert.equal(actual.find(k=>k.id===uuid(300)).equipe_id,null);
        const updated=await snapshot(); assert.equal((await apply(updated,distribution)).rows[0].changed,0);
        const counts=(await db.query(`select equipe_id,count(*)::int as total,
            count(*) filter(where sexo='MASCULINO')::int as boys from inscricoes_kids where equipe_id is not null group by equipe_id`)).rows;
        assert(counts.every(c=>c.total===20)); assert.deepEqual(counts.map(c=>c.boys).sort(),[8,8,9,9]);
    });
    await t.test('atribuição incremental prioriza gênero antes da idade e respeita elegibilidade',async()=>{
        await fixture();
        await db.query("update inscricoes_kids set valor_pago='100,00',sexo='MASCULINO',idade=14 where id=$1",[uuid(300)]);
        await db.query('select kids_atribuir_uma($1)',[uuid(300)]);
        assert.equal((await db.query('select equipe_id from inscricoes_kids where id=$1',[uuid(300)])).rows[0].equipe_id,uuid(2));
        for(const [status,funcao,paid] of [['ATIVO','PARTICIPANTE','99,99'],['CANCELADO','PARTICIPANTE','100,00'],['ATIVO','TRABALHO','100,00']]) {
            await db.query('update inscricoes_kids set equipe_id=null,status=$1,funcao=$2,valor_pago=$3 where id=$4',[status,funcao,paid,uuid(300)]);
            await db.query('select kids_atribuir_uma($1)',[uuid(300)]);
            assert.equal((await db.query('select equipe_id from inscricoes_kids where id=$1',[uuid(300)])).rows[0].equipe_id,null);
        }
    });
    await db.close();
});
