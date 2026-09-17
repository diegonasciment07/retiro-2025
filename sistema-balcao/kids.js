// ==========================================================
// RETIRO KIDS — Acampa Kids & Brothers Camp
// ==========================================================
// Módulo independente carregado junto com app.js na mesma página
// (sistema-balcao/index.html). Reaproveita o client Supabase e os
// helpers já autenticados de app.js via window.supabaseBalcao /
// window.getCurrentUserBalcao / etc. (ver bloco "PONTE PARA MÓDULOS
// EXTERNOS" no final do app.js) em vez de criar um segundo client
// Supabase — dois clients apontando pro mesmo projeto disputariam o
// mesmo localStorage de sessão.
//
// Tudo que precisa ser chamado via onclick="" no HTML fica pendurado
// em window.KidsModule, pra não poluir o escopo global com dezenas
// de nomes soltos.
// ==========================================================

(function () {
    'use strict';

    const VALORES = {
        ACAMPA_KIDS: 250,
        BROTHERS_CAMP: 300,
        TRABALHO: 100
    };

    let allKids = [];
    let allTeams = [];
    let currentKid = null;
    let currentTeamsTipoEvento = 'ACAMPA_KIDS';
    let initialized = false;

    // ── Helpers que dependem do app.js ────────────────────────
    function sb() { return window.supabaseBalcao; }
    function notify(msg, type) { return window.showNotification ? window.showNotification(msg, type) : console.log(msg); }
    function fmtMoeda(v) { return window.formatCurrency ? window.formatCurrency(v) : `R$ ${v}`; }
    function fmtData(v) { return window.formatDateTime ? window.formatDateTime(v) : v; }
    function localTime(v) { return window.convertToLocalTime ? window.convertToLocalTime(v) : new Date(v); }
    function isAdm() { return window.isCurrentUserAdm ? window.isCurrentUserAdm() : false; }
    function atendenteAtual() {
        const u = window.getCurrentUserBalcao ? window.getCurrentUserBalcao() : null;
        return u ? u.email.split('@')[0] : 'Sistema';
    }

    // ── Helpers de negócio ─────────────────────────────────────
    function getValorEsperado(kid) {
        if (kid.funcao === 'TRABALHO') return VALORES.TRABALHO;
        return VALORES[kid.tipo_evento] || 0;
    }

    function getStatusClass(status) {
        switch (status) {
            case 'PAGO': return 'success';
            case 'PAGO PARCIALMENTE': return 'warning';
            case 'PENDENTE': return 'danger';
            default: return 'secondary';
        }
    }

    function getStatusText(status) {
        switch (status) {
            case 'PAGO': return 'Pago 100%';
            case 'PAGO PARCIALMENTE': return 'Pago Parcialmente';
            case 'PENDENTE': return 'Pendente';
            default: return status || 'N/A';
        }
    }

    function tipoEventoLabel(tipo) {
        return tipo === 'ACAMPA_KIDS' ? '👧🏻 Acampa Kids' : tipo === 'BROTHERS_CAMP' ? '👦🏻 Brothers Camp' : tipo;
    }

    function funcaoLabel(funcao) {
        return funcao === 'TRABALHO' ? '🤝 Trabalho' : '🎯 Participante';
    }

    function nomeEquipe(equipeId) {
        if (!equipeId) return null;
        const equipe = allTeams.find(t => t.id === equipeId);
        return equipe ? equipe.nome_time : null;
    }

    // ==========================================================
    // CARREGAMENTO DE DADOS
    // ==========================================================
    async function loadKids() {
        const { data, error } = await sb()
            .from('inscricoes_kids')
            .select('*')
            .eq('status', 'ATIVO')
            .order('criado_em', { ascending: false });

        if (error) { console.error('Erro ao carregar inscrições kids:', error); notify('Erro ao carregar inscrições: ' + error.message, 'error'); return; }
        allKids = data || [];
    }

    async function loadTeams() {
        const { data, error } = await sb()
            .from('equipes_kids')
            .select('*')
            .order('tipo_evento', { ascending: true })
            .order('criado_em', { ascending: true });

        if (error) { console.error('Erro ao carregar equipes:', error); notify('Erro ao carregar equipes: ' + error.message, 'error'); return; }
        allTeams = data || [];
    }

    async function onTabShown() {
        await Promise.all([loadKids(), loadTeams()]);
        renderStats();
        searchKids();
    }

    async function refreshAll() {
        await Promise.all([loadKids(), loadTeams()]);
        renderStats();
        searchKids();
    }

    // ==========================================================
    // PAINEL DE ESTATÍSTICAS
    // ==========================================================
    function renderStats() {
        const ativos = allKids;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        set('kids-total-acampa', ativos.filter(k => k.tipo_evento === 'ACAMPA_KIDS').length);
        set('kids-total-brothers', ativos.filter(k => k.tipo_evento === 'BROTHERS_CAMP').length);
        set('kids-total-geral', ativos.length);
        set('kids-total-pagos', ativos.filter(k => k.status_pagamento === 'PAGO').length);
        set('kids-total-pendentes', ativos.filter(k => k.status_pagamento !== 'PAGO').length);
        set('kids-total-sem-equipe', ativos.filter(k => k.funcao === 'PARTICIPANTE' && !k.equipe_id).length);
    }

    // ==========================================================
    // BUSCA / LISTAGEM
    // ==========================================================
    function searchKids() {
        const termoEl = document.getElementById('kids-search-termo');
        const tipoEl = document.getElementById('kids-filter-tipo');
        const statusEl = document.getElementById('kids-filter-status');

        const termo = termoEl ? termoEl.value.trim().toUpperCase() : '';
        const tipo = tipoEl ? tipoEl.value : '';
        const status = statusEl ? statusEl.value : '';

        let resultado = allKids;

        if (termo) {
            resultado = resultado.filter(k =>
                (k.nome_crianca || '').toUpperCase().includes(termo) ||
                (k.responsavel_nome || '').toUpperCase().includes(termo) ||
                (k.responsavel_whatsapp || '').includes(termo)
            );
        }
        if (tipo) resultado = resultado.filter(k => k.tipo_evento === tipo);
        if (status) resultado = resultado.filter(k => k.status_pagamento === status);

        renderKidsList(resultado);
    }

    function renderKidsList(kids) {
        const container = document.getElementById('kids-results');
        if (!container) return;

        if (kids.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Nenhum resultado encontrado</div>';
            return;
        }

        container.innerHTML = kids.map(kid => {
            const statusClass = getStatusClass(kid.status_pagamento);
            const statusText = getStatusText(kid.status_pagamento);
            const equipe = nomeEquipe(kid.equipe_id);

            return `
                <div class="person-card" onclick="KidsModule.showDetails('${kid.id}')">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 8px; flex-wrap: wrap;">
                        <h3 style="color: var(--primary); margin: 0;">${kid.nome_crianca || 'Nome não informado'}</h3>
                        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            <span class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.72em;">${tipoEventoLabel(kid.tipo_evento)}</span>
                            <span class="btn btn-${statusClass}" style="padding: 5px 10px; font-size: 0.8em;">${statusText}</span>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9em; color: var(--text-light);">
                        <div><strong>🎂 Idade:</strong> ${kid.idade ?? 'N/A'} anos</div>
                        <div><strong>${kid.sexo === 'FEMININO' ? '👧' : '👦'} Sexo:</strong> ${kid.sexo || 'N/A'}</div>
                        <div><strong>${funcaoLabel(kid.funcao)}</strong></div>
                        <div><strong>🏆 Equipe:</strong> ${equipe || (kid.funcao === 'PARTICIPANTE' ? 'Sem equipe' : '—')}</div>
                        <div><strong>👪 Responsável:</strong> ${kid.responsavel_nome || 'N/A'}</div>
                        <div><strong>📱 WhatsApp:</strong> ${kid.responsavel_whatsapp || 'N/A'}</div>
                        <div><strong>💰 Valor Pago:</strong> ${fmtMoeda(kid.valor_pago)}</div>
                        <div><strong>🎯 Total:</strong> ${fmtMoeda(getValorEsperado(kid))}</div>
                    </div>

                    <div style="margin-top: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <button onclick="event.stopPropagation(); KidsModule.openPaymentsModal('${kid.id}')" class="btn btn-success" style="padding: 8px; font-size: 0.8em;">
                            💰 Pagamentos
                        </button>
                        <button onclick="event.stopPropagation(); KidsModule.showDetails('${kid.id}')" class="btn btn-info" style="padding: 8px; font-size: 0.8em;">
                            📋 Detalhes
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==========================================================
    // PAGAMENTOS (mesmo modelo do retiro principal: parcelado)
    // ==========================================================
    async function openPaymentsModal(kidId) {
        currentKid = allKids.find(k => k.id === kidId);
        if (!currentKid) { notify('Participante não encontrado', 'error'); return; }

        document.getElementById('kids-payments-nome').textContent = currentKid.nome_crianca;
        document.getElementById('kids-payments-status').textContent = getStatusText(currentKid.status_pagamento);
        document.getElementById('kids-payments-total').textContent = fmtMoeda(getValorEsperado(currentKid));
        document.getElementById('kids-new-payment-value').value = '';
        document.getElementById('kids-new-payment-method').value = '';
        document.getElementById('kids-new-payment-obs').value = '';

        await loadPaymentHistory(kidId);

        document.getElementById('kids-payments-modal').style.display = 'flex';
    }

    function closePaymentsModal() {
        document.getElementById('kids-payments-modal').style.display = 'none';
        currentKid = null;
    }

    async function loadPaymentHistory(kidId) {
        const { data, error } = await sb()
            .from('pagamentos_kids')
            .select('*')
            .eq('inscricao_id', kidId)
            .order('criado_em', { ascending: false });

        if (error) { notify('Erro ao carregar histórico: ' + error.message, 'error'); return; }

        const payments = data || [];
        displayPaymentHistory(payments);

        const totalPago = payments.reduce((sum, p) => sum + parseFloat(p.valor_pago), 0);
        const esperado = getValorEsperado(currentKid);
        document.getElementById('kids-total-paid').textContent = fmtMoeda(totalPago);
        document.getElementById('kids-remaining-amount').textContent = fmtMoeda(Math.max(0, esperado - totalPago));
    }

    function displayPaymentHistory(payments) {
        const container = document.getElementById('kids-payments-history');
        if (!container) return;

        if (payments.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Nenhum pagamento registrado</div>';
            return;
        }

        container.innerHTML = payments.map(payment => `
            <div style="border: 1px solid #333; border-radius: 8px; padding: 15px; margin-bottom: 10px; background: #222;">
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; align-items: center;">
                    <div id="kids-payment-valor-${payment.id}">
                        <strong style="color: var(--primary);">${fmtMoeda(payment.valor_pago)}</strong>
                    </div>
                    <div>
                        <span class="btn btn-info" style="padding: 4px 8px; font-size: 0.7em;">${payment.forma_pagamento}</span>
                    </div>
                    <div style="font-size: 0.8em; color: #ccc;">
                        ${fmtData(localTime(payment.data_pagamento))}
                    </div>
                    <div id="kids-payment-actions-${payment.id}" style="text-align: right; display: flex; gap: 6px; justify-content: flex-end;">
                        ${isAdm() ? `
                            <button onclick="KidsModule.startEditPayment(${payment.id}, '${payment.valor_pago}')" class="btn btn-info" style="padding: 4px 8px; font-size: 0.7em;" title="Editar valor (mantém a data original)">✏️</button>
                            <button onclick="KidsModule.deletePayment(${payment.id})" class="btn btn-danger" style="padding: 4px 8px; font-size: 0.7em;">🗑️</button>
                        ` : `<span style="font-size: 0.7em; color: #666;">🔒 Somente ADM</span>`}
                    </div>
                </div>
                ${payment.observacoes ? `<div style="margin-top: 8px; font-size: 0.8em; color: #999;">📝 ${payment.observacoes}</div>` : ''}
                <div style="margin-top: 5px; font-size: 0.7em; color: #666;">Atendente: ${payment.atendente || 'N/A'}</div>
            </div>
        `).join('');
    }

    // Recalcula status_pagamento/valor_pago da inscrição a partir da soma real
    // dos pagamentos — mesmo princípio do forceSyncInscricaoWithHistory do
    // retiro principal, só que com o valor esperado variável (250/300/100).
    async function forceSync(kidId) {
        const kid = allKids.find(k => k.id === kidId) || currentKid;
        if (!kid) return;

        const { data: payments, error } = await sb()
            .from('pagamentos_kids')
            .select('*')
            .eq('inscricao_id', kidId);

        if (error) throw error;

        const totalPago = (payments || []).reduce((sum, p) => sum + (parseFloat(p.valor_pago) || 0), 0);
        const esperado = getValorEsperado(kid);

        let novoStatus;
        if (totalPago >= esperado && esperado > 0) novoStatus = 'PAGO';
        else if (totalPago > 0) novoStatus = 'PAGO PARCIALMENTE';
        else novoStatus = 'PENDENTE';

        const formas = [...new Set((payments || []).map(p => p.forma_pagamento))];
        const novaForma = formas.length > 1 ? 'MÚLTIPLAS FORMAS' : (formas[0] || null);

        let dataConfirmacao = null;
        if (totalPago > 0) {
            const ordenados = (payments || []).slice().sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
            dataConfirmacao = ordenados.length ? (ordenados[0].criado_em || new Date().toISOString()) : new Date().toISOString();
        }

        const { error: updateError } = await sb()
            .from('inscricoes_kids')
            .update({
                status_pagamento: novoStatus,
                valor_pago: totalPago.toFixed(2).replace('.', ','),
                forma_pagamento: novaForma,
                data_confirmacao_pagamento: dataConfirmacao,
                atendente: atendenteAtual(),
                data_ultima_atualizacao: new Date().toISOString()
            })
            .eq('id', kidId);

        if (updateError) throw updateError;
    }

    async function addNewPayment() {
        if (!currentKid) return;

        const valueEl = document.getElementById('kids-new-payment-value');
        const methodEl = document.getElementById('kids-new-payment-method');
        const obsEl = document.getElementById('kids-new-payment-obs');

        const value = valueEl.value.trim();
        const method = methodEl.value;
        const obs = obsEl.value.trim();

        if (!value || !method) { notify('Preencha valor e forma de pagamento', 'error'); return; }

        const numericValue = parseFloat(value.replace(',', '.'));
        if (isNaN(numericValue) || numericValue <= 0) { notify('Valor inválido', 'error'); return; }

        const esperado = getValorEsperado(currentKid);

        try {
            const { data: pagamentosExistentes } = await sb()
                .from('pagamentos_kids')
                .select('valor_pago')
                .eq('inscricao_id', currentKid.id);

            const totalRealPago = (pagamentosExistentes || []).reduce((sum, p) => sum + parseFloat(p.valor_pago), 0);

            if (totalRealPago + numericValue > esperado) {
                const maxPermitido = Math.max(0, esperado - totalRealPago);
                alert(`❌ ATENÇÃO!\n\nEsse pagamento excederia o valor total de ${fmtMoeda(esperado)}\n\nTotal já pago: ${fmtMoeda(totalRealPago)}\nMáximo permitido agora: ${fmtMoeda(maxPermitido)}`);
                valueEl.value = maxPermitido > 0 ? maxPermitido.toFixed(2).replace('.', ',') : '0,00';
                return;
            }

            const { error: insertError } = await sb()
                .from('pagamentos_kids')
                .insert({
                    inscricao_id: currentKid.id,
                    nome_participante: currentKid.nome_crianca,
                    valor_pago: numericValue,
                    forma_pagamento: method,
                    atendente: atendenteAtual(),
                    observacoes: obs || null
                });

            if (insertError) throw insertError;

            await forceSync(currentKid.id);
            await loadKids();
            currentKid = allKids.find(k => k.id === currentKid.id);
            await loadPaymentHistory(currentKid.id);
            renderStats();
            searchKids();

            notify('Pagamento adicionado com sucesso!', 'success');

            valueEl.value = '';
            methodEl.value = '';
            obsEl.value = '';

        } catch (error) {
            console.error('Erro ao adicionar pagamento:', error);
            notify('Erro ao adicionar pagamento: ' + error.message, 'error');
        }
    }

    async function deletePayment(paymentId) {
        if (!isAdm()) { notify('Apenas administradores podem excluir um pagamento.', 'error'); return; }
        if (!confirm('Tem certeza que deseja excluir este pagamento?')) return;

        try {
            const { error } = await sb().from('pagamentos_kids').delete().eq('id', paymentId);
            if (error) throw error;

            await forceSync(currentKid.id);
            await loadKids();
            currentKid = allKids.find(k => k.id === currentKid.id);
            await loadPaymentHistory(currentKid.id);
            renderStats();
            searchKids();

            notify('Pagamento excluído com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao excluir pagamento:', error);
            notify('Erro ao excluir pagamento: ' + error.message, 'error');
        }
    }

    function startEditPayment(paymentId, valorAtual) {
        if (!isAdm()) { notify('Apenas administradores podem editar o valor de um pagamento.', 'error'); return; }

        const valorCell = document.getElementById(`kids-payment-valor-${paymentId}`);
        const actionsCell = document.getElementById(`kids-payment-actions-${paymentId}`);
        if (!valorCell || !actionsCell) return;

        const valorFormatado = parseFloat(String(valorAtual).replace(',', '.')).toFixed(2).replace('.', ',');

        valorCell.innerHTML = `<input type="text" id="kids-edit-payment-input-${paymentId}" class="input" style="width: 100px; padding: 5px 8px; font-size: 0.9em;" value="${valorFormatado}">`;
        actionsCell.innerHTML = `
            <button onclick="KidsModule.saveEditPayment(${paymentId})" class="btn btn-success" style="padding: 4px 8px; font-size: 0.7em;">✅ Salvar</button>
            <button onclick="KidsModule.loadPaymentHistory('${currentKid.id}')" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.7em;">❌</button>
        `;

        const input = document.getElementById(`kids-edit-payment-input-${paymentId}`);
        input.focus();
        input.select();
    }

    async function saveEditPayment(paymentId) {
        if (!isAdm()) { notify('Apenas administradores podem editar o valor de um pagamento.', 'error'); return; }

        const input = document.getElementById(`kids-edit-payment-input-${paymentId}`);
        if (!input) return;

        const novoValor = parseFloat(input.value.trim().replace(',', '.'));
        if (isNaN(novoValor) || novoValor <= 0) { notify('Valor inválido', 'error'); return; }

        const esperado = getValorEsperado(currentKid);

        try {
            const { data: outrosPagamentos, error: fetchError } = await sb()
                .from('pagamentos_kids')
                .select('id, valor_pago')
                .eq('inscricao_id', currentKid.id);

            if (fetchError) throw fetchError;

            const totalOutros = (outrosPagamentos || [])
                .filter(p => p.id !== paymentId)
                .reduce((sum, p) => sum + parseFloat(p.valor_pago), 0);

            if (totalOutros + novoValor > esperado) {
                const maxPermitido = Math.max(0, esperado - totalOutros);
                alert(`❌ ATENÇÃO!\n\nEsse valor excederia o total de ${fmtMoeda(esperado)}\n\nTotal dos outros pagamentos: ${fmtMoeda(totalOutros)}\nMáximo permitido para este pagamento: ${fmtMoeda(maxPermitido)}`);
                return;
            }

            const { error: updateError } = await sb()
                .from('pagamentos_kids')
                .update({ valor_pago: novoValor })
                .eq('id', paymentId);

            if (updateError) throw updateError;

            await forceSync(currentKid.id);
            await loadKids();
            currentKid = allKids.find(k => k.id === currentKid.id);
            await loadPaymentHistory(currentKid.id);
            renderStats();
            searchKids();

            notify('Valor do pagamento atualizado com sucesso!', 'success');

        } catch (error) {
            console.error('Erro ao editar pagamento:', error);
            notify('Erro ao editar pagamento: ' + error.message, 'error');
        }
    }

    // ==========================================================
    // DETALHES / EDIÇÃO DO CADASTRO
    // ==========================================================
    function showDetails(kidId) {
        const kid = allKids.find(k => k.id === kidId);
        if (!kid) { notify('Participante não encontrado', 'error'); return; }
        currentKid = kid;

        const teamsDoEvento = allTeams.filter(t => t.tipo_evento === kid.tipo_evento);
        const showDelete = isAdm();

        const content = `
            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">👶 Dados da Criança/Adolescente</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Nome:</label>
                        <input type="text" class="input" value="${kid.nome_crianca || ''}" onblur="KidsModule.updateField('${kid.id}', 'nome_crianca', this.value)">
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Evento / Função:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${tipoEventoLabel(kid.tipo_evento)} — ${funcaoLabel(kid.funcao)}</div>
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Sexo:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${kid.sexo || 'N/A'}</div>
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Idade:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${kid.idade ?? 'N/A'} anos</div>
                    </div>
                </div>
                <div style="font-size: 0.8em; color: #666; margin-top: 8px;">Sexo, idade e tipo de evento não são editáveis aqui (afetam o balanceamento das equipes). Para corrigir, cancele e refaça a inscrição.</div>
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">👪 Responsável</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Nome do Responsável:</label>
                        <input type="text" class="input" value="${kid.responsavel_nome || ''}" onblur="KidsModule.updateField('${kid.id}', 'responsavel_nome', this.value)">
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Parentesco:</label>
                        <input type="text" class="input" value="${kid.responsavel_parentesco || ''}" onblur="KidsModule.updateField('${kid.id}', 'responsavel_parentesco', this.value)">
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">WhatsApp:</label>
                        <input type="text" class="input" value="${kid.responsavel_whatsapp || ''}" onblur="KidsModule.updateField('${kid.id}', 'responsavel_whatsapp', this.value)">
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Cidade:</label>
                        <input type="text" class="input" value="${kid.cidade || ''}" onblur="KidsModule.updateField('${kid.id}', 'cidade', this.value)">
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">🏥 Saúde</h4>
                <textarea class="input" style="min-height: 70px;" onblur="KidsModule.updateField('${kid.id}', 'observacoes_saude', this.value)">${kid.observacoes_saude || ''}</textarea>
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">🏆 Equipe</h4>
                ${kid.funcao !== 'PARTICIPANTE' ? `<div style="color: var(--text-light);">Equipe de trabalho não compete em times.</div>` : `
                    <select class="input" onchange="KidsModule.moveTeam('${kid.id}', this.value)">
                        <option value="">Sem equipe</option>
                        ${teamsDoEvento.map(t => `<option value="${t.id}" ${t.id === kid.equipe_id ? 'selected' : ''}>${t.nome_time}</option>`).join('')}
                    </select>
                `}
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">💰 Pagamento</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Status:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${getStatusText(kid.status_pagamento)}</div>
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Valor Pago / Total:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${fmtMoeda(kid.valor_pago)} / ${fmtMoeda(getValorEsperado(kid))}</div>
                    </div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: ${showDelete ? '1fr 1fr' : '1fr'}; gap: 10px; margin-top: 20px;">
                <button onclick="KidsModule.openPaymentsModal('${kid.id}')" class="btn btn-success">💰 Gerenciar Pagamentos</button>
                ${showDelete ? `<button onclick="KidsModule.cancelKid('${kid.id}')" class="btn btn-danger">🗑️ Cancelar Inscrição</button>` : ''}
            </div>
        `;

        document.getElementById('kids-details-content').innerHTML = content;
        document.getElementById('kids-details-modal').style.display = 'flex';
    }

    function closeDetailsModal() {
        document.getElementById('kids-details-modal').style.display = 'none';
    }

    async function updateField(kidId, field, value) {
        const finalValue = typeof value === 'string' ? value.toUpperCase() : value;
        try {
            const { error } = await sb()
                .from('inscricoes_kids')
                .update({ [field]: finalValue, data_ultima_atualizacao: new Date().toISOString() })
                .eq('id', kidId);
            if (error) throw error;

            const kid = allKids.find(k => k.id === kidId);
            if (kid) kid[field] = finalValue;

            notify('Atualizado!', 'success');
            searchKids();
        } catch (error) {
            console.error(`Erro ao atualizar ${field}:`, error);
            notify(`Erro ao atualizar: ` + error.message, 'error');
        }
    }

    async function moveTeam(kidId, novaEquipeId) {
        try {
            const { error } = await sb()
                .from('inscricoes_kids')
                .update({ equipe_id: novaEquipeId || null, data_ultima_atualizacao: new Date().toISOString() })
                .eq('id', kidId);
            if (error) throw error;

            const kid = allKids.find(k => k.id === kidId);
            if (kid) kid.equipe_id = novaEquipeId || null;

            notify('Equipe atualizada!', 'success');
            searchKids();
        } catch (error) {
            console.error('Erro ao mover de equipe:', error);
            notify('Erro ao mover de equipe: ' + error.message, 'error');
        }
    }

    async function cancelKid(kidId) {
        if (!isAdm()) { notify('Apenas administradores podem cancelar uma inscrição.', 'error'); return; }
        if (!confirm('Tem certeza que deseja CANCELAR esta inscrição?')) return;

        try {
            const { error } = await sb().from('inscricoes_kids').update({ status: 'CANCELADO' }).eq('id', kidId);
            if (error) throw error;

            allKids = allKids.filter(k => k.id !== kidId);
            closeDetailsModal();
            renderStats();
            searchKids();
            notify('Inscrição cancelada com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao cancelar:', error);
            notify('Erro ao cancelar inscrição: ' + error.message, 'error');
        }
    }

    // ==========================================================
    // GERENCIAR EQUIPES
    // ==========================================================
    function openTeamsModal() {
        document.getElementById('kids-teams-modal').style.display = 'flex';
        renderTeamsTabs();
        renderTeamsList();
    }

    function closeTeamsModal() {
        document.getElementById('kids-teams-modal').style.display = 'none';
    }

    function renderTeamsTabs() {
        document.getElementById('kids-teams-tab-acampa').classList.toggle('active', currentTeamsTipoEvento === 'ACAMPA_KIDS');
        document.getElementById('kids-teams-tab-brothers').classList.toggle('active', currentTeamsTipoEvento === 'BROTHERS_CAMP');
    }

    function switchTeamsTipoEvento(tipo) {
        currentTeamsTipoEvento = tipo;
        renderTeamsTabs();
        renderTeamsList();
    }

    function rosterStats(equipeId) {
        const membros = allKids.filter(k => k.equipe_id === equipeId && k.funcao === 'PARTICIPANTE');
        const meninos = membros.filter(k => k.sexo === 'MASCULINO').length;
        const meninas = membros.filter(k => k.sexo === 'FEMININO').length;
        const idadeMedia = membros.length ? (membros.reduce((s, k) => s + (k.idade || 0), 0) / membros.length) : 0;
        return { membros, total: membros.length, meninos, meninas, idadeMedia };
    }

    function renderTeamsList() {
        const container = document.getElementById('kids-teams-list');
        if (!container) return;

        const teams = allTeams.filter(t => t.tipo_evento === currentTeamsTipoEvento);
        const pendentes = allKids.filter(k => k.tipo_evento === currentTeamsTipoEvento && k.funcao === 'PARTICIPANTE' && !k.equipe_id).length;

        document.getElementById('kids-teams-pendentes-info').textContent =
            pendentes > 0 ? `⚠️ ${pendentes} participante(s) ainda sem equipe.` : '✅ Todo mundo já está em uma equipe.';

        if (teams.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">Nenhuma equipe criada ainda para este evento.</div>';
            return;
        }

        container.innerHTML = teams.map(team => {
            const stats = rosterStats(team.id);
            return `
                <div style="border: 1px solid #333; border-radius: 8px; padding: 15px; margin-bottom: 12px; background: #1a1a1a;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <strong style="color: var(--primary); font-size: 1.1em;">${team.cor ? team.cor + ' ' : ''}${team.nome_time}</strong>
                            <div style="font-size: 0.8em; color: var(--text-light); margin-top: 2px;">👨‍🏫 ${team.professores_responsaveis || 'Sem professor definido'}</div>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button onclick="KidsModule.toggleRoster('${team.id}')" class="btn btn-info" style="padding: 5px 10px; font-size: 0.75em;" id="kids-roster-toggle-${team.id}">Ver lista</button>
                            ${isAdm() ? `<button onclick="KidsModule.deleteTeam('${team.id}')" class="btn btn-danger" style="padding: 5px 10px; font-size: 0.75em;">🗑️</button>` : ''}
                        </div>
                    </div>
                    <div style="display: flex; gap: 14px; margin-top: 10px; font-size: 0.85em; color: var(--text-light); flex-wrap: wrap;">
                        <span>👥 Total: <strong>${stats.total}</strong></span>
                        <span>👦 Meninos: <strong>${stats.meninos}</strong></span>
                        <span>👧 Meninas: <strong>${stats.meninas}</strong></span>
                        <span>🎂 Idade média: <strong>${stats.idadeMedia ? stats.idadeMedia.toFixed(1) : '—'}</strong></span>
                    </div>
                    <div id="kids-roster-${team.id}" style="display: none; margin-top: 12px; border-top: 1px solid #333; padding-top: 10px;">
                        ${stats.membros.length === 0
                            ? '<div style="color: #666; font-size: 0.85em;">Nenhum participante ainda.</div>'
                            : stats.membros.map(m => `
                                <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.85em; border-bottom: 1px solid #262626;">
                                    <span>${m.sexo === 'FEMININO' ? '👧' : '👦'} ${m.nome_crianca} (${m.idade} anos)</span>
                                    <span class="btn btn-${getStatusClass(m.status_pagamento)}" style="padding: 2px 8px; font-size: 0.72em;">${getStatusText(m.status_pagamento)}</span>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            `;
        }).join('');
    }

    function toggleRoster(teamId) {
        const el = document.getElementById(`kids-roster-${teamId}`);
        const btn = document.getElementById(`kids-roster-toggle-${teamId}`);
        if (!el) return;
        const abrindo = el.style.display === 'none';
        el.style.display = abrindo ? 'block' : 'none';
        if (btn) btn.textContent = abrindo ? 'Ocultar lista' : 'Ver lista';
    }

    async function createTeam() {
        const nomeEl = document.getElementById('kids-new-team-nome');
        const profEl = document.getElementById('kids-new-team-professores');
        const corEl = document.getElementById('kids-new-team-cor');

        const nome = nomeEl.value.trim();
        const professores = profEl.value.trim();
        const cor = corEl.value.trim();

        if (!nome) { notify('Informe o nome do time', 'error'); return; }

        try {
            const { error } = await sb()
                .from('equipes_kids')
                .insert({
                    tipo_evento: currentTeamsTipoEvento,
                    nome_time: nome,
                    professores_responsaveis: professores || null,
                    cor: cor || null,
                    criado_por: atendenteAtual()
                });

            if (error) throw error;

            nomeEl.value = '';
            profEl.value = '';
            corEl.value = '';

            await loadTeams();
            renderTeamsList();
            notify('Equipe criada com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao criar equipe:', error);
            notify('Erro ao criar equipe: ' + error.message, 'error');
        }
    }

    async function deleteTeam(teamId) {
        if (!isAdm()) { notify('Apenas administradores podem excluir uma equipe.', 'error'); return; }

        const stats = rosterStats(teamId);
        if (stats.total > 0) {
            alert(`❌ Essa equipe ainda tem ${stats.total} participante(s). Mova todos pra outra equipe antes de excluir.`);
            return;
        }

        if (!confirm('Tem certeza que deseja excluir esta equipe?')) return;

        try {
            const { error } = await sb().from('equipes_kids').delete().eq('id', teamId);
            if (error) throw error;

            await loadTeams();
            renderTeamsList();
            notify('Equipe excluída.', 'success');
        } catch (error) {
            console.error('Erro ao excluir equipe:', error);
            notify('Erro ao excluir equipe: ' + error.message, 'error');
        }
    }

    // Varre quem ficou sem equipe (porque se inscreveu antes de qualquer time
    // existir) e atribui um a um, na ordem de inscrição — cada chamada já
    // recalcula o balanceamento com o estado mais atual (via kids_atribuir_uma).
    async function atribuirPendentes() {
        const pendentes = allKids
            .filter(k => k.tipo_evento === currentTeamsTipoEvento && k.funcao === 'PARTICIPANTE' && !k.equipe_id)
            .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

        if (pendentes.length === 0) { notify('Não há pendentes para atribuir.', 'warning'); return; }

        const btn = document.getElementById('kids-atribuir-pendentes-btn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Atribuindo...'; }

        try {
            for (const kid of pendentes) {
                const { error } = await sb().rpc('kids_atribuir_uma', { p_inscricao_id: kid.id });
                if (error) throw error;
            }

            await loadKids();
            await loadTeams();
            renderTeamsList();
            renderStats();
            searchKids();

            notify(`${pendentes.length} participante(s) atribuído(s) às equipes!`, 'success');
        } catch (error) {
            console.error('Erro ao atribuir pendentes:', error);
            notify('Erro ao atribuir pendentes: ' + error.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🔀 Atribuir Pendentes'; }
        }
    }

    // ==========================================================
    // API PÚBLICA DO MÓDULO
    // ==========================================================
    window.KidsModule = {
        onTabShown,
        refreshAll,
        searchKids,
        openPaymentsModal,
        closePaymentsModal,
        loadPaymentHistory,
        addNewPayment,
        deletePayment,
        startEditPayment,
        saveEditPayment,
        showDetails,
        closeDetailsModal,
        updateField,
        moveTeam,
        cancelKid,
        openTeamsModal,
        closeTeamsModal,
        switchTeamsTipoEvento,
        toggleRoster,
        createTeam,
        deleteTeam,
        atribuirPendentes
    };
})();
