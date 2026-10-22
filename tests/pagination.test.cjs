const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../sistema-balcao', file), 'utf8');

function backend(tables, cap = 300) {
    const calls = [];
    let failAt = Infinity;
    return {
        calls,
        failAfter(offset) { failAt = offset; },
        from(table) {
            let rows = tables[table] || [];
            const orders = [];
            const query = {
                select() {return query;},
                or() {return query;},
                eq(key, value) {rows = rows.filter(row => row[key] === value); return query;},
                in(key, values) {rows = rows.filter(row => values.includes(row[key])); return query;},
                order(key) {orders.push(key); return query;},
                async range(from, to) {
                    calls.push({table, from, to, orders: [...orders]});
                    if (from >= failAt) return {error: {message: 'Falha na página seguinte'}};
                    return {data: rows.slice(from, Math.min(to + 1, from + cap))};
                }
            };
            return query;
        }
    };
}

function kidsFixture(db) {
    const source = read('kids.js').replace('window.KidsModule = {', `window.KidsModule = {
        fetchAllRowsKids, loadKids, loadTeams, fetchParticipantsStatusKids,
        get kidsSnapshot() {return allKids;}, get teamsSnapshot() {return allTeams;},`);
    let html = '';
    const popup = {closed: false, document: {
        body: {}, open() {}, close() {}, write(value) {html = value;},
        getElementById() {return {addEventListener() {}};}
    }};
    const context = {console: {error() {}}, window: {
        supabaseBalcao: db, getCurrentUserBalcao: () => ({email: 'adm@alvo.com'}),
        showNotification() {}, open: () => popup
    }};
    vm.runInNewContext(source, context);
    return {api: context.window.KidsModule, html: () => html};
}

for (const [file, helper, indent, size] of [
    ['kids.js', 'fetchAllRowsKids', 4, 'KIDS_CHUNK_SIZE'],
    ['app.js', 'fetchAllRows', 8, 'PARTICIPANT_CHUNK_SIZE']
]) {
    const pattern = new RegExp(`^ {${indent}}async function ${helper}\\(buildQuery\\) \\{[\\s\\S]*?^ {${indent}}\\}`, 'm');
    const helperSource = read(file).match(pattern)[0];
    for (const cap of [1000, 300]) {
        test(`${file}: lê 2507 linhas com limite do servidor de ${cap}, sem pular nem duplicar`, async () => {
            const data = Array.from({length: 2507}, (_, id) => ({id}));
            const db = backend({data}, cap);
            const context = {};
            vm.runInNewContext(`const ${size} = 1000; ${helperSource}; globalThis.fetchRows = ${helper};`, context);
            const result = await context.fetchRows(() => db.from('data').select('*').order('id'));
            assert.deepEqual(Array.from(result, row => row.id), data.map(row => row.id));
            assert.equal(db.calls.at(-1).from, 2507, 'Confirma o fim com uma página vazia');
        });
    }
    test(`${file}: falha em uma página rejeita a consulta em vez de devolver dados parciais`, async () => {
        const db = backend({data: Array.from({length: 1200}, (_, id) => ({id}))});
        db.failAfter(300);
        const context = {};
        vm.runInNewContext(`const ${size} = 1000; ${helperSource}; globalThis.fetchRows = ${helper};`, context);
        await assert.rejects(context.fetchRows(() => db.from('data')), {message: /Falha na página seguinte/});
    });
}

test('Kids: tela e relatório incluem mais de mil participantes, sem time e último registro', async () => {
    const participants = Array.from({length: 2507}, (_, id) => ({
        id, tipo_evento: 'ACAMPA_KIDS', funcao: 'PARTICIPANTE', status: 'ATIVO',
        equipe_id: id === 2506 ? null : 'a', nome_crianca: `Pessoa ${id}`, idade: 10
    }));
    participants.push({...participants[0], id: 9999, status: 'CANCELADO', nome_crianca: 'Não incluir'});
    const db = backend({inscricoes_kids: participants, equipes_kids: [{id: 'a', tipo_evento: 'ACAMPA_KIDS', nome_time: 'Águias'}]});
    const {api, html} = kidsFixture(db);
    await api.loadKids(); await api.loadTeams(); await api.generateTeamsReport();
    assert.equal(api.kidsSnapshot.length, 2507);
    assert.equal(api.teamsSnapshot.length, 1);
    assert.equal((html().match(/aria-label="Espaço para conferência"/g) || []).length, 2507);
    assert(html().includes('Pessoa 2506'));
    assert(html().includes('Participantes sem time'));
    assert(!html().includes('Não incluir'));
    assert(db.calls.every(call => call.orders.includes('id')), 'Ordem estável em todas as páginas');
    db.failAfter(300);
    await assert.rejects(api.loadKids(), {message: /Falha na página seguinte/});
    assert.equal(api.kidsSnapshot.length, 2507, 'Falha não substitui a base por dados incompletos');
});

test('Kids: filtro de status de pagamento pagina cada lote de IDs', async () => {
    const rows = Array.from({length: 1507}, (_, index) => ({id: index + 1, status_pagamento: 'PAGO'}));
    const db = backend({inscricoes_kids: rows}, 200);
    const {api} = kidsFixture(db);
    const result = await api.fetchParticipantsStatusKids(rows.map(row => row.id));
    assert.equal(result.length, 1507);
    assert.equal(new Set(result.map(row => row.id)).size, 1507);
});

test('Balcão: base, busca e inscrições de eventos carregam todas as páginas', async () => {
    const source = read('app.js');
    const names = ['fetchAllRows', 'loadParticipants', 'searchParticipants', 'loadEventRegistrationsList', 'loadEvents', 'fetchParticipantsStatus'];
    const functions = names.map(name => source.match(new RegExp(`^ {8}async function ${name}\\([^\\n]*?\\) \\{[\\s\\S]*?^ {8}\\}`, 'm'))[0]).join('\n');
    const rows = Array.from({length: 1507}, (_, index) => ({id: index + 1, evento_id: 'event', status: 'ATIVO'}));
    const db = backend({inscricoes: rows, inscricoes_eventos: rows, eventos: rows}, 200);
    const elements = new Map();
    const context = {
        supabase: db, console: {log() {}, error() {}},
        document: {getElementById(id) {if (!elements.has(id)) elements.set(id, {value: 'Maria'}); return elements.get(id);}},
        showNotification() {}, updateEventStats() {}, renderEventList() {}, renderEventsGrid() {},
        isCurrentUserAdm: () => true
    };
    vm.runInNewContext(`
        const PARTICIPANT_CHUNK_SIZE = 1000;
        let allParticipants = [], eventRegistrations = [], allEvents = [], found = [];
        const selectedEvent = {id: 'event'};
        function displaySearchResults(rows) {found = rows;}
        ${functions}
        globalThis.api = {${names.join(',')}, snapshot: () => ({allParticipants, eventRegistrations, allEvents, found})};
    `, context);
    const {api} = context;
    await api.loadParticipants();
    await api.searchParticipants();
    await api.loadEventRegistrationsList();
    await api.loadEvents();
    for (const [key, data] of Object.entries(api.snapshot())) {
        assert.equal(data.length, 1507, key);
        assert.equal(new Set(data.map(row => row.id)).size, 1507, key);
    }
    assert.equal((await api.fetchParticipantsStatus(rows.map(row => row.id))).length, 1507);
    assert(db.calls.every(call => call.orders.includes('id')));
    db.failAfter(200);
    await assert.rejects(api.loadParticipants(), {message: /Falha na página seguinte/});
    assert.equal(api.snapshot().allParticipants.length, 1507);
});
