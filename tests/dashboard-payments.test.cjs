const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '../sistema-balcao', file), 'utf8');
const uuid = index => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const participants = Array.from({length: 741}, (_, index) => ({
    id: uuid(index), status_pagamento: index < 635 ? 'PAGO' : 'PAGO PARCIALMENTE'
}));
const payments = participants.map((p, index) => ({
    id: index + 1, inscricao_id: p.id, nome_participante: `Pessoa ${index}`,
    valor_pago: index < 635 ? 250 : 100, forma_pagamento: 'PIX',
    atendente: 'adm', data_pagamento: '2026-10-23T12:00:00Z'
}));

// Simula tanto o limite HTTP da URL quanto um limite de linhas do servidor
// menor que a página solicitada, usando UUIDs reais em vez de IDs numéricos.
function backend() {
    const requests = [];
    return {
        requests,
        from(table) {
            let rows = table === 'pagamentos_kids' ? payments : participants;
            let queryString = '';
            const query = {
                select() {return query;},
                order() {return query;},
                in(key, values) {
                    queryString = new URLSearchParams({[key]: `in.(${values.join(',')})`}).toString();
                    rows = rows.filter(row => values.includes(row[key]));
                    return query;
                },
                async range(from, to) {
                    requests.push({table, queryString});
                    if (queryString.length > 8000) return {error: {message: '414 URI Too Long'}};
                    return {data: rows.slice(from, Math.min(to + 1, from + 37))};
                }
            };
            return query;
        }
    };
}

function kidsFixture(db) {
    const elements = new Map();
    const notifications = [];
    let exported;
    const document = {getElementById(id) {
        if (!elements.has(id)) elements.set(id, {value: '', textContent: '0', innerHTML: ''});
        return elements.get(id);
    }};
    const context = {
        document, console: {error() {}},
        window: {supabaseBalcao: db, showNotification: (...args) => notifications.push(args)},
        XLSX: {utils: {
            book_new: () => ({}), json_to_sheet: rows => rows,
            book_append_sheet: (_, rows) => {exported = rows;}
        }, writeFile() {}}
    };
    vm.runInNewContext(read('kids.js'), context);
    return {api: context.window.KidsModule, el: document.getElementById, notifications, exported: () => exported};
}

test('Kids: relatório com 741 UUIDs preenche totais, formas, detalhes e exportação', async () => {
    const db = backend();
    const {api, el, notifications, exported} = kidsFixture(db);
    await api.updateDashboard();
    assert.deepEqual(notifications, []);
    assert.equal(el('kids-dash-total-inscricoes').textContent, 741);
    assert.equal(el('kids-dash-pagos-completo').textContent, 635);
    assert.equal(el('kids-dash-pre-inscricoes').textContent, 106);
    assert.equal(el('kids-total-arrecadado').textContent, 'R$ 169350,00');
    assert.match(el('kids-dash-valor-pix').innerHTML, />741<\/div>/);
    assert.match(el('kids-inscricoes-tbody').innerHTML, /Pessoa 740/);
    await api.exportFiltrado();
    assert.equal(exported().length, 741);
    assert.equal(exported().reduce((sum, row) => sum + row.Valor_Pago, 0), 169350);
    assert(db.requests.every(r => r.queryString.length < 8000));
});

test('Kids: filtro por status mantém os mesmos pagamentos na tela e na exportação', async () => {
    const {api, el, exported} = kidsFixture(backend());
    el('kids-filter-status-dash').value = 'PAGO PARCIALMENTE';
    await api.updateDashboard();
    assert.equal(el('kids-dash-total-inscricoes').textContent, 106);
    assert.equal(el('kids-dash-pagos-completo').textContent, 0);
    assert.equal(el('kids-total-arrecadado').textContent, 'R$ 10600,00');
    await api.exportFiltrado();
    assert.equal(exported().length, 106);
    assert.equal(exported().reduce((sum, row) => sum + row.Valor_Pago, 0), 10600);
});

test('Retiro principal: consulta de status também respeita o limite HTTP com 741 UUIDs', async () => {
    const source = read('app.js');
    const functions = ['fetchAllRows', 'fetchParticipantsStatus'].map(name =>
        source.match(new RegExp(`^ {8}async function ${name}\\([^\\n]*?\\) \\{[\\s\\S]*?^ {8}\\}`, 'm'))[0]
    ).join('\n');
    const context = {supabase: backend()};
    vm.runInNewContext(`const PARTICIPANT_CHUNK_SIZE = 1000; ${functions}; globalThis.fetchStatus = fetchParticipantsStatus;`, context);
    const rows = await context.fetchStatus([...participants.map(p => p.id), participants[0].id, null]);
    assert.equal(rows.length, 741);
    assert.equal(new Set(rows.map(p => p.id)).size, 741);
});
