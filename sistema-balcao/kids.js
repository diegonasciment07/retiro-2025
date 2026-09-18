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

    // Entrada mínima pra virar PAGO PARCIALMENTE e — no caso de participante —
    // entrar no sorteio de equipe. Mesma ideia do retiro principal (lá é
    // R$150 dos R$550): aqui é R$100 pros dois eventos (Acampa Kids e
    // Brothers Camp).
    const VALOR_MINIMO_ENTRADA = 100;

    let allKids = [];
    let allTeams = [];
    let currentKid = null;
    let currentTeamsTipoEvento = 'ACAMPA_KIDS';
    let initialized = false;
    let expandedRosterIds = new Set();

    // ── Helpers que dependem do app.js ────────────────────────
    function sb() { return window.supabaseBalcao; }
    function notify(msg, type) { return window.showNotification ? window.showNotification(msg, type) : console.log(msg); }
    function fmtMoeda(v) { return window.formatCurrency ? window.formatCurrency(v) : `R$ ${v}`; }
    function fmtData(v) { return window.formatDateTime ? window.formatDateTime(v) : v; }
    function localTime(v) { return window.convertToLocalTime ? window.convertToLocalTime(v) : new Date(v); }
    function isAdm() { return window.isCurrentUserAdm ? window.isCurrentUserAdm() : false; }

    // Permissão exclusiva de "Gerenciar Equipes" — separada do ADM geral,
    // pra manter o sorteio dos times surpresa: só quem está nessa lista vê
    // nome de equipe (aqui ou em qualquer outro lugar do app) ou consegue
    // abrir/editar essa tela, mesmo sendo ADM geral (ex: karina/jayne/julia
    // NÃO estão aqui, então não veem mais nome de equipe em lugar nenhum).
    const TEAMS_ADMIN_EMAILS = ['adm@alvo.com', 'matheus@alvocuritiba.com.br'];

    function isTeamsAdmin() {
        const u = window.getCurrentUserBalcao ? window.getCurrentUserBalcao() : null;
        return !!(u && TEAMS_ADMIN_EMAILS.includes(u.email.toLowerCase()));
    }
    function atendenteAtual() {
        const u = window.getCurrentUserBalcao ? window.getCurrentUserBalcao() : null;
        return u ? u.email.split('@')[0] : 'Sistema';
    }

    // ── Helpers de negócio ─────────────────────────────────────
    function getValorEsperado(kid) {
        if (kid.funcao === 'TRABALHO') return VALORES.TRABALHO;
        return VALORES[kid.tipo_evento] || 0;
    }

    function valorPagoNumerico(kid) {
        const v = kid.valor_pago ? parseFloat(String(kid.valor_pago).replace(',', '.')) : 0;
        return isNaN(v) ? 0 : v;
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

    // Qual time a criança caiu é informação exclusiva do ADM (pra não vazar
    // pro atendente comum, que pode estar no balcão junto com o responsável).
    // Atendente comum só vê "🔒 Somente ADM"; quem não é participante (equipe
    // de trabalho) nunca tem equipe mesmo.
    function equipeInfoParaExibicao(kid) {
        if (kid.funcao !== 'PARTICIPANTE') return '—';
        if (!isTeamsAdmin()) return '🔒 Restrito';
        return nomeEquipe(kid.equipe_id) || 'Sem equipe';
    }

    // ==========================================================
    // CONTROLE DE ENTREGA DE PULSEIRA — mesma lógica/visual do retiro
    // principal (app.js): marcador de texto em "observacoes", só libera
    // marcar com pagamento 100%, chip com 3 estados.
    // ==========================================================
    const WRISTBAND_MARKER = 'PULSEIRA ENTREGUE';

    function isWristbandDelivered(kid) {
        return !!(kid.observacoes && kid.observacoes.includes(WRISTBAND_MARKER));
    }

    function getWristbandChipState(kid) {
        const fullyPaid = kid.status_pagamento === 'PAGO';
        const delivered = isWristbandDelivered(kid);

        if (!fullyPaid) {
            return {
                disabled: true,
                icon: '🎗️',
                label: 'Pulseira',
                title: 'Só é possível marcar a pulseira com pagamento 100%',
                border: 'rgba(255,255,255,0.2)',
                bg: 'rgba(255,255,255,0.05)',
                color: '#888',
                opacity: 0.6
            };
        }

        if (delivered) {
            return {
                disabled: false,
                icon: '🚩',
                label: 'Pulseira Entregue',
                title: 'Entregue — clique para desmarcar (uso em caso de engano)',
                border: '#22c55e',
                bg: 'rgba(34,197,94,0.18)',
                color: '#4ade80',
                opacity: 1
            };
        }

        return {
            disabled: false,
            icon: '👉',
            label: 'Marcar Pulseira',
            title: 'Clique para marcar a entrega da pulseira',
            border: '#8b5cf6',
            bg: 'rgba(139,92,246,0.18)',
            color: '#c4b5fd',
            opacity: 1
        };
    }

    function applyWristbandChip(btn, state) {
        btn.title = state.title;
        btn.disabled = state.disabled;
        btn.style.border = `1.5px solid ${state.border}`;
        btn.style.background = state.bg;
        btn.style.color = state.color;
        btn.style.opacity = state.opacity;
        btn.style.cursor = state.disabled ? 'not-allowed' : 'pointer';
        btn.innerHTML = `${state.icon} ${state.label}`;
    }

    async function toggleWristband(kidId) {
        const btn = document.getElementById(`kids-wristband-btn-${kidId}`);

        try {
            const { data: currentData, error: fetchError } = await sb()
                .from('inscricoes_kids')
                .select('observacoes, status_pagamento')
                .eq('id', kidId)
                .single();

            if (fetchError) throw fetchError;

            if (currentData.status_pagamento !== 'PAGO') {
                notify('Só é possível marcar a pulseira com pagamento 100%', 'error');
                return;
            }

            const jaEntregue = !!(currentData.observacoes && currentData.observacoes.includes(WRISTBAND_MARKER));

            if (jaEntregue && !confirm('Desmarcar a entrega da pulseira desse participante?')) return;

            if (btn) btn.disabled = true;

            let updatedObservations;
            if (jaEntregue) {
                updatedObservations = (currentData.observacoes || '')
                    .split(' | ')
                    .filter(linha => !linha.includes(WRISTBAND_MARKER))
                    .join(' | ') || null;
            } else {
                const timestamp = new Date().toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                });
                const novaNota = `[${timestamp}] 🎗️ ${WRISTBAND_MARKER} (${atendenteAtual()})`;
                updatedObservations = currentData.observacoes ? `${currentData.observacoes} | ${novaNota}` : novaNota;
            }

            const { error: updateError } = await sb()
                .from('inscricoes_kids')
                .update({ observacoes: updatedObservations, data_ultima_atualizacao: new Date().toISOString() })
                .eq('id', kidId);

            if (updateError) throw updateError;

            const kidLocal = allKids.find(k => k.id === kidId);
            if (kidLocal) kidLocal.observacoes = updatedObservations;

            if (btn) applyWristbandChip(btn, getWristbandChipState({ status_pagamento: 'PAGO', observacoes: updatedObservations }));

            notify(jaEntregue ? 'Pulseira desmarcada.' : '🎗️ Pulseira marcada como entregue!', 'success');

        } catch (error) {
            console.error('❌ Erro ao atualizar pulseira (kids):', error);
            notify('Erro ao atualizar pulseira: ' + error.message, 'error');
            if (btn) btn.disabled = false;
        }
    }

    // Wrapper usado pelo botão de pulseira dentro do modal de Detalhes:
    // reaproveita toggleWristband() e recarrega o modal com o novo estado.
    async function toggleWristbandFromDetails(kidId) {
        await toggleWristband(kidId);
        if (document.getElementById('kids-details-modal').style.display !== 'none') {
            showDetails(kidId);
        }
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
        const btnEquipes = document.getElementById('kids-gerenciar-equipes-btn');
        if (btnEquipes) btnEquipes.style.display = isTeamsAdmin() ? 'block' : 'none';

        const btnAdmReportWrap = document.getElementById('kids-adm-report-btn-wrap');
        if (btnAdmReportWrap) btnAdmReportWrap.style.display = isAdm() ? 'block' : 'none';

        await Promise.all([loadKids(), loadTeams()]);
        renderStats();
        searchKids();
    }

    async function refreshAll() {
        await Promise.all([loadKids(), loadTeams()]);
        renderStats();
        searchKids();
    }

    // Restringe a tela pro perfil TEAMS_ONLY_EMAILS (ver app.js): esconde
    // tudo dentro de #section-kids que não seja "Gerenciar Equipes" —
    // números/estatísticas, busca/resultados, Dashboard, Resumo e Check-in.
    // Relatório ADM já fica escondido sozinho (isAdm() é falso pra esse
    // perfil). Chamado pelo app.js logo após o login.
    function applyTeamsOnlyRestriction() {
        const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
        hide('kids-stats-grid');
        hide('kids-main-content');
        hide('kids-row-dash-resumo');
        hide('kids-row-checkin');
    }

    // Desfaz applyTeamsOnlyRestriction — usado no logout, pra não vazar a
    // tela restrita pro próximo login na mesma aba do navegador.
    function removeTeamsOnlyRestriction() {
        const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = ''; };
        show('kids-stats-grid');
        show('kids-main-content');
        show('kids-row-dash-resumo');
        show('kids-row-checkin');
    }

    // ==========================================================
    // PAINEL DE ESTATÍSTICAS
    // ==========================================================
    function renderStats() {
        const ativos = allKids;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        // Acampa Kids / Brothers Camp contam só CRIANÇAS (participante) —
        // equipe de trabalho tem contador próprio, separado.
        set('kids-total-acampa', ativos.filter(k => k.tipo_evento === 'ACAMPA_KIDS' && k.funcao === 'PARTICIPANTE').length);
        set('kids-total-brothers', ativos.filter(k => k.tipo_evento === 'BROTHERS_CAMP' && k.funcao === 'PARTICIPANTE').length);
        set('kids-total-trabalho', ativos.filter(k => k.funcao === 'TRABALHO').length);
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

    function renderKidCard(kid) {
        const statusClass = getStatusClass(kid.status_pagamento);
        const statusText = getStatusText(kid.status_pagamento);
        const equipeInfo = equipeInfoParaExibicao(kid);
        const wb = getWristbandChipState(kid);

        return `
            <div class="person-card" onclick="KidsModule.showDetails('${kid.id}')">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 8px; flex-wrap: wrap;">
                    <h3 style="color: var(--primary); margin: 0;">${kid.nome_crianca || 'Nome não informado'}</h3>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap;">
                        <button id="kids-wristband-btn-${kid.id}"
                            onclick="event.stopPropagation(); KidsModule.toggleWristband('${kid.id}')"
                            title="${wb.title}"
                            ${wb.disabled ? 'disabled' : ''}
                            style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; font-size: 0.72em; font-weight: 700; font-family: 'Inter', sans-serif; white-space: nowrap; border: 1.5px solid ${wb.border}; background: ${wb.bg}; color: ${wb.color}; opacity: ${wb.opacity}; cursor: ${wb.disabled ? 'not-allowed' : 'pointer'};">
                            ${wb.icon} ${wb.label}
                        </button>
                        <span class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.72em;">${tipoEventoLabel(kid.tipo_evento)}</span>
                        <span class="btn btn-${statusClass}" style="padding: 5px 10px; font-size: 0.8em;">${statusText}</span>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9em; color: var(--text-light);">
                    <div><strong>🎂 Idade:</strong> ${kid.idade ?? 'N/A'} anos</div>
                    <div><strong>${kid.sexo === 'FEMININO' ? '👧' : '👦'} Sexo:</strong> ${kid.sexo || 'N/A'}</div>
                    <div><strong>${funcaoLabel(kid.funcao)}</strong></div>
                    <div><strong>🏆 Equipe:</strong> ${equipeInfo}</div>
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
    }

    // Separa os resultados em 3 grupos: crianças do Acampa Kids, crianças do
    // Brothers Camp e equipe de trabalho (à parte, já que não é criança e não
    // compete em equipe) — cada grupo com seu próprio contador.
    function renderKidsList(kids) {
        const container = document.getElementById('kids-results');
        if (!container) return;

        if (kids.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Nenhum resultado encontrado</div>';
            return;
        }

        const acampaCriancas = kids.filter(k => k.tipo_evento === 'ACAMPA_KIDS' && k.funcao === 'PARTICIPANTE');
        const brothersCriancas = kids.filter(k => k.tipo_evento === 'BROTHERS_CAMP' && k.funcao === 'PARTICIPANTE');
        const trabalho = kids.filter(k => k.funcao === 'TRABALHO');

        const renderGrupo = (titulo, lista) => {
            if (lista.length === 0) return '';
            return `
                <div style="margin-bottom: 20px;">
                    <h3 style="color: var(--primary); font-size: 1.05em; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border);">
                        ${titulo} — ${lista.length}
                    </h3>
                    ${lista.map(renderKidCard).join('')}
                </div>
            `;
        };

        container.innerHTML =
            renderGrupo('👧🏻 ACAMPA KIDS (crianças)', acampaCriancas) +
            renderGrupo('👦🏻 BROTHERS CAMP (crianças)', brothersCriancas) +
            renderGrupo('🤝 EQUIPE DE TRABALHO', trabalho);
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
        else if (totalPago >= VALOR_MINIMO_ENTRADA) novoStatus = 'PAGO PARCIALMENTE';
        else novoStatus = 'PENDENTE';

        const formas = [...new Set((payments || []).map(p => p.forma_pagamento))];
        const novaForma = formas.length > 1 ? 'MÚLTIPLAS FORMAS' : (formas[0] || null);

        // Igual ao retiro principal: a data de confirmação é a do pagamento
        // que fez o total acumulado cruzar o valor mínimo de entrada, não a
        // do primeiro pagamento (podem ser diferentes se ninguém atingiu o
        // mínimo no primeiro repasse).
        let dataConfirmacao = null;
        if (totalPago >= VALOR_MINIMO_ENTRADA) {
            const ordenados = (payments || []).slice().sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
            let acumulado = 0;
            for (const pagamento of ordenados) {
                acumulado += parseFloat(pagamento.valor_pago) || 0;
                if (acumulado >= VALOR_MINIMO_ENTRADA) {
                    dataConfirmacao = pagamento.criado_em || new Date().toISOString();
                    break;
                }
            }
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

        // Só a partir daqui a criança entra no sorteio de equipe — igual ao
        // retiro, que também exige o valor mínimo de entrada antes de contar
        // como "confirmado". Equipe de trabalho nunca é sorteada (mesma
        // exclusão de sempre).
        //
        // Não checamos aqui se já tem equipe usando o cache local (allKids) —
        // de propósito. kids_atribuir_uma já faz esse no-op sozinho lendo o
        // dado mais atual direto do banco, e confiar no cache local pra
        // decidir se chama ou não a função é frágil (cache desatualizado —
        // ex: outro atendente mexeu na equipe em outra aba, ou uma limpeza
        // retroativa foi rodada direto no banco sem dar refresh na tela —
        // fazia o sorteio ser pulado silenciosamente, mesmo com o pagamento
        // mínimo batido).
        if (kid.funcao === 'PARTICIPANTE' && totalPago >= VALOR_MINIMO_ENTRADA) {
            const { error: atribuirError } = await sb().rpc('kids_atribuir_uma', { p_inscricao_id: kidId });
            if (atribuirError) {
                console.error('Erro ao atribuir equipe automaticamente:', atribuirError);
                notify('Pagamento salvo, mas houve um erro ao atribuir a equipe automaticamente: ' + atribuirError.message, 'error');
            }
        }
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
        const podeVerEquipe = isTeamsAdmin();
        const wbDetails = getWristbandChipState(kid);

        const campoTexto = (label, field, value) => `
            <div>
                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">${label}:</label>
                <input type="text" class="input" value="${(value || '').replace(/"/g, '&quot;')}" onblur="KidsModule.updateField('${kid.id}', '${field}', this.value)">
            </div>
        `;

        const content = `
            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">👶 Dados da Criança/Adolescente</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    ${campoTexto('Nome', 'nome_crianca', kid.nome_crianca)}
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Evento / Função:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${tipoEventoLabel(kid.tipo_evento)} — ${funcaoLabel(kid.funcao)}</div>
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Sexo:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${kid.sexo || 'N/A'}</div>
                    </div>
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Idade / Nascimento:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${kid.idade ?? 'N/A'} anos ${kid.data_nascimento ? '(' + kid.data_nascimento.split('-').reverse().join('/') + ')' : ''}</div>
                    </div>
                    ${campoTexto('Rede', 'rede', kid.rede)}
                    ${campoTexto('Igreja', 'igreja', kid.igreja)}
                </div>
                <div style="font-size: 0.8em; color: #666; margin-top: 8px;">Sexo, idade e tipo de evento não são editáveis aqui (afetam o balanceamento das equipes). Para corrigir, cancele e refaça a inscrição.</div>
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">👪 Responsável</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    ${campoTexto('Nome do Responsável', 'responsavel_nome', kid.responsavel_nome)}
                    ${campoTexto('Parentesco', 'responsavel_parentesco', kid.responsavel_parentesco)}
                    ${campoTexto('Telefone', 'responsavel_whatsapp', kid.responsavel_whatsapp)}
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Autorização de dados / imagem:</label>
                        <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">
                            ${kid.autorizacao_dados ? '✅' : '❌'} Dados &nbsp; ${kid.autorizacao_imagem ? '✅' : '❌'} Imagem
                        </div>
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">🏥 Saúde e Contexto</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    ${campoTexto('Contato de Emergência (Nome)', 'contato_emergencia_nome', kid.contato_emergencia_nome)}
                    ${campoTexto('Contato de Emergência (Telefone)', 'contato_emergencia_telefone', kid.contato_emergencia_telefone)}
                </div>
                <div style="margin-top: 15px;">
                    <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Restrição Alimentar / Alergias / Medicamentos / Necessidade Especial:</label>
                    <textarea class="input" style="min-height: 60px;" onblur="KidsModule.updateField('${kid.id}', 'observacoes_saude', this.value)">${kid.observacoes_saude || ''}</textarea>
                </div>
                <div style="margin-top: 15px;">
                    <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Observações do Responsável:</label>
                    <textarea class="input" style="min-height: 60px;" onblur="KidsModule.updateField('${kid.id}', 'observacoes_responsavel', this.value)">${kid.observacoes_responsavel || ''}</textarea>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--primary); margin-bottom: 15px;">🏆 Equipe</h4>
                ${kid.funcao !== 'PARTICIPANTE' ? `<div style="color: var(--text-light);">Equipe de trabalho não compete em times.</div>` :
                    !podeVerEquipe ? `<div style="color: var(--text-light);">🔒 Visível apenas para quem gerencia as equipes.</div>` : `
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
                    <div>
                        <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Pulseira:</label>
                        <div style="background: #222; padding: 8px; border-radius: 5px;">
                            <button id="kids-wristband-btn-details-${kid.id}"
                                onclick="KidsModule.toggleWristbandFromDetails('${kid.id}')"
                                title="${wbDetails.title}"
                                ${wbDetails.disabled ? 'disabled' : ''}
                                style="display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 999px; font-size: 0.85em; font-weight: 700; font-family: 'Inter', sans-serif; white-space: nowrap; border: 1.5px solid ${wbDetails.border}; background: ${wbDetails.bg}; color: ${wbDetails.color}; opacity: ${wbDetails.opacity}; cursor: ${wbDetails.disabled ? 'not-allowed' : 'pointer'};">
                                ${wbDetails.icon} ${wbDetails.label}
                            </button>
                        </div>
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
        if (!isTeamsAdmin()) { notify('Você não tem permissão pra ver/alterar a equipe.', 'error'); return; }
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

            // Se a troca veio de dentro do modal "Gerenciar Equipes" (editor
            // de escalação), re-renderiza pra refletir a mudança na hora,
            // sem precisar fechar e reabrir.
            const teamsModal = document.getElementById('kids-teams-modal');
            if (teamsModal && teamsModal.style.display !== 'none') {
                renderTeamsList();
            }
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
        if (!isTeamsAdmin()) { notify('Você não tem permissão pra gerenciar as equipes.', 'error'); return; }
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
                            ${isTeamsAdmin() ? `<button onclick="KidsModule.deleteTeam('${team.id}')" class="btn btn-danger" style="padding: 5px 10px; font-size: 0.75em;">🗑️</button>` : ''}
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
                                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 0; font-size: 0.85em; border-bottom: 1px solid #262626; flex-wrap: wrap;">
                                    <span>${m.sexo === 'FEMININO' ? '👧' : '👦'} ${m.nome_crianca} (${m.idade} anos)</span>
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span class="btn btn-${getStatusClass(m.status_pagamento)}" style="padding: 2px 8px; font-size: 0.72em;">${getStatusText(m.status_pagamento)}</span>
                                        ${isTeamsAdmin() ? `
                                            <select class="input" style="padding: 4px 8px; font-size: 0.78em; width: auto;" title="Mover pra outra equipe" onchange="KidsModule.moveTeam('${m.id}', this.value)">
                                                ${teams.map(t => `<option value="${t.id}" ${t.id === team.id ? 'selected' : ''}>${t.nome_time}</option>`).join('')}
                                                <option value="">Sem equipe</option>
                                            </select>
                                        ` : ''}
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            `;
        }).join('');

        // Reaplica quais listas estavam abertas antes do re-render (ex: depois
        // de mover uma criança pelo editor), pra não fechar tudo de novo.
        expandedRosterIds.forEach(teamId => {
            const el = document.getElementById(`kids-roster-${teamId}`);
            const btn = document.getElementById(`kids-roster-toggle-${teamId}`);
            if (el) {
                el.style.display = 'block';
                if (btn) btn.textContent = 'Ocultar lista';
            }
        });
    }

    function toggleRoster(teamId) {
        const el = document.getElementById(`kids-roster-${teamId}`);
        const btn = document.getElementById(`kids-roster-toggle-${teamId}`);
        if (!el) return;
        const abrindo = el.style.display === 'none';
        el.style.display = abrindo ? 'block' : 'none';
        if (btn) btn.textContent = abrindo ? 'Ocultar lista' : 'Ver lista';
        if (abrindo) expandedRosterIds.add(teamId); else expandedRosterIds.delete(teamId);
    }

    async function createTeam() {
        if (!isTeamsAdmin()) { notify('Você não tem permissão pra criar equipes.', 'error'); return; }

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
        if (!isTeamsAdmin()) { notify('Você não tem permissão pra excluir uma equipe.', 'error'); return; }

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
        if (!isTeamsAdmin()) { notify('Você não tem permissão pra atribuir equipes.', 'error'); return; }

        const pendentes = allKids
            .filter(k => k.tipo_evento === currentTeamsTipoEvento && k.funcao === 'PARTICIPANTE' && !k.equipe_id && valorPagoNumerico(k) >= VALOR_MINIMO_ENTRADA)
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
    // DASHBOARD DE FECHAMENTO (Kids) — mesma lógica do retiro principal,
    // adaptada pra pagamentos_kids/inscricoes_kids. Ver app.js
    // (buildFilteredPaymentsQueryFactory/fetchAllRows/fetchParticipantsStatus/
    // applyStatusFilter) pra referência do porquê dessa estrutura: garante
    // que painel e exportação nunca divirjam, e pagina a busca de pagamentos
    // pra não truncar silenciosamente se o volume crescer.
    // ==========================================================
    const KIDS_CHUNK_SIZE = 1000;

    function dateRange(v) { return window.getUTCDateRangeForLocalDate ? window.getUTCDateRangeForLocalDate(v) : null; }

    async function fetchAllRowsKids(buildQuery) {
        let rows = [];
        let page = 0;
        let keepFetching = true;

        while (keepFetching) {
            const from = page * KIDS_CHUNK_SIZE;
            const to = from + KIDS_CHUNK_SIZE - 1;
            const { data, error } = await buildQuery().range(from, to);
            if (error) throw error;

            if (!data || data.length === 0) {
                keepFetching = false;
            } else {
                rows = rows.concat(data);
                page += 1;
                if (data.length < KIDS_CHUNK_SIZE) keepFetching = false;
            }
        }

        return rows;
    }

    function buildFilteredPaymentsQueryFactoryKids({ filterData, filterAtendente, filterForma }) {
        const range = dateRange(filterData);
        const normalizedAtendente = filterAtendente ? filterAtendente.trim() : '';

        return () => {
            let q = sb().from('pagamentos_kids').select('*');
            if (range) q = q.gte('data_pagamento', range.start).lte('data_pagamento', range.end);
            if (normalizedAtendente) q = q.ilike('atendente', normalizedAtendente);
            if (filterForma) q = q.eq('forma_pagamento', filterForma);
            return q;
        };
    }

    async function fetchParticipantsStatusKids(ids = []) {
        const uniqueIds = [...new Set(ids.filter(Boolean))];
        if (uniqueIds.length === 0) return [];

        const participants = [];
        for (let i = 0; i < uniqueIds.length; i += KIDS_CHUNK_SIZE) {
            const chunk = uniqueIds.slice(i, i + KIDS_CHUNK_SIZE);
            const { data, error } = await sb().from('inscricoes_kids').select('id, status_pagamento').in('id', chunk);
            if (error) throw error;
            participants.push(...(data || []));
        }
        return participants;
    }

    function applyStatusFilterKids(pagamentos, participants, status) {
        if (!status) return { pagamentos, participants };
        const allowedIds = new Set(participants.filter(p => p.status_pagamento === status).map(p => p.id));
        return {
            pagamentos: pagamentos.filter(p => allowedIds.has(p.inscricao_id)),
            participants: participants.filter(p => allowedIds.has(p.id))
        };
    }

    async function loadAtendentesKids() {
        try {
            const { data, error } = await sb().from('pagamentos_kids').select('atendente');
            if (error) throw error;

            const atendentes = [...new Set((data || []).map(p => p.atendente).filter(a => a && a.trim() !== ''))];
            const select = document.getElementById('kids-filter-atendente');
            if (!select) return;

            while (select.children.length > 1) select.removeChild(select.lastChild);
            atendentes.forEach(a => {
                const option = document.createElement('option');
                option.value = a;
                option.textContent = a;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Erro ao carregar atendentes (kids):', error);
        }
    }

    function showDashboard() {
        document.getElementById('kids-main-content').style.display = 'none';
        document.getElementById('kids-dashboard-container').style.display = 'block';
        loadAtendentesKids();
        updateDashboard();
    }

    function hideDashboard() {
        document.getElementById('kids-main-content').style.display = 'block';
        document.getElementById('kids-dashboard-container').style.display = 'none';
    }

    function resetDashboardMetricsKids() {
        document.getElementById('kids-dash-total-inscricoes').textContent = 0;
        document.getElementById('kids-dash-pre-inscricoes').textContent = 0;
        document.getElementById('kids-dash-pagos-completo').textContent = 0;
        document.getElementById('kids-total-arrecadado').textContent = 'R$ 0,00';

        const zeroCard = (id) => {
            document.getElementById(id).innerHTML = `
                <div style="font-size: 1.8em; font-weight: bold;">0</div>
                <div style="font-size: 0.9em;">R$ 0,00</div>
            `;
        };

        zeroCard('kids-dash-valor-pix');
        zeroCard('kids-dash-valor-dinheiro');
        zeroCard('kids-dash-valor-cartao');
        zeroCard('kids-dash-valor-debito');
        zeroCard('kids-dash-valor-recibo');

        document.getElementById('kids-inscricoes-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center; color: #666;">Nenhum resultado encontrado</td></tr>';
    }

    async function updateDashboard() {
        try {
            const filterData = document.getElementById('kids-filter-data').value;
            const filterAtendente = document.getElementById('kids-filter-atendente').value;
            const filterForma = document.getElementById('kids-filter-forma').value;
            const filterStatus = document.getElementById('kids-filter-status-dash').value;

            const buildPayQuery = buildFilteredPaymentsQueryFactoryKids({ filterData, filterAtendente, filterForma });
            const pagamentos = await fetchAllRowsKids(buildPayQuery);

            if (!pagamentos || pagamentos.length === 0) {
                resetDashboardMetricsKids();
                return;
            }

            const participantsInfo = await fetchParticipantsStatusKids(pagamentos.map(p => p.inscricao_id));
            const { pagamentos: filteredPayments, participants: filteredParticipants } =
                applyStatusFilterKids(pagamentos, participantsInfo, filterStatus);

            if (!filteredPayments.length) {
                resetDashboardMetricsKids();
                return;
            }

            const participantLookup = new Map(filteredParticipants.map(p => [p.id, p]));
            const participantsForMetrics = [...new Set(filteredPayments.map(p => p.inscricao_id))]
                .map(id => participantLookup.get(id) || { id, status_pagamento: 'N/A' });

            const stats = {
                totalArrecadado: 0,
                formas: {
                    'PIX': { qtd: 0, valor: 0 },
                    'DINHEIRO': { qtd: 0, valor: 0 },
                    'CARTÃO DE CRÉDITO': { qtd: 0, valor: 0 },
                    'CARTÃO DE DÉBITO': { qtd: 0, valor: 0 },
                    'RECIBO': { qtd: 0, valor: 0 }
                }
            };

            filteredPayments.forEach(p => {
                const valor = parseFloat(p.valor_pago) || 0;
                stats.totalArrecadado += valor;
                if (stats.formas[p.forma_pagamento]) {
                    stats.formas[p.forma_pagamento].qtd += 1;
                    stats.formas[p.forma_pagamento].valor += valor;
                }
            });

            document.getElementById('kids-dash-total-inscricoes').textContent = participantsForMetrics.length;
            document.getElementById('kids-dash-pagos-completo').textContent = participantsForMetrics.filter(p => p.status_pagamento === 'PAGO').length;
            document.getElementById('kids-dash-pre-inscricoes').textContent = participantsForMetrics.filter(p => p.status_pagamento === 'PAGO PARCIALMENTE').length;
            document.getElementById('kids-total-arrecadado').textContent = `R$ ${stats.totalArrecadado.toFixed(2).replace('.', ',')}`;

            const updateFormaCard = (id, forma) => {
                document.getElementById(id).innerHTML = `
                    <div style="font-size: 1.8em; font-weight: bold;">${stats.formas[forma]?.qtd || 0}</div>
                    <div style="font-size: 0.9em;">R$ ${stats.formas[forma]?.valor.toFixed(2).replace('.', ',') || '0,00'}</div>
                `;
            };

            updateFormaCard('kids-dash-valor-pix', 'PIX');
            updateFormaCard('kids-dash-valor-dinheiro', 'DINHEIRO');
            updateFormaCard('kids-dash-valor-cartao', 'CARTÃO DE CRÉDITO');
            updateFormaCard('kids-dash-valor-debito', 'CARTÃO DE DÉBITO');
            updateFormaCard('kids-dash-valor-recibo', 'RECIBO');

            await updateInscricoesTableFromPayments(filteredPayments);

        } catch (error) {
            console.error('❌ Erro no dashboard (kids):', error);
            notify('Erro ao atualizar dashboard: ' + error.message, 'error');
        }
    }

    async function updateInscricoesTableFromPayments(pagamentos) {
        const tbody = document.getElementById('kids-inscricoes-tbody');
        if (!tbody) return;

        if (!pagamentos || pagamentos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #666;">Nenhum resultado encontrado</td></tr>';
            return;
        }

        const linhas = pagamentos.map(p => {
            const dataPagamento = new Date(p.data_pagamento).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            const valorFormatado = `R$ ${parseFloat(p.valor_pago).toFixed(2).replace('.', ',')}`;

            return `
                <tr style="cursor: pointer; border-bottom: 1px solid #333;" onclick="KidsModule.showDetails('${p.inscricao_id}')">
                    <td style="padding: 10px;">${p.nome_participante || 'N/A'}</td>
                    <td style="padding: 10px;">${p.forma_pagamento || 'N/A'}</td>
                    <td style="padding: 10px; text-align: left;"><strong style="color: #22c55e;">${valorFormatado}</strong></td>
                    <td style="padding: 10px;">${p.atendente || 'N/A'}</td>
                    <td style="padding: 10px;">${dataPagamento}</td>
                </tr>
            `;
        });

        tbody.innerHTML = linhas.join('');
    }

    function exportDashboard() {
        try {
            notify('Gerando base completa...', 'info');

            const data = allKids.map(k => ({
                ...k,
                criado_em: k.criado_em ? fmtData(localTime(k.criado_em)) : 'N/A',
                data_confirmacao_pagamento: k.data_confirmacao_pagamento ? fmtData(localTime(k.data_confirmacao_pagamento)) : 'N/A',
                data_ultima_atualizacao: k.data_ultima_atualizacao ? fmtData(localTime(k.data_ultima_atualizacao)) : 'N/A'
            }));

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Base Completa Kids');
            XLSX.writeFile(wb, `base_completa_kids_${new Date().toISOString().split('T')[0]}.xlsx`);

        } catch (error) {
            console.error('Erro ao exportar base completa (kids):', error);
            notify('Erro ao exportar base completa', 'error');
        }
    }

    async function exportFiltrado() {
        try {
            notify('Gerando relatório filtrado...', 'info');

            const filterData = document.getElementById('kids-filter-data').value;
            const filterAtendente = document.getElementById('kids-filter-atendente').value;
            const filterForma = document.getElementById('kids-filter-forma').value;
            const filterStatus = document.getElementById('kids-filter-status-dash').value;

            const buildPayQuery = buildFilteredPaymentsQueryFactoryKids({ filterData, filterAtendente, filterForma });
            const pagamentosBrutos = await fetchAllRowsKids(buildPayQuery);

            if (!pagamentosBrutos || pagamentosBrutos.length === 0) {
                notify('Nenhum dado para exportar', 'warning');
                return;
            }

            const participantsInfo = await fetchParticipantsStatusKids(pagamentosBrutos.map(p => p.inscricao_id));
            const { pagamentos } = applyStatusFilterKids(pagamentosBrutos, participantsInfo, filterStatus);

            if (pagamentos.length === 0) {
                notify('Nenhum dado para exportar', 'warning');
                return;
            }

            const data = pagamentos.map(p => ({
                'Participante': p.nome_participante,
                'Valor_Pago': parseFloat(p.valor_pago),
                'Forma': p.forma_pagamento,
                'Atendente': p.atendente,
                'Data': fmtData(localTime(p.data_pagamento)),
                'Observações': p.observacoes
            }));

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Pagamentos Filtrados Kids');
            XLSX.writeFile(wb, `pagamentos_filtrados_kids_${new Date().toISOString().split('T')[0]}.xlsx`);

            notify(`Relatório exportado: ${pagamentos.length} pagamento(s)!`, 'success');

        } catch (error) {
            console.error('Erro ao exportar (kids):', error);
            notify('Erro ao exportar: ' + error.message, 'error');
        }
    }

    // ==========================================================
    // RESUMO DE INSCRIÇÕES (Kids) — mesma ideia do resumo de ônibus do
    // retiro principal, só que por tipo_evento em vez de sexo.
    // ==========================================================
    const RESUMO_TIPOS_KIDS = ['ACAMPA_KIDS', 'BROTHERS_CAMP'];
    const RESUMO_STATUS_KIDS = ['PAGO', 'PAGO PARCIALMENTE', 'PENDENTE'];

    function contarInscricoesKids({ tipoEvento, funcao, status } = {}) {
        return allKids.filter(k =>
            (!tipoEvento || k.tipo_evento === tipoEvento) &&
            (!funcao || k.funcao === funcao) &&
            (!status || k.status_pagamento === status)
        ).length;
    }

    function montarLinhasResumoKids(tipoEvento) {
        const linhaTotal = `
            <tr style="background: rgba(255,255,255,0.08); font-weight: 900;">
                <td style="padding: 10px;">${tipoEventoLabel(tipoEvento)}</td>
                <td style="text-align: center;">${contarInscricoesKids({ tipoEvento, funcao: 'PARTICIPANTE' })}</td>
                <td style="text-align: center;">${contarInscricoesKids({ tipoEvento, funcao: 'TRABALHO' })}</td>
                <td style="text-align: center;">${contarInscricoesKids({ tipoEvento })}</td>
            </tr>
        `;
        const linhasStatus = RESUMO_STATUS_KIDS.map(status => `
            <tr>
                <td style="padding: 8px 8px 8px 24px; color: var(--text-light);">${getStatusText(status)}</td>
                <td style="text-align: center;">${contarInscricoesKids({ tipoEvento, funcao: 'PARTICIPANTE', status })}</td>
                <td style="text-align: center;">${contarInscricoesKids({ tipoEvento, funcao: 'TRABALHO', status })}</td>
                <td style="text-align: center;">${contarInscricoesKids({ tipoEvento, status })}</td>
            </tr>
        `).join('');
        return linhaTotal + linhasStatus;
    }

    function montarTabelaResumoKids() {
        const linhaTotalGeral = `
            <tr style="background: rgba(255,255,255,0.08); font-weight: 900; border-top: 2px solid var(--border-strong);">
                <td style="padding: 10px;">Total Geral</td>
                <td style="text-align: center;">${contarInscricoesKids({ funcao: 'PARTICIPANTE' })}</td>
                <td style="text-align: center;">${contarInscricoesKids({ funcao: 'TRABALHO' })}</td>
                <td style="text-align: center;">${allKids.length}</td>
            </tr>
        `;

        return `
            <table class="table" style="width: 100%;">
                <thead>
                    <tr>
                        <th>RETIRO KIDS</th>
                        <th style="text-align: center;">PARTICIPANTE</th>
                        <th style="text-align: center;">TRABALHO</th>
                        <th style="text-align: center;">Total Geral</th>
                    </tr>
                </thead>
                <tbody>
                    ${montarLinhasResumoKids('ACAMPA_KIDS')}
                    ${montarLinhasResumoKids('BROTHERS_CAMP')}
                    ${linhaTotalGeral}
                </tbody>
            </table>
        `;
    }

    function generateSummaryReport() {
        try {
            const dataAtualizacao = fmtData(new Date());
            const content = `
                <div style="margin-bottom: 15px; color: var(--text-light); text-align: center;">
                    Inscrições atualizadas até ${dataAtualizacao}
                </div>
                ${montarTabelaResumoKids()}
            `;
            document.getElementById('kids-summary-content').innerHTML = content;
            document.getElementById('kids-summary-modal').style.display = 'flex';
        } catch (error) {
            console.error('Erro ao gerar resumo (kids):', error);
            notify('Erro ao gerar resumo de inscrições', 'error');
        }
    }

    function closeSummaryModal() {
        document.getElementById('kids-summary-modal').style.display = 'none';
    }

    function printSummaryReport() {
        const printContent = `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <h1 style="color: #ff6b35;">RETIRO KIDS</h1>
                    <h2>Inscrições atualizadas até ${fmtData(new Date())}</h2>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead>
                        <tr style="background: #ff6b35; color: white;">
                            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">RETIRO KIDS</th>
                            <th style="border: 1px solid #ddd; padding: 8px;">PARTICIPANTE</th>
                            <th style="border: 1px solid #ddd; padding: 8px;">TRABALHO</th>
                            <th style="border: 1px solid #ddd; padding: 8px;">Total Geral</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${RESUMO_TIPOS_KIDS.map(tipo => `
                            <tr style="background: #eee; font-weight: bold;">
                                <td style="border: 1px solid #ddd; padding: 8px;">${tipoEventoLabel(tipo)}</td>
                                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${contarInscricoesKids({ tipoEvento: tipo, funcao: 'PARTICIPANTE' })}</td>
                                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${contarInscricoesKids({ tipoEvento: tipo, funcao: 'TRABALHO' })}</td>
                                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${contarInscricoesKids({ tipoEvento: tipo })}</td>
                            </tr>
                            ${RESUMO_STATUS_KIDS.map(status => `
                                <tr>
                                    <td style="border: 1px solid #ddd; padding: 8px 8px 8px 24px;">${getStatusText(status)}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${contarInscricoesKids({ tipoEvento: tipo, funcao: 'PARTICIPANTE', status })}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${contarInscricoesKids({ tipoEvento: tipo, funcao: 'TRABALHO', status })}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${contarInscricoesKids({ tipoEvento: tipo, status })}</td>
                                </tr>
                            `).join('')}
                        `).join('')}
                        <tr style="background: #eee; font-weight: bold;">
                            <td style="border: 1px solid #ddd; padding: 8px;">Total Geral</td>
                            <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${contarInscricoesKids({ funcao: 'PARTICIPANTE' })}</td>
                            <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${contarInscricoesKids({ funcao: 'TRABALHO' })}</td>
                            <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${allKids.length}</td>
                        </tr>
                    </tbody>
                </table>
                <div style="margin-top: 30px; text-align: center; font-size: 10px; color: #666;">
                    Gerado em ${fmtData(new Date())} - Sistema de Balcão O Retiro 2026 (Kids)
                </div>
            </div>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.print();
    }

    // ==========================================================
    // RELATÓRIO ADM — fechamento por atendente (Kids), ADM only
    // ==========================================================
    let admReportDataKids = null;

    function openAdmReport() {
        if (!isAdm()) { notify('Apenas administradores podem ver o relatório ADM.', 'error'); return; }
        document.getElementById('kids-adm-report-modal').style.display = 'flex';
        document.getElementById('kids-adm-report-content').innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Selecione o período e clique em Gerar Relatório</div>';
        document.getElementById('kids-adm-export-btn').style.display = 'none';
        admReportDataKids = null;
    }

    function closeAdmReportModal() {
        document.getElementById('kids-adm-report-modal').style.display = 'none';
        admReportDataKids = null;
    }

    async function generateAttendantReport() {
        if (!isAdm()) { notify('Apenas administradores podem gerar o relatório ADM.', 'error'); return; }

        const startDate = document.getElementById('kids-adm-report-start').value;
        const endDate = document.getElementById('kids-adm-report-end').value;
        const contentDiv = document.getElementById('kids-adm-report-content');
        contentDiv.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="loading"></div> Carregando...</div>';
        document.getElementById('kids-adm-export-btn').style.display = 'none';

        try {
            let query = sb().from('pagamentos_kids').select('*');

            if (startDate) {
                const startRange = dateRange(startDate);
                if (startRange) query = query.gte('data_pagamento', startRange.start);
            }
            if (endDate) {
                const endRange = dateRange(endDate);
                if (endRange) query = query.lte('data_pagamento', endRange.end);
            }

            const { data: pagamentos, error } = await query;
            if (error) throw error;

            if (!pagamentos || pagamentos.length === 0) {
                contentDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Nenhum pagamento encontrado no período</div>';
                return;
            }

            const byAtendente = {};
            pagamentos.forEach(p => {
                const atendente = (p.atendente || 'SEM ATENDENTE').trim();
                if (!byAtendente[atendente]) {
                    byAtendente[atendente] = { dinheiro: 0, debito: 0, credito: 0, pix: 0, recibo: 0, participantes: new Set() };
                }
                const valor = parseFloat(p.valor_pago) || 0;
                const forma = p.forma_pagamento || '';
                if (forma === 'DINHEIRO') byAtendente[atendente].dinheiro += valor;
                else if (forma === 'CARTÃO DE DÉBITO') byAtendente[atendente].debito += valor;
                else if (forma === 'CARTÃO DE CRÉDITO') byAtendente[atendente].credito += valor;
                else if (forma === 'PIX') byAtendente[atendente].pix += valor;
                else if (forma === 'RECIBO') byAtendente[atendente].recibo += valor;
                if (p.inscricao_id) byAtendente[atendente].participantes.add(p.inscricao_id);
            });

            admReportDataKids = Object.entries(byAtendente)
                .map(([atendente, a]) => ({
                    atendente,
                    dinheiro: a.dinheiro,
                    debito: a.debito,
                    credito: a.credito,
                    pix: a.pix,
                    acumulado: a.debito + a.credito + a.pix,
                    recibo: a.recibo,
                    totalComRecibo: a.dinheiro + a.debito + a.credito + a.pix + a.recibo,
                    totalSemRecibo: a.dinheiro + a.debito + a.credito + a.pix,
                    unicos: a.participantes.size
                }))
                .sort((a, b) => a.atendente.localeCompare(b.atendente));

            const totals = admReportDataKids.reduce((acc, r) => ({
                dinheiro: acc.dinheiro + r.dinheiro,
                debito: acc.debito + r.debito,
                credito: acc.credito + r.credito,
                pix: acc.pix + r.pix,
                acumulado: acc.acumulado + r.acumulado,
                recibo: acc.recibo + r.recibo,
                totalComRecibo: acc.totalComRecibo + r.totalComRecibo,
                totalSemRecibo: acc.totalSemRecibo + r.totalSemRecibo,
                unicos: acc.unicos + r.unicos
            }), { dinheiro: 0, debito: 0, credito: 0, pix: 0, acumulado: 0, recibo: 0, totalComRecibo: 0, totalSemRecibo: 0, unicos: 0 });

            const fmt = v => `R$ ${v.toFixed(2).replace('.', ',')}`;

            const rows = admReportDataKids.map(r => `
                <tr>
                    <td style="padding: 10px; font-weight: bold; color: var(--primary);">${r.atendente}</td>
                    <td style="padding: 10px; text-align: right;">${fmt(r.dinheiro)}</td>
                    <td style="padding: 10px; text-align: right;">${fmt(r.debito)}</td>
                    <td style="padding: 10px; text-align: right;">${fmt(r.credito)}</td>
                    <td style="padding: 10px; text-align: right;">${fmt(r.pix)}</td>
                    <td style="padding: 10px; text-align: right; color: #22c55e;">${fmt(r.acumulado)}</td>
                    <td style="padding: 10px; text-align: right;">${fmt(r.recibo)}</td>
                    <td style="padding: 10px; text-align: right; color: var(--primary); font-weight: bold;">${fmt(r.totalComRecibo)}</td>
                    <td style="padding: 10px; text-align: right; color: #22c55e; font-weight: bold;">${fmt(r.totalSemRecibo)}</td>
                    <td style="padding: 10px; text-align: center;">${r.unicos}</td>
                </tr>
            `).join('');

            const periodoLabel = (startDate || endDate)
                ? `Período: ${startDate ? new Date(startDate + 'T12:00:00').toLocaleDateString('pt-BR') : 'início'} até ${endDate ? new Date(endDate + 'T12:00:00').toLocaleDateString('pt-BR') : 'hoje'}`
                : 'Todos os períodos';

            contentDiv.innerHTML = `
                <div style="margin-bottom: 15px; color: #ccc; font-size: 0.9em;">${periodoLabel} · ${pagamentos.length} pagamentos encontrados</div>
                <div style="overflow-x: auto;">
                    <table class="table" style="font-size: 0.85em; min-width: 950px;">
                        <thead>
                            <tr style="background: #222;">
                                <th style="padding: 10px; white-space: nowrap;">Atendente</th>
                                <th style="padding: 10px; text-align: right; white-space: nowrap;">💵 Dinheiro</th>
                                <th style="padding: 10px; text-align: right; white-space: nowrap;">💳 Débito</th>
                                <th style="padding: 10px; text-align: right; white-space: nowrap;">💳 Crédito</th>
                                <th style="padding: 10px; text-align: right; white-space: nowrap;">🏦 PIX</th>
                                <th style="padding: 10px; text-align: right; white-space: nowrap;">📊 Acumulado ¹</th>
                                <th style="padding: 10px; text-align: right; white-space: nowrap;">🧾 Recibo</th>
                                <th style="padding: 10px; text-align: right; white-space: nowrap;">✅ Total c/ Recibo</th>
                                <th style="padding: 10px; text-align: right; white-space: nowrap;">🔹 Total s/ Recibo</th>
                                <th style="padding: 10px; text-align: center; white-space: nowrap;">👥 Únicos</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                        <tfoot>
                            <tr style="background: var(--primary); color: white; font-weight: bold;">
                                <td style="padding: 10px;">TOTAL GERAL</td>
                                <td style="padding: 10px; text-align: right;">${fmt(totals.dinheiro)}</td>
                                <td style="padding: 10px; text-align: right;">${fmt(totals.debito)}</td>
                                <td style="padding: 10px; text-align: right;">${fmt(totals.credito)}</td>
                                <td style="padding: 10px; text-align: right;">${fmt(totals.pix)}</td>
                                <td style="padding: 10px; text-align: right;">${fmt(totals.acumulado)}</td>
                                <td style="padding: 10px; text-align: right;">${fmt(totals.recibo)}</td>
                                <td style="padding: 10px; text-align: right;">${fmt(totals.totalComRecibo)}</td>
                                <td style="padding: 10px; text-align: right;">${fmt(totals.totalSemRecibo)}</td>
                                <td style="padding: 10px; text-align: center;">${totals.unicos}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <div style="margin-top: 10px; font-size: 0.75em; color: #888;">¹ Acumulado = Crédito + Débito + PIX</div>
            `;

            document.getElementById('kids-adm-export-btn').style.display = 'block';

        } catch (error) {
            console.error('❌ Erro ao gerar relatório ADM (kids):', error);
            contentDiv.innerHTML = `<div style="text-align: center; padding: 40px; color: #ff6666;">Erro: ${error.message}</div>`;
            notify('Erro ao gerar relatório: ' + error.message, 'error');
        }
    }

    function exportAdmReport() {
        if (!admReportDataKids) return;

        const startDate = document.getElementById('kids-adm-report-start').value;
        const endDate = document.getElementById('kids-adm-report-end').value;
        const fmt = v => parseFloat(v.toFixed(2));

        const totals = admReportDataKids.reduce((acc, r) => ({
            dinheiro: acc.dinheiro + r.dinheiro,
            debito: acc.debito + r.debito,
            credito: acc.credito + r.credito,
            pix: acc.pix + r.pix,
            acumulado: acc.acumulado + r.acumulado,
            recibo: acc.recibo + r.recibo,
            totalComRecibo: acc.totalComRecibo + r.totalComRecibo,
            totalSemRecibo: acc.totalSemRecibo + r.totalSemRecibo,
            unicos: acc.unicos + r.unicos
        }), { dinheiro: 0, debito: 0, credito: 0, pix: 0, acumulado: 0, recibo: 0, totalComRecibo: 0, totalSemRecibo: 0, unicos: 0 });

        const data = [
            ...admReportDataKids.map(r => ({
                'Atendente': r.atendente,
                'Valor Dinheiro (R$)': fmt(r.dinheiro),
                'Valor Débito (R$)': fmt(r.debito),
                'Valor Crédito (R$)': fmt(r.credito),
                'Valor PIX (R$)': fmt(r.pix),
                'Acumulado Créd+Déb+PIX (R$)': fmt(r.acumulado),
                'Valor Recibo (R$)': fmt(r.recibo),
                'Total c/ Recibo (R$)': fmt(r.totalComRecibo),
                'Total s/ Recibo (R$)': fmt(r.totalSemRecibo),
                'Atendimentos Únicos': r.unicos
            })),
            {
                'Atendente': 'TOTAL GERAL',
                'Valor Dinheiro (R$)': fmt(totals.dinheiro),
                'Valor Débito (R$)': fmt(totals.debito),
                'Valor Crédito (R$)': fmt(totals.credito),
                'Valor PIX (R$)': fmt(totals.pix),
                'Acumulado Créd+Déb+PIX (R$)': fmt(totals.acumulado),
                'Valor Recibo (R$)': fmt(totals.recibo),
                'Total c/ Recibo (R$)': fmt(totals.totalComRecibo),
                'Total s/ Recibo (R$)': fmt(totals.totalSemRecibo),
                'Atendimentos Únicos': totals.unicos
            }
        ];

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Fechamento por Atendente Kids');
        const periodoStr = (startDate && endDate) ? `_${startDate}_a_${endDate}` : '';
        XLSX.writeFile(wb, `relatorio_atendentes_kids${periodoStr}_${new Date().toISOString().split('T')[0]}.xlsx`);
        notify('Relatório exportado com sucesso!', 'success');
    }

    // ==========================================================
    // CHECK-IN DE CRIANÇAS (dia do evento) — mesma lógica/regra de negócio
    // do check-in de encontristas do retiro principal: "chegou/check-in
    // realizado" = quitou 100%; "check-in físico de fato" = pulseira
    // entregue entre quem já quitou. Só PARTICIPANTE entra aqui — equipe
    // de trabalho não é tracked (mesma exclusão do sorteio de equipes).
    // ==========================================================
    const DESISTENTE_MARKER = 'MARCADO COMO DESISTENTE';

    function isDesistente(kid) {
        return !!(kid.observacoes && kid.observacoes.includes(DESISTENTE_MARKER));
    }

    function getValorRestanteCheckin(kid) {
        return Math.max(0, getValorEsperado(kid) - valorPagoNumerico(kid));
    }

    function getCheckinTipoEventoSelecionado() {
        const el = document.getElementById('kids-checkin-tipo');
        return el ? el.value : 'ACAMPA_KIDS';
    }

    // "Esperados" = crianças do evento escolhido que já têm algum valor
    // pago (PAGO PARCIALMENTE ou PAGO). Quem está PENDENTE não entra na
    // lista de acompanhamento.
    function getCriancasEmAcompanhamento(tipoEvento) {
        return allKids.filter(k =>
            k.tipo_evento === tipoEvento &&
            k.funcao === 'PARTICIPANTE' &&
            (k.status_pagamento === 'PAGO' || k.status_pagamento === 'PAGO PARCIALMENTE')
        );
    }

    async function openCheckinModal() {
        document.getElementById('kids-checkin-modal').style.display = 'flex';
        await refreshCheckinModal();
    }

    function closeCheckinModal() {
        document.getElementById('kids-checkin-modal').style.display = 'none';
    }

    // Recarrega direto do banco (útil se outro atendente lançou pagamento
    // em outra tela enquanto este modal está aberto) e re-renderiza.
    async function refreshCheckinModal() {
        const btn = document.getElementById('kids-checkin-refresh-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Atualizando...'; }

        try {
            await loadKids();
            renderCheckinModal();

            const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const lastUpdateEl = document.getElementById('kids-checkin-last-update');
            if (lastUpdateEl) lastUpdateEl.textContent = `Atualizado às ${agora}`;
        } catch (error) {
            console.error('❌ Erro ao atualizar check-in (kids):', error);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Atualizar'; }
        }
    }

    function renderCheckinModal() {
        const tipoEvento = getCheckinTipoEventoSelecionado();
        const esperados = getCriancasEmAcompanhamento(tipoEvento);
        const desistentes = esperados.filter(k => isDesistente(k));
        const chegaram = esperados.filter(k => !isDesistente(k) && k.status_pagamento === 'PAGO');
        const faltam = esperados.filter(k => !isDesistente(k) && k.status_pagamento !== 'PAGO');

        // Entre quem já quitou 100%, quem já recebeu a pulseira é quem de fato
        // já chegou/fez check-in presencial.
        const checkinFeito = chegaram.filter(k => isWristbandDelivered(k));
        const checkinPendente = chegaram.filter(k => !isWristbandDelivered(k));

        document.getElementById('kids-checkin-esperados').textContent = esperados.length;
        document.getElementById('kids-checkin-chegaram').textContent = chegaram.length;
        document.getElementById('kids-checkin-faltam').textContent = faltam.length;
        document.getElementById('kids-checkin-pulseira-entregue').textContent = checkinFeito.length;
        document.getElementById('kids-checkin-pulseira-pendente').textContent = checkinPendente.length;
        document.getElementById('kids-checkin-desistentes').textContent = desistentes.length;

        const linha = (k, marcado) => `
            <tr style="${marcado ? 'opacity: 0.55;' : ''}">
                <td style="padding: 8px; ${marcado ? 'text-decoration: line-through;' : ''}">${k.nome_crianca}</td>
                <td style="padding: 8px; text-align: center;">${k.rede || 'N/A'}</td>
                <td style="padding: 8px; text-align: center;">${fmtMoeda(k.valor_pago)}</td>
                <td style="padding: 8px; text-align: center; color: #f87171; font-weight: bold;">${marcado ? '—' : fmtMoeda(getValorRestanteCheckin(k))}</td>
                <td style="padding: 8px; text-align: center;">${k.responsavel_whatsapp || 'N/A'}</td>
                <td style="padding: 8px; text-align: center;">
                    <button onclick="KidsModule.toggleDesistenteCheckin('${k.id}')" class="btn ${marcado ? 'btn-secondary' : 'btn-danger'}" style="padding: 4px 10px; font-size: 0.75em;">
                        ${marcado ? '↩️ Desmarcar' : '🚫 Desistente'}
                    </button>
                </td>
            </tr>
        `;

        const lista = document.getElementById('kids-checkin-lista');
        if (faltam.length === 0 && desistentes.length === 0) {
            lista.innerHTML = '<div style="text-align: center; color: #4ade80; font-weight: bold; padding: 20px;">🎉 Todo mundo da lista já quitou 100%!</div>';
            return;
        }

        lista.innerHTML = `
            <table class="table" style="width: 100%;">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th style="text-align: center;">Rede</th>
                        <th style="text-align: center;">Valor Pago</th>
                        <th style="text-align: center;">Falta Pagar</th>
                        <th style="text-align: center;">WhatsApp</th>
                        <th style="text-align: center;">Ação</th>
                    </tr>
                </thead>
                <tbody>
                    ${faltam.map(k => linha(k, false)).join('')}
                    ${desistentes.map(k => linha(k, true)).join('')}
                </tbody>
            </table>
        `;
    }

    async function toggleDesistenteCheckin(kidId) {
        try {
            const { data: currentData, error: fetchError } = await sb()
                .from('inscricoes_kids')
                .select('observacoes')
                .eq('id', kidId)
                .single();

            if (fetchError) throw fetchError;

            const jaMarcado = !!(currentData.observacoes && currentData.observacoes.includes(DESISTENTE_MARKER));

            if (!jaMarcado) {
                const kid = allKids.find(k => k.id === kidId);
                if (!confirm(`Confirma marcar "${kid ? kid.nome_crianca : 'este participante'}" como DESISTENTE?`)) {
                    return;
                }
            }

            let updatedObservations;
            if (jaMarcado) {
                updatedObservations = (currentData.observacoes || '')
                    .split(' | ')
                    .filter(linha => !linha.includes(DESISTENTE_MARKER))
                    .join(' | ') || null;
            } else {
                const timestamp = new Date().toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                });
                const novaNota = `[${timestamp}] 🚫 ${DESISTENTE_MARKER} (${atendenteAtual()})`;
                updatedObservations = currentData.observacoes ? `${currentData.observacoes} | ${novaNota}` : novaNota;
            }

            const { error: updateError } = await sb()
                .from('inscricoes_kids')
                .update({ observacoes: updatedObservations, data_ultima_atualizacao: new Date().toISOString() })
                .eq('id', kidId);

            if (updateError) throw updateError;

            const kidLocal = allKids.find(k => k.id === kidId);
            if (kidLocal) kidLocal.observacoes = updatedObservations;

            renderCheckinModal();
            notify(jaMarcado ? 'Desistência desmarcada.' : 'Participante marcado como desistente.', 'success');

        } catch (error) {
            console.error('❌ Erro ao marcar desistente (kids):', error);
            notify('Erro ao marcar desistente: ' + error.message, 'error');
        }
    }

    function exportCheckinFaltantes() {
        try {
            const tipoEvento = getCheckinTipoEventoSelecionado();
            const esperados = getCriancasEmAcompanhamento(tipoEvento);
            const faltam = esperados.filter(k => !isDesistente(k) && k.status_pagamento !== 'PAGO');

            if (faltam.length === 0) {
                notify('Não há ninguém faltando para exportar', 'warning');
                return;
            }

            const data = faltam.map(k => ({
                'Nome': k.nome_crianca,
                'Rede': k.rede || 'N/A',
                'Valor Pago': fmtMoeda(k.valor_pago),
                'Falta Pagar': fmtMoeda(getValorRestanteCheckin(k)),
                'Status': getStatusText(k.status_pagamento),
                'WhatsApp': k.responsavel_whatsapp || 'N/A',
                'Evento': tipoEventoLabel(k.tipo_evento)
            }));

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Faltam Chegar');
            XLSX.writeFile(wb, `faltam_chegar_kids_${tipoEvento.toLowerCase()}_${new Date().toISOString().split('T')[0]}.xlsx`);
            notify('Lista exportada com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao exportar lista de faltantes (kids):', error);
            notify('Erro ao exportar lista de faltantes', 'error');
        }
    }

    // ==========================================================
    // API PÚBLICA DO MÓDULO
    // ==========================================================
    window.KidsModule = {
        onTabShown,
        refreshAll,
        applyTeamsOnlyRestriction,
        removeTeamsOnlyRestriction,
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
        atribuirPendentes,
        showDashboard,
        hideDashboard,
        updateDashboard,
        exportDashboard,
        exportFiltrado,
        generateSummaryReport,
        closeSummaryModal,
        printSummaryReport,
        openAdmReport,
        closeAdmReportModal,
        generateAttendantReport,
        exportAdmReport,
        toggleWristband,
        toggleWristbandFromDetails,
        openCheckinModal,
        closeCheckinModal,
        refreshCheckinModal,
        renderCheckinModal,
        toggleDesistenteCheckin,
        exportCheckinFaltantes
    };
})();
