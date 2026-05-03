        // ===== CONFIGURAÇÃO SUPABASE =====
        const SUPABASE_URL = 'https://nkifiuenmiwvaqvwfktf.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5raWZpdWVubWl3dmFxdndma3RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNTEyNDYsImV4cCI6MjA3NjgyNzI0Nn0.Kis_dGXTLT0KGhC3HkKwAsGi6OMXPlzhOYmhdzWpiTM';
        const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // ===== VARIÁVEIS GLOBAIS =====
        let currentUser = null;
        let allParticipants = [];
        let currentParticipant = null;
        let currentReceipt = null;

        // ===== FUNÇÕES AUXILIARES =====
        async function getParticipantById(participantId) {
            console.log('🔍 Buscando participante:', participantId);
            
            try {
                const { data, error } = await supabase
                    .from('inscricoes')
                    .select('*')
                    .eq('id', participantId)
                    .eq('status', 'ATIVO')
                    .single();
                
                if (error) {
                    console.error('❌ Erro ao buscar participante:', error);
                    throw new Error('Participante não encontrado: ' + error.message);
                }
                
                if (!data) {
                    throw new Error('Participante não encontrado no banco de dados');
                }
                
                console.log('✅ Participante encontrado:', data.nome_completo);
                
                const existingIndex = allParticipants.findIndex(p => p.id == participantId);
                if (existingIndex >= 0) {
                    allParticipants[existingIndex] = data;
                } else {
                    allParticipants.push(data);
                }
                
                return data;
                
            } catch (error) {
                console.error('❌ Erro crítico ao buscar participante:', error);
                throw error;
            }
        }

        function formatDateTime(date) {
            return new Intl.DateTimeFormat('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date);
        }

        function formatCurrency(value) {
            const num = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : value;
            if (isNaN(num)) return 'R$ 0,00';
            return `R$ ${num.toFixed(2).replace('.', ',')}`;
        }

        function validateEmail(email) {
            const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return regex.test(email);
        }

        function convertToLocalTime(utcDateString) {
            if (!utcDateString) return new Date();
            try {
                return new Date(utcDateString);
            } catch (error) {
                console.error('Erro ao converter data:', error);
                return new Date();
            }
        }

        function getUTCDateRangeForLocalDate(dateString) {
            if (!dateString) return null;

            const [year, month, day] = dateString.split('-').map(Number);
            const startLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
            const endLocal = new Date(year, month - 1, day, 23, 59, 59, 999);

            if (isNaN(startLocal.getTime()) || isNaN(endLocal.getTime())) {
                console.warn('Data inválida informada para filtro:', dateString);
                return null;
            }

            // Converte o intervalo local (ex.: BRT) para UTC para comparar corretamente no Supabase
            return {
                start: startLocal.toISOString(),
                end: endLocal.toISOString()
            };
        }

        const PARTICIPANT_CHUNK_SIZE = 1000;

        async function fetchParticipantsStatus(ids = []) {
            const uniqueIds = [...new Set(ids.filter(Boolean))];
            if (uniqueIds.length === 0) return [];

            const participants = [];
            for (let i = 0; i < uniqueIds.length; i += PARTICIPANT_CHUNK_SIZE) {
                const chunk = uniqueIds.slice(i, i + PARTICIPANT_CHUNK_SIZE);
                const { data, error } = await supabase
                    .from('inscricoes')
                    .select('id, status_pagamento')
                    .in('id', chunk);

                if (error) throw error;
                participants.push(...(data || []));
            }

            return participants;
        }

        function applyStatusFilter(pagamentos, participants, status) {
            if (!status) {
                return {
                    pagamentos,
                    participants
                };
            }

            const allowedIds = new Set(
                participants
                    .filter(p => p.status_pagamento === status)
                    .map(p => p.id)
            );

            return {
                pagamentos: pagamentos.filter(p => allowedIds.has(p.inscricao_id)),
                participants: participants.filter(p => allowedIds.has(p.id))
            };
        }

        function getStatusClass(status) {
            switch(status) {
                case 'PAGO': return 'success';
                case 'PAGO PARCIALMENTE': return 'warning';
                case 'PENDENTE': return 'danger';
                default: return 'secondary';
            }
        }

        function getStatusText(status) {
            switch(status) {
                case 'PAGO': return 'PAGO';
                case 'PAGO PARCIALMENTE': return 'PAGO PARCIALMENTE';
                case 'PENDENTE': return 'PENDENTE';
                default: return 'PENDENTE';
            }
        }

        function showNotification(message, type = 'success') {
            const existingNotifications = document.querySelectorAll('.notification');
            existingNotifications.forEach(n => n.remove());
            
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.textContent = message;
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.style.opacity = '0';
                setTimeout(() => {
                    if (document.body.contains(notification)) {
                        document.body.removeChild(notification);
                    }
                }, 300);
            }, 3000);
        }

        // ===== SISTEMA DE LOGIN =====
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await login();
        });

        async function login() {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const loginBtn = document.getElementById('login-btn');
            const errorDiv = document.getElementById('login-error');

            if (!validateEmail(email)) {
                showNotification('E-mail inválido', 'error');
                return;
            }

            if (password.length < 6) {
                showNotification('Senha deve ter pelo menos 6 caracteres', 'error');
                return;
            }

            loginBtn.disabled = true;
            loginBtn.innerHTML = '🔄 Entrando...';
            errorDiv.style.display = 'none';

            try {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (error) throw error;

                currentUser = data.user;
                document.getElementById('user-name').textContent = currentUser.email.split('@')[0];

                document.getElementById('login-container').style.display = 'none';
                document.getElementById('main-system').style.display = 'block';
                document.getElementById('main-system-footer').style.display = 'block';

                if (currentUser.email.includes('adm')) {
                    document.getElementById('adm-report-btn').style.display = 'block';
                    isAdm = true;
                }

                await loadInitialData();
                showNotification('Login realizado com sucesso!', 'success');

            } catch (error) {
                console.error('Erro no login:', error);
                document.getElementById('login-error-message').textContent = error.message;
                errorDiv.style.display = 'block';
                showNotification('Erro no login: ' + error.message, 'error');
            } finally {
                loginBtn.disabled = false;
                loginBtn.innerHTML = '🚀 ENTRAR NO SISTEMA';
            }
        }

        async function logout() {
            try {
                await supabase.auth.signOut();
                currentUser = null;
                allParticipants = [];
                isAdm = false;
                activeEvent = null;
                eventRegistrations = [];
                document.getElementById('adm-report-btn').style.display = 'none';
                document.getElementById('login-container').style.display = 'flex';
                document.getElementById('main-system').style.display = 'none';
                document.getElementById('main-system-footer').style.display = 'none';
                showNotification('Logout realizado com sucesso!', 'success');
            } catch (error) {
                console.error('Erro no logout:', error);
                showNotification('Erro no logout', 'error');
            }
        }

        // ===== CARREGAMENTO DE DADOS =====
        async function loadInitialData() {
            try {
                showNotification('Carregando dados...', 'info');
                await loadParticipants();
                await updateStats();
                await loadAtendentes();
                showNotification('Dados carregados com sucesso!', 'success');
            } catch (error) {
                console.error('Erro ao carregar dados:', error);
                showNotification('Erro ao carregar dados iniciais', 'error');
            }
        }

        async function loadParticipants() {
            try {
                allParticipants = [];
                let page = 0;
                let keepFetching = true;

                while (keepFetching) {
                    const from = page * PARTICIPANT_CHUNK_SIZE;
                    const to = from + PARTICIPANT_CHUNK_SIZE - 1;

                    const { data, error } = await supabase
                        .from('inscricoes')
                        .select('*')
                        .eq('status', 'ATIVO')
                        .order('data_inscricao', { ascending: false })
                        .range(from, to);

                    if (error) {
                        console.error('Erro Supabase:', error);
                        throw error;
                    }

                    if (!data || data.length === 0) {
                        keepFetching = false;
                    } else {
                        allParticipants = allParticipants.concat(data);
                        page += 1;
                        if (data.length < PARTICIPANT_CHUNK_SIZE) {
                            keepFetching = false;
                        }
                    }
                }

                console.log('✅ Participantes carregados:', allParticipants.length);

            } catch (error) {
                console.error('❌ Erro ao carregar participantes:', error);
                showNotification('Erro ao conectar com servidor: ' + error.message, 'error');
                throw error;
            }
        }

        async function loadAtendentes() {
            try {
                // Carrega atendentes da tabela de pagamentos, que é mais precisa
                const { data, error } = await supabase
                    .from('pagamentos_históricos')
                    .select('atendente');

                if (error) throw error;

                const atendentes = [...new Set(data
                    .map(p => p.atendente)
                    .filter(a => a && a.trim() !== '')
                )];
                
                const select = document.getElementById('filter-atendente');
                
                while (select.children.length > 1) {
                    select.removeChild(select.lastChild);
                }
                
                atendentes.forEach(atendente => {
                    const option = document.createElement('option');
                    option.value = atendente;
                    option.textContent = atendente;
                    select.appendChild(option);
                });
                
                console.log('📋 Atendentes carregados:', atendentes);
            } catch (error) {
                console.error('Erro ao carregar atendentes:', error);
            }
        }

        async function updateStats() {
            try {
                const pagantes = allParticipants.filter(p => 
                    (p.status_pagamento === 'PAGO PARCIALMENTE' || p.status_pagamento === 'PAGO') &&
                    p.valor_pago && parseFloat(p.valor_pago.replace(',', '.')) >= 150
                );
                
                const homens = pagantes.filter(p => p.sexo === 'MASCULINO').length;
                const mulheres = pagantes.filter(p => p.sexo === 'FEMININO').length;
                const total = pagantes.length;

                document.getElementById('total-homens').textContent = homens;
                document.getElementById('total-mulheres').textContent = mulheres;
                document.getElementById('total-inscricoes').textContent = total;

            } catch (error) {
                console.error('Erro ao atualizar estatísticas:', error);
            }
        }

        // ===== SISTEMA DE BUSCA =====
        document.getElementById('search-btn').addEventListener('click', searchParticipants);
        document.getElementById('search-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchParticipants();
        });

        document.getElementById('search-name').addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        async function searchParticipants() {
            const searchTerm = document.getElementById('search-name').value.trim();
            const statusDiv = document.getElementById('search-status');
            const resultsContainer = document.getElementById('results-container');

            if (!searchTerm) {
                statusDiv.textContent = 'Digite um nome para buscar';
                return;
            }

            statusDiv.innerHTML = '<div class="loading"></div>';
            
            try {
                console.log('🔍 Buscando por:', searchTerm);
                
                const { data: participantesEncontrados, error } = await supabase
                    .from('inscricoes')
                    .select('*')
                    .eq('status', 'ATIVO')
                    .or(`nome_completo.ilike.%${searchTerm}%,whatsapp.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
                    .order('data_inscricao', { ascending: false })
                    .limit(20);

                if (error) {
                    console.error('❌ Erro na busca Supabase:', error);
                    throw error;
                }

                if (!participantesEncontrados || participantesEncontrados.length === 0) {
                    statusDiv.textContent = 'Nenhum participante encontrado';
                    resultsContainer.innerHTML = `
                        <div style="text-align: center; padding: 40px; color: #666;">
                            <div style="font-size: 2em; margin-bottom: 10px;">🔍</div>
                            <div>Nenhum resultado encontrado para "${searchTerm}"</div>
                        </div>
                    `;
                    return;
                }

                statusDiv.textContent = `${participantesEncontrados.length} participante(s) encontrado(s)`;
                displaySearchResults(participantesEncontrados);

            } catch (error) {
                console.error('❌ Erro na busca:', error);
                statusDiv.textContent = 'Erro na busca';
                showNotification('Erro ao buscar participantes: ' + error.message, 'error');
            }
        }

        function displaySearchResults(participants) {
            const container = document.getElementById('results-container');
            
            if (participants.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Nenhum resultado encontrado</div>';
                return;
            }

            container.innerHTML = participants.map(participant => {
                const statusClass = getStatusClass(participant.status_pagamento);
                const statusText = getStatusText(participant.status_pagamento);

                return `
                    <div class="person-card" onclick="showParticipantDetails('${participant.id}')">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h3 style="color: var(--primary); margin: 0;">${participant.nome_completo || 'Nome não informado'}</h3>
                            <span class="btn btn-${statusClass}" style="padding: 5px 10px; font-size: 0.8em;">${statusText}</span>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9em; color: var(--text-light);">
                            <div><strong>📱 WhatsApp:</strong> ${participant.whatsapp || 'Não informado'}</div>
                            <div><strong>👥 Sexo:</strong> ${participant.sexo || 'Não informado'}</div>
                            <div><strong>💰 Valor Pago:</strong> ${participant.valor_pago || 'Não informado'}</div>
                            <div><strong>💳 Forma:</strong> ${participant.forma_pagamento || 'Não informado'}</div>
                            <div><strong>🎯 Função:</strong> ${participant.vai_servir_receber || 'Não informado'}</div>
                            <div><strong>👤 Atendente:</strong> ${participant.atendente || 'Não informado'}</div>
                        </div>
                        
                        <div style="margin-top: 15px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                            <button onclick="event.stopPropagation(); openPaymentsModal('${participant.id}')" class="btn btn-success" style="padding: 8px; font-size: 0.8em;">
                                💰 Pagamentos
                            </button>
                            <button onclick="event.stopPropagation(); showParticipantDetails('${participant.id}')" class="btn btn-info" style="padding: 8px; font-size: 0.8em;">
                                📋 Detalhes
                            </button>
                            <button onclick="event.stopPropagation(); openEmailModal('${participant.id}')" class="btn btn-warning" style="padding: 8px; font-size: 0.8em;">
                                📧 E-mail
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // ===== SISTEMA DE PAGAMENTOS MÚLTIPLOS =====
        async function openPaymentsModal(participantId) {
            console.log('💰 Abrindo modal de pagamentos para:', participantId);
            
            try {
                const participant = await getParticipantById(participantId);
                currentParticipant = participant;

                document.getElementById('payments-participant-info').innerHTML = `
                    <h4 style="color: var(--primary); margin-bottom: 10px;">${participant.nome_completo}</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 0.9em;">
                        <div><strong>WhatsApp:</strong> ${participant.whatsapp}</div>
                        <div><strong>Status Atual:</strong> ${getStatusText(participant.status_pagamento)}</div>
                        <div><strong>Valor na Tabela:</strong> ${participant.valor_pago || 'N/A'}</div>
                    </div>
                `;

                await loadPaymentHistory(participantId);
                
                setTimeout(() => {
                    const totalPaidText = document.getElementById('total-paid').textContent;
                    const totalPaid = parseFloat(totalPaidText.replace('R$ ', '').replace(',', '.')) || 0;
                    const remaining = Math.max(0, 550 - totalPaid);
                    
                    if (remaining > 0) {
                        document.getElementById('new-payment-value').value = remaining.toFixed(2).replace('.', ',');
                    } else {
                        document.getElementById('new-payment-value').value = '';
                    }
                    
                    document.getElementById('new-payment-method').value = '';
                    document.getElementById('new-payment-obs').value = '';
                }, 500);
                
                document.getElementById('payments-modal').style.display = 'flex';
                
            } catch (error) {
                console.error('❌ Erro ao abrir modal de pagamentos:', error);
                showNotification('Erro ao abrir pagamentos: ' + error.message, 'error');
            }
        }

        async function loadPaymentHistory(participantId) {
            try {
                const { data, error } = await supabase
                    .from('pagamentos_históricos')
                    .select('*')
                    .eq('inscricao_id', participantId)
                    .order('criado_em', { ascending: false });

                if (error) throw error;

                const payments = data || [];
                displayPaymentHistory(payments);
                updatePaymentSummary(payments);

            } catch (error) {
                console.error('Erro ao carregar histórico:', error);
                showNotification('Erro ao carregar histórico de pagamentos', 'error');
            }
        }

        function displayPaymentHistory(payments) {
            const container = document.getElementById('payments-history');
            
            if (payments.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Nenhum pagamento registrado</div>';
                return;
            }

            container.innerHTML = payments.map(payment => `
                <div style="border: 1px solid #333; border-radius: 8px; padding: 15px; margin-bottom: 10px; background: #222;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; align-items: center;">
                        <div>
                            <strong style="color: var(--primary);">${formatCurrency(payment.valor_pago)}</strong>
                        </div>
                        <div>
                            <span class="btn btn-info" style="padding: 4px 8px; font-size: 0.7em;">${payment.forma_pagamento}</span>
                        </div>
                        <div style="font-size: 0.8em; color: #ccc;">
                            ${formatDateTime(convertToLocalTime(payment.data_pagamento))}
                        </div>
                        <div style="text-align: right;">
                            <button onclick="deletePayment(${payment.id})" class="btn btn-danger" style="padding: 4px 8px; font-size: 0.7em;">
                                🗑️
                            </button>
                        </div>
                    </div>
                    ${payment.observacoes ? `<div style="margin-top: 8px; font-size: 0.8em; color: #999;">📝 ${payment.observacoes}</div>` : ''}
                    <div style="margin-top: 5px; font-size: 0.7em; color: #666;">Atendente: ${payment.atendente || 'N/A'}</div>
                </div>
            `).join('');
        }

        function updatePaymentSummary(payments) {
            const totalPaid = payments.reduce((sum, payment) => sum + parseFloat(payment.valor_pago), 0);
            const remaining = Math.max(0, 550 - totalPaid);

            document.getElementById('total-paid').textContent = `R$ ${totalPaid.toFixed(2).replace('.', ',')}`;
            document.getElementById('remaining-amount').textContent = `R$ ${remaining.toFixed(2).replace('.', ',')}`;
        }

        async function forceSyncInscricaoWithHistory(participantId) {
            try {
                console.log('🔄 Forçando sincronização para participante:', participantId);
                
                const { data: payments, error } = await supabase
                    .from('pagamentos_históricos')
                    .select('*')
                    .eq('inscricao_id', participantId);

                if (error) throw error;

                const totalPaid = payments.reduce((sum, payment) => {
                    const valor = parseFloat(payment.valor_pago);
                    return sum + (isNaN(valor) ? 0 : valor);
                }, 0);

                let newStatus, newFormaPagamento;

                if (totalPaid >= 550) {
                    newStatus = 'PAGO';
                } else if (totalPaid >= 150 && totalPaid < 550) {
                    newStatus = 'PAGO PARCIALMENTE';
                } else {
                    newStatus = 'PENDENTE';
                }

                const formas = [...new Set(payments.map(p => p.forma_pagamento))];
                newFormaPagamento = formas.length > 1 ? 'MÚLTIPLAS FORMAS' : (formas[0] || 'N/A');

                let confirmationDate = null;
                if (totalPaid >= 150) {
                    const sortedPayments = payments.sort((a, b) => {
                        const dateA = new Date(a.criado_em || '1970-01-01');
                        const dateB = new Date(b.criado_em || '1970-01-01');
                        return dateA - dateB;
                    });
                    
                    let accumulated = 0;
                    for (const payment of sortedPayments) {
                        accumulated += parseFloat(payment.valor_pago);
                        if (accumulated >= 150) {
                            confirmationDate = payment.criado_em || new Date().toISOString();
                            break;
                        }
                    }
                }

                const { error: updateError } = await supabase
                    .from('inscricoes')
                    .update({
                        status_pagamento: newStatus,
                        valor_pago: totalPaid.toFixed(2).replace('.', ','),
                        forma_pagamento: newFormaPagamento,
                        data_confirmacao_pagamento: confirmationDate,
                        atendente: currentUser.email.split('@')[0],
                        data_ultima_atualizacao: new Date().toISOString()
                    })
                    .eq('id', participantId);

                if (updateError) throw updateError;

                const participantIndex = allParticipants.findIndex(p => p.id == participantId);
                if (participantIndex !== -1) {
                    allParticipants[participantIndex].status_pagamento = newStatus;
                    allParticipants[participantIndex].valor_pago = totalPaid.toFixed(2).replace('.', ',');
                    allParticipants[participantIndex].forma_pagamento = newFormaPagamento;
                }

                return { totalPaid, newStatus, newFormaPagamento };

            } catch (error) {
                console.error('❌ Erro na sincronização forçada:', error);
                throw error;
            }
        }

        async function addNewPayment() {
            const value = document.getElementById('new-payment-value').value.trim();
            const method = document.getElementById('new-payment-method').value;
            const obs = document.getElementById('new-payment-obs').value.trim();

            if (!value && !method && obs) {
                if (!confirm(`Salvar apenas a observação "${obs}" sem adicionar pagamento?`)) {
                    return;
                }
                
                try {
                    const { data: currentData, error: fetchError } = await supabase
                        .from('inscricoes')
                        .select('observacoes')
                        .eq('id', currentParticipant.id)
                        .single();
                        
                    if (fetchError) throw fetchError;
                    
                    const timestamp = new Date().toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit', 
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    const newObservation = `[${timestamp}] ${obs}`;
                    const updatedObservations = currentData.observacoes ? 
                        `${currentData.observacoes} | ${newObservation}` : 
                        newObservation;
                    
                    const { error: updateError } = await supabase
                        .from('inscricoes')
                        .update({
                            observacoes: updatedObservations,
                            data_ultima_atualizacao: new Date().toISOString(),
                            atendente: currentUser.email.split('@')[0]
                        })
                        .eq('id', currentParticipant.id);
                        
                    if (updateError) throw updateError;
                    
                    document.getElementById('new-payment-obs').value = '';
                    
                    showNotification(`Observação "${obs}" salva com sucesso!`, 'success');
                    return;
                    
                } catch (error) {
                    console.error('❌ Erro ao salvar observação:', error);
                    showNotification('Erro ao salvar observação: ' + error.message, 'error');
                    return;
                }
            }

            if (!value || !method) {
                showNotification('Preencha valor e forma de pagamento', 'error');
                return;
            }

            const numericValue = parseFloat(value.replace(',', '.'));
            if (isNaN(numericValue) || numericValue <= 0) {
                showNotification('Valor inválido', 'error');
                return;
            }

            if (numericValue > 550) {
                alert('❌ ATENÇÃO!\n\nValor máximo permitido é R$ 550,00\n\nDigite um valor menor.');
                document.getElementById('new-payment-value').focus();
                return;
            }

            try {
                const { data: pagamentosExistentes } = await supabase
                    .from('pagamentos_históricos')
                    .select('valor_pago')
                    .eq('inscricao_id', currentParticipant.id);
                
                const totalRealPago = pagamentosExistentes ? 
                    pagamentosExistentes.reduce((sum, p) => sum + parseFloat(p.valor_pago), 0) : 0;
                
                if (totalRealPago + numericValue > 550) {
                    const maxAllowed = 550 - totalRealPago;
                    alert(`❌ ATENÇÃO!\n\nEste pagamento excederia o limite de R$ 550,00\n\nTotal já pago: R$ ${totalRealPago.toFixed(2).replace('.', ',')}\nMáximo permitido: R$ ${maxAllowed.toFixed(2).replace('.', ',')}`);
                    document.getElementById('new-payment-value').value = maxAllowed > 0 ? maxAllowed.toFixed(2).replace('.', ',') : '0,00';
                    return;
                }

                const { error: insertError } = await supabase
                    .from('pagamentos_históricos')
                    .insert({
                        inscricao_id: currentParticipant.id,
                        nome_participante: currentParticipant.nome_completo, // Salva o nome no histórico
                        valor_pago: numericValue,
                        forma_pagamento: method,
                        atendente: currentUser.email.split('@')[0],
                        observacoes: obs || null
                    });

                if (insertError) throw insertError;

                await forceSyncInscricaoWithHistory(currentParticipant.id);
                await loadParticipants(); // Recarrega todos os participantes para ter dados frescos
                await loadPaymentHistory(currentParticipant.id);
                await updateStats();
                
                if (document.getElementById('dashboard-container').style.display !== 'none') {
                    updateDashboard();
                }
                
                searchParticipants();

                showNotification('Pagamento adicionado com sucesso!', 'success');

                document.getElementById('new-payment-value').value = '';
                document.getElementById('new-payment-method').value = '';
                document.getElementById('new-payment-obs').value = '';

                setTimeout(() => {
                    generateReceipt(currentParticipant.id);
                }, 1000);

            } catch (error) {
                console.error('Erro ao adicionar pagamento:', error);
                showNotification('Erro ao adicionar pagamento: ' + error.message, 'error');
            }
        }

        async function deletePayment(paymentId) {
            if (!confirm('Tem certeza que deseja excluir este pagamento?')) return;

            try {
                const { error } = await supabase
                    .from('pagamentos_históricos')
                    .delete()
                    .eq('id', paymentId);

                if (error) throw error;

                await forceSyncInscricaoWithHistory(currentParticipant.id);
                await loadPaymentHistory(currentParticipant.id);
                await updateStats();
                searchParticipants();

                showNotification('Pagamento excluído com sucesso!', 'success');

            } catch (error) {
                console.error('Erro ao excluir pagamento:', error);
                showNotification('Erro ao excluir pagamento: ' + error.message, 'error');
            }
        }

        function closePaymentsModal() {
            document.getElementById('payments-modal').style.display = 'none';
            currentParticipant = null;
        }

        // ===== DASHBOARD =====
        function showDashboard() {
            document.getElementById('main-content').style.display = 'none';
            document.getElementById('dashboard-container').style.display = 'block';
            updateDashboard();
        }

        function hideDashboard() {
            document.getElementById('main-content').style.display = 'block';
            document.getElementById('dashboard-container').style.display = 'none';
        }

        function resetDashboardMetrics() {
             document.getElementById('dash-total-inscricoes').textContent = 0;
            document.getElementById('dash-pre-inscricoes').textContent = 0;
            document.getElementById('dash-pagos-completo').textContent = 0;
            document.getElementById('total-arrecadado').textContent = 'R$ 0,00';
            
            const zeroCard = (id) => {
                document.getElementById(id).innerHTML = `
                    <div style="font-size: 1.8em; font-weight: bold;">0</div>
                    <div style="font-size: 0.9em;">R$ 0,00</div>
                `;
            };
            
            zeroCard('dash-valor-pix');
            zeroCard('dash-valor-dinheiro');
            zeroCard('dash-valor-cartao');
            zeroCard('dash-valor-debito');
            zeroCard('dash-valor-recibo');
            
            document.getElementById('inscricoes-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center; color: #666;">Nenhum resultado encontrado</td></tr>';
        }

        async function updateDashboard() {
            console.log('🔄 Atualizando dashboard com lógica corrigida...');

            try {
                const filterData = document.getElementById('filter-data').value;
                const filterAtendente = document.getElementById('filter-atendente').value;
                const filterForma = document.getElementById('filter-forma').value;
                const filterStatus = document.getElementById('filter-status').value;

                // 1. Carrega pagamentos aplicando filtros diretos
                let payQuery = supabase.from('pagamentos_históricos').select('*');

                const dateRange = getUTCDateRangeForLocalDate(filterData);
                if (dateRange) {
                    payQuery = payQuery
                        .gte('data_pagamento', dateRange.start)
                        .lte('data_pagamento', dateRange.end);
                }

                const normalizedAtendente = filterAtendente ? filterAtendente.trim() : '';
                if (normalizedAtendente) {
                    payQuery = payQuery.ilike('atendente', normalizedAtendente);
                }

                if (filterForma) payQuery = payQuery.eq('forma_pagamento', filterForma);

                const { data: pagamentos, error: payError } = await payQuery;
                if (payError) throw payError;

                if (!pagamentos || pagamentos.length === 0) {
                    resetDashboardMetrics();
                    console.log('Nenhum pagamento encontrado para os filtros selecionados.');
                    return;
                }

                // 2. Carrega status dos participantes apenas para os pagamentos encontrados
                const participantsInfo = await fetchParticipantsStatus(
                    pagamentos.map(p => p.inscricao_id)
                );

                let { pagamentos: filteredPayments, participants: filteredParticipants } =
                    applyStatusFilter(pagamentos, participantsInfo, filterStatus);

                if (!filteredPayments.length) {
                    resetDashboardMetrics();
                    console.log('Nenhum pagamento encontrado após aplicar filtro de status.');
                    return;
                }

                const participantLookup = new Map(
                    filteredParticipants.map(p => [p.id, p])
                );
                const participantsForMetrics = [...new Set(filteredPayments.map(p => p.inscricao_id))]
                    .map(id => participantLookup.get(id) || { id, status_pagamento: 'N/A' });

                // 3. Calcula estatísticas financeiras com base nos pagamentos filtrados
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

                // 4. Atualiza métricas visuais
                document.getElementById('dash-total-inscricoes').textContent = participantsForMetrics.length;
                document.getElementById('dash-pagos-completo').textContent = participantsForMetrics.filter(p => p.status_pagamento === 'PAGO').length;
                document.getElementById('dash-pre-inscricoes').textContent = participantsForMetrics.filter(p => p.status_pagamento === 'PAGO PARCIALMENTE').length;

                document.getElementById('total-arrecadado').textContent =
                    `R$ ${stats.totalArrecadado.toFixed(2).replace('.', ',')}`;

                const updateFormaCard = (id, forma) => {
                    document.getElementById(id).innerHTML = `
                        <div style="font-size: 1.8em; font-weight: bold;">${stats.formas[forma]?.qtd || 0}</div>
                        <div style="font-size: 0.9em;">R$ ${stats.formas[forma]?.valor.toFixed(2).replace('.', ',') || '0,00'}</div>
                    `;
                };

                updateFormaCard('dash-valor-pix', 'PIX');
                updateFormaCard('dash-valor-dinheiro', 'DINHEIRO');
                updateFormaCard('dash-valor-cartao', 'CARTÃO DE CRÉDITO');
                updateFormaCard('dash-valor-debito', 'CARTÃO DE DÉBITO');
                updateFormaCard('dash-valor-recibo', 'RECIBO');

                // 5. Atualiza tabela detalhada
                await updateInscricoesTableFromPayments(filteredPayments);

                console.log(`✅ Dashboard: ${participantsForMetrics.length} participantes, R$ ${stats.totalArrecadado.toFixed(2)}`);

            } catch (error) {
                console.error('❌ Erro no dashboard:', error);
                showNotification('Erro ao atualizar dashboard: ' + error.message, 'error');
            }
        }


        async function updateInscricoesTableFromPayments(pagamentos) {
            const tbody = document.getElementById('inscricoes-tbody');

            if (!tbody) {
                console.error('❌ Elemento inscricoes-tbody não encontrado');
                return;
            }

            if (!pagamentos || pagamentos.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #666;">Nenhum resultado encontrado</td></tr>';
                return;
            }

            try {
                const linhas = pagamentos.map(p => {
                    const dataPagamento = new Date(p.data_pagamento).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit', 
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                    const valorFormatado = `R$ ${parseFloat(p.valor_pago).toFixed(2).replace('.', ',')}`;

                    return `
                        <tr style="cursor: pointer; border-bottom: 1px solid #333;" onclick="showParticipantDetails('${p.inscricao_id}')">
                            <td style="padding: 10px;">${p.nome_participante || 'N/A'}</td>
                            <td style="padding: 10px;">${p.forma_pagamento || 'N/A'}</td>
                            <td style="padding: 10px; text-align: left;">
                                <strong style="color: #22c55e;">${valorFormatado}</strong>
                            </td>
                            <td style="padding: 10px;">${p.atendente || 'N/A'}</td>
                            <td style="padding: 10px;">${dataPagamento}</td>
                        </tr>
                    `;
                });

                tbody.innerHTML = linhas.join('');

            } catch (error) {
                console.error('❌ Erro ao atualizar tabela:', error);
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #ff6666;">Erro ao carregar dados</td></tr>';
            }
        }


        // ===== DETALHES DO PARTICIPANTE (COM EDIÇÃO) =====
        async function updateParticipantField(participantId, field, value) {
            // Converte para maiúsculas se for string
            const finalValue = typeof value === 'string' ? value.toUpperCase() : value;
            
            try {
                const { error } = await supabase
                    .from('inscricoes')
                    .update({ 
                        [field]: finalValue, 
                        data_ultima_atualizacao: new Date().toISOString() 
                    })
                    .eq('id', participantId);
                
                if (error) throw error;
                
                // Atualiza o cache local
                const participant = allParticipants.find(p => p.id == participantId);
                if (participant) {
                    participant[field] = finalValue;
                    // Se o nome for atualizado, atualiza o histórico também
                    if (field === 'nome_completo') {
                        await supabase.from('pagamentos_históricos')
                            .update({ nome_participante: finalValue })
                            .eq('inscricao_id', participantId);
                    }
                }
                
                showNotification(`${field.replace('_', ' ')} atualizado!`, 'success');
                searchParticipants(); // Atualiza a lista de busca
                
            } catch (error) {
                console.error(`Erro ao atualizar ${field}:`, error);
                showNotification(`Erro ao atualizar ${field}: ` + error.message, 'error');
            }
        }
        
        async function showParticipantDetails(participantId) {
            console.log('📋 Abrindo detalhes para:', participantId);
            
            try {
                const participant = await getParticipantById(participantId);
                const showDeleteButton = currentUser && currentUser.email.includes('adm');

                const content = `
                    <div style="margin-bottom: 20px;">
                        <h4 style="color: var(--primary); margin-bottom: 15px;">👤 Informações Pessoais</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Nome:</label>
                                <input type="text" id="edit-name" class="input" value="${participant.nome_completo || ''}" 
                                    onblur="updateParticipantField('${participantId}', 'nome_completo', this.value)">
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">WhatsApp:</label>
                                <input type="text" id="edit-whatsapp" class="input" value="${participant.whatsapp || ''}" 
                                    onblur="updateParticipantField('${participantId}', 'whatsapp', this.value)">
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">E-mail:</label>
                                <input type="email" id="edit-email" class="input" value="${participant.email || ''}" 
                                    onblur="updateParticipantField('${participantId}', 'email', this.value.toLowerCase())">
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Sexo:</label>
                                <select id="edit-sexo" class="input" onchange="updateParticipantField('${participantId}', 'sexo', this.value)">
                                    <option value="MASCULINO" ${participant.sexo === 'MASCULINO' ? 'selected' : ''}>MASCULINO</option>
                                    <option value="FEMININO" ${participant.sexo === 'FEMININO' ? 'selected' : ''}>FEMININO</option>
                                </select>
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Idade:</label>
                                <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${participant.idade || 'N/A'}</div>
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Cidade:</label>
                                <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${participant.cidade || 'N/A'}</div>
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <h4 style="color: var(--primary); margin-bottom: 15px;">🎯 Informações do Retiro</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Função no Retiro:</label>
                                <select id="edit-funcao" class="input" onchange="updateParticipantField('${participantId}', 'vai_servir_receber', this.value)">
                                    <option value="TRABALHO" ${participant.vai_servir_receber === 'TRABALHO' ? 'selected' : ''}>TRABALHO</option>
                                    <option value="ENCONTRISTA" ${participant.vai_servir_receber === 'ENCONTRISTA' ? 'selected' : ''}>ENCONTRISTA</option>
                                </select>
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Cor da Rede / Unidade:</label>
                                <select id="edit-rede" class="input" onchange="updateParticipantField('${participantId}', 'cor_rede', this.value)">
                                    <option value="">Selecione...</option>
                                    <option value="BRANCA" ${participant.cor_rede === 'BRANCA' ? 'selected' : ''}>🤍 Rede Branca</option>
                                    <option value="AZUL" ${participant.cor_rede === 'AZUL' ? 'selected' : ''}>💙 Rede Azul</option>
                                    <option value="AMARELA" ${participant.cor_rede === 'AMARELA' ? 'selected' : ''}>💛 Rede Amarela</option>
                                    <option value="VERMELHA" ${participant.cor_rede === 'VERMELHA' ? 'selected' : ''}>❤️ Rede Vermelha</option>
                                    <option value="VERDE" ${participant.cor_rede === 'VERDE' ? 'selected' : ''}>💚 Rede Verde</option>
                                    <option value="MARROM" ${participant.cor_rede === 'MARROM' ? 'selected' : ''}>🤎 Rede Marrom</option>
                                    <option value="ROXA" ${participant.cor_rede === 'ROXA' ? 'selected' : ''}>💜 Rede Roxa</option>
                                    
                                    <option value="ALVO SJP" ${participant.cor_rede === 'ALVO SJP' ? 'selected' : ''}>📍 Alvo SJP</option>
                                    <option value="ALVO ITAPECERICA" ${participant.cor_rede === 'ALVO ITAPECERICA' ? 'selected' : ''}>📍 Alvo Itapecerica</option>
                                    <option value="ALVO MONTE MOR" ${participant.cor_rede === 'ALVO MONTE MOR' ? 'selected' : ''}>📍 Alvo Monte Mor</option>
                                    <option value="ALVO CAMPINAS" ${participant.cor_rede === 'ALVO CAMPINAS' ? 'selected' : ''}>📍 Alvo Campinas</option>
                                    <option value="ALVO LITORAL PR" ${participant.cor_rede === 'ALVO LITORAL PR' ? 'selected' : ''}>📍 Alvo Litoral PR</option>
                                    
                                    <option value="NÃO-POSSUO" ${participant.cor_rede === 'NÃO-POSSUO' ? 'selected' : ''}>🆕 Não possuo rede ainda</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <h4 style="color: var(--primary); margin-bottom: 15px;">🏥 Saúde e Acessibilidade</h4>
                        <div>
                            <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Observações:</label>
                            <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px; white-space: pre-wrap;">${participant.observacoes_saude || 'N/A'}</div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <h4 style="color: var(--primary); margin-bottom: 15px;">💰 Informações de Pagamento</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Status:</label>
                                <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${getStatusText(participant.status_pagamento)}</div>
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Valor Pago:</label>
                                <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${participant.valor_pago || 'N/A'}</div>
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Forma de Pagamento:</label>
                                <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${participant.forma_pagamento || 'N/A'}</div>
                            </div>
                            <div>
                                <label style="color: var(--text-light); margin-bottom: 5px; display: block;">Atendente:</label>
                                <div style="color: white; background: #222; padding: 12px; border-radius: 5px; font-size: 16px;">${participant.atendente || 'N/A'}</div>
                            </div>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: ${showDeleteButton ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr'}; gap: 10px; margin-top: 20px;">
                        <button onclick="openPaymentsModal('${participantId}')" class="btn btn-success">💰 Gerenciar Pagamentos</button>
                        <button onclick="generateReceipt('${participantId}')" class="btn btn-info">🧾 Gerar Recibo</button>
                        <button onclick="emailReceiptFromModal()" class="btn btn-warning">📧 Enviar E-mail</button>
                        ${showDeleteButton ? `<button onclick="deleteParticipant('${participantId}')" class="btn btn-danger">🗑️ Excluir</button>` : ''}
                    </div>
                `;

                document.getElementById('details-content').innerHTML = content;
                document.getElementById('details-modal').style.display = 'flex';
                
            } catch (error) {
                console.error('❌ Erro ao abrir detalhes:', error);
                showNotification('Erro ao abrir detalhes: ' + error.message, 'error');
            }
        }

        function closeDetailsModal() {
            document.getElementById('details-modal').style.display = 'none';
        }

        async function deleteParticipant(participantId) {
            if (!confirm('Tem certeza que deseja CANCELAR esta inscrição?')) {
                return;
            }

            try {
                const { error } = await supabase
                    .from('inscricoes')
                    .update({ status: 'CANCELADO' })
                    .eq('id', participantId);

                if (error) throw error;

                allParticipants = allParticipants.filter(p => p.id != participantId);

                closeDetailsModal();
                await updateStats();
                searchParticipants();
                
                showNotification('Inscrição cancelada com sucesso!', 'success');

            } catch (error) {
                console.error('Erro ao cancelar participante:', error);
                showNotification('Erro ao cancelar inscrição: ' + error.message, 'error');
            }
        }

        // ===== SISTEMA DE E-MAIL =====
        function openEmailModal(participantId) {
            const participant = allParticipants.find(p => p.id == participantId);
            if (!participant) return;

            document.getElementById('email-participant-name').textContent = participant.nome_completo;
            document.getElementById('email-input').value = participant.email || '';
            
            const summary = `
                Nome: ${participant.nome_completo}
                WhatsApp: ${participant.whatsapp}
                Rede/Unidade: ${participant.cor_rede || 'N/A'}
                Status: ${getStatusText(participant.status_pagamento)}
                Valor Pago: ${participant.valor_pago || 'N/A'}
                Forma Pagamento: ${participant.forma_pagamento || 'N/A'}
                Data Inscrição: ${new Date(participant.data_inscricao).toLocaleDateString('pt-BR')}
            `;
            
            document.getElementById('email-payment-summary').textContent = summary.replace(/  +/g, ''); // Remove excesso de espaço
            document.getElementById('email-modal').style.display = 'flex';
            
            currentParticipant = participant;
        }

        function closeEmailModal() {
            document.getElementById('email-modal').style.display = 'none';
            currentParticipant = null;
        }

        // ===== NOVO CÓDIGO PARA COLAR NO LUGAR =====

        async function sendEmailReceipt() {
            const email = document.getElementById('email-input').value;
            const btn = document.querySelector('#email-modal .btn-success'); // Pega o botão de enviar

            if (!email || !validateEmail(email) || !currentParticipant) {
                showNotification('Dados inválidos para envio', 'error');
                return;
            }

            // Desabilita o botão para evitar cliques duplos
            btn.disabled = true;
            btn.textContent = 'Enviando...';

            try {
                // 1. Pega o resumo que já estava no modal
                const summaryText = document.getElementById('email-payment-summary').textContent;
                
                // 2. Cria um HTML bonito para o corpo do e-mail
                // (Usamos replace para transformar as quebras de linha em <br>)
                const receiptBodyHTML = `
                    <html lang="pt-BR">
                    <head><style>body { font-family: Arial, sans-serif; line-height: 1.6; } pre { font-family: Arial, sans-serif; line-height: 1.6; white-space: pre-wrap; margin: 0; }</style></head>
                    <body>
                        <h2>Olá, ${currentParticipant.nome_completo}!</h2>
                        <p>Segue seu comprovante de inscrição para O Retiro 2026:</p>
                        <div style="background-color: #f4f4f4; padding: 15px; border-radius: 8px;">
                            <pre>${summaryText}</pre>
                        </div>
                        <br>
                        <p>Atenciosamente,<br>Equipe ALVO Curitiba</p>
                    </body>
                    </html>
                `;
                
                // 3. CHAMA A FUNÇÃO DE NUVEM (Edge Function)
                const { data, error } = await supabase.functions.invoke('send-receipt', {
                    body: {
                        toEmail: email,
                        participantName: currentParticipant.nome_completo,
                        receiptBody: receiptBodyHTML
                    }
                });

        if (error) {
            // Se a função de nuvem der erro
            throw error;
        }

        // 4. Sucesso!
        console.log('Resposta da função:', data);
        showNotification('E-mail enviado com sucesso para ' + email, 'success');
        closeEmailModal();

    } catch (error) {
        console.error('Erro ao chamar função:', error);
        showNotification('Erro ao enviar e-mail: ' + error.message, 'error');
    } finally {
        // Reabilita o botão, independentemente do resultado
        btn.disabled = false;
        btn.textContent = '📧 Enviar';
    }
}

        // ===== RECIBO =====
        async function generateReceipt(participantId) {
            try {
                const participant = await getParticipantById(participantId);

                const { data: payments, error } = await supabase
                    .from('pagamentos_históricos')
                    .select('*')
                    .eq('inscricao_id', participantId)
                    .order('data_pagamento', { ascending: true }); // Ascendente para histórico

                if (error) throw error;
                
                const today = new Date().toISOString().split('T')[0];
                let totalPago = 0;
                let pagoHoje = 0;
                let historyHTML = '';

                if (payments.length > 0) {
                    payments.forEach(p => {
                        const valor = parseFloat(p.valor_pago);
                        totalPago += valor;
                        
                        const paymentDate = new Date(p.data_pagamento).toISOString().split('T')[0];
                        if (paymentDate === today) {
                            pagoHoje += valor;
                        }
                        
                        historyHTML += `
                            <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; font-size: 0.9em;">
                                <span>${formatDateTime(convertToLocalTime(p.data_pagamento))}</span>
                                <span>${p.forma_pagamento}</span>
                                <span style="font-weight: bold;">${formatCurrency(p.valor_pago)}</span>
                            </div>
                        `;
                    });
                } else {
                    historyHTML = '<div style="text-align: center; color: #666; padding: 10px;">Nenhum pagamento registrado</div>';
                }

                const ultimoPagamento = payments.length > 0 ? payments[payments.length - 1] : null;

                const receiptHTML = `
                    <div class="receipt-header">
                        <h2 style="margin: 0; color: #ff6b35; font-size: 1.8em;">🏕️ O RETIRO 2026</h2>
                        <div style="font-weight: bold; margin: 5px 0;">VISÃO • MISSÃO • PRESSÃO</div>
                        <div style="font-size: 0.9em; color: #666;">COMPROVANTE DE PAGAMENTO</div>
                    </div>
                    
                    <div style="margin: 20px 0;">
                        <div style="margin-bottom: 8px;"><strong>PARTICIPANTE:</strong></div>
                        <div style="margin-bottom: 15px;">${participant.nome_completo}</div>
                        
                        <div style="margin-bottom: 8px;"><strong>WHATSAPP:</strong></div>
                        <div style="margin-bottom: 15px;">${participant.whatsapp || 'N/A'}</div>

                        <div style="margin-bottom: 8px;"><strong>REDE / UNIDADE:</strong></div>
                        <div style="margin-bottom: 15px;">${participant.cor_rede || 'N/A'}</div>
                        
                        <div style="margin-bottom: 8px;"><strong>VALOR TOTAL PAGO:</strong></div>
                        <div style="margin-bottom: 15px; font-size: 1.2em; font-weight: bold;">${formatCurrency(totalPago)}</div>
                        
                        <div style="margin-bottom: 8px;"><strong>VALOR PAGO HOJE (${new Date().toLocaleDateString('pt-BR')}):</strong></div>
                        <div style="margin-bottom: 15px;">${formatCurrency(pagoHoje)}</div>
                        
                        ${ultimoPagamento ? `
                        <div style="border-top: 1px dashed #333; margin: 15px 0; padding-top: 15px; background: #fef8e7; padding: 10px; border-radius: 5px;">
                            <div style="font-weight: bold; margin-bottom: 10px;">ÚLTIMO PAGAMENTO:</div>
                            <div style="margin-bottom: 5px;"><strong>Valor:</strong> ${formatCurrency(ultimoPagamento.valor_pago)}</div>
                            <div style="margin-bottom: 5px;"><strong>Forma:</strong> ${ultimoPagamento.forma_pagamento}</div>
                            <div style="margin-bottom: 5px;"><strong>Data:</strong> ${formatDateTime(convertToLocalTime(ultimoPagamento.data_pagamento))}</div>
                        </div>
                        ` : ''}

                        <div style="border-top: 1px dashed #333; margin: 15px 0; padding-top: 15px;">
                            <div style="font-weight: bold; margin-bottom: 10px;">HISTÓRICO COMPLETO:</div>
                            <div style="max-height: 150px; overflow-y: auto; background: #f9f9f9; padding: 10px; border-radius: 5px;">
                                ${historyHTML}
                            </div>
                        </div>
                    </div>
                    
                    <div class="receipt-footer">
                        <div style="text-align: center; margin-bottom: 10px;">
                            ${totalPago >= 550 ? 
                                '✅ <strong>INSCRIÇÃO CONFIRMADA!</strong>' : 
                                `⏳ <strong>Pendente: ${formatCurrency(550 - totalPago)}</strong>`
                            }
                        </div>
                        <div style="text-align: center; font-size: 0.8em;">
                            Gerado em: ${formatDateTime(new Date())}<br>
                            Sistema de Balcão - ALVO CURITIBA<br>
                            Atendente: ${currentUser ? currentUser.email.split('@')[0] : 'Sistema'}
                        </div>
                    </div>
                `;

                document.getElementById('receipt-content').innerHTML = receiptHTML;
                document.getElementById('receipt-print').innerHTML = receiptHTML; // Para impressão
                document.getElementById('receipt-modal').style.display = 'flex';
                
                currentReceipt = {
                    participant: participant,
                    content: receiptHTML,
                    ultimoPagamento: ultimoPagamento
                };

            } catch (error) {
                console.error('❌ Erro ao gerar recibo:', error);
                showNotification('Erro ao gerar recibo: ' + error.message, 'error');
            }
        }

        function closeReceiptModal() {
            document.getElementById('receipt-modal').style.display = 'none';
            currentReceipt = null;
        }

        function printReceipt() {
            if (!currentReceipt) return;
            
            document.getElementById('receipt-print').innerHTML = document.getElementById('receipt-content').innerHTML;
            window.print();
        }

        function emailReceiptFromModal() {
        // 1. Verificar se o recibo e o participante existem
        if (!currentReceipt || !currentReceipt.participant) {
            console.error('Dados do recibo ou participante não encontrados.');
            return;
        }
        
        // 2. Salvar o ID ANTES de fechar o modal
        const participantId = currentReceipt.participant.id;
        
        // 3. Fechar o modal do recibo (isso vai apagar currentReceipt)
        closeReceiptModal();
        
        // 4. Abrir o modal de e-mail usando o ID salvo
        openEmailModal(participantId);
    }

        // ===== RELATÓRIO ADM =====
        let admReportData = null;

        function openAdmReport() {
            document.getElementById('adm-report-modal').style.display = 'flex';
            document.getElementById('adm-report-content').innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Selecione o período e clique em Gerar Relatório</div>';
            document.getElementById('adm-export-btn').style.display = 'none';
            admReportData = null;
        }

        function closeAdmReportModal() {
            document.getElementById('adm-report-modal').style.display = 'none';
            admReportData = null;
        }

        async function generateAttendantReport() {
            const startDate = document.getElementById('adm-report-start').value;
            const endDate = document.getElementById('adm-report-end').value;
            const contentDiv = document.getElementById('adm-report-content');
            contentDiv.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="loading"></div> Carregando...</div>';
            document.getElementById('adm-export-btn').style.display = 'none';

            try {
                let query = supabase.from('pagamentos_históricos').select('*');

                if (startDate) {
                    const startRange = getUTCDateRangeForLocalDate(startDate);
                    if (startRange) query = query.gte('data_pagamento', startRange.start);
                }
                if (endDate) {
                    const endRange = getUTCDateRangeForLocalDate(endDate);
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

                admReportData = Object.entries(byAtendente)
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

                const totals = admReportData.reduce((acc, r) => ({
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

                const rows = admReportData.map(r => `
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

                document.getElementById('adm-export-btn').style.display = 'block';

            } catch (error) {
                console.error('❌ Erro ao gerar relatório ADM:', error);
                contentDiv.innerHTML = `<div style="text-align: center; padding: 40px; color: #ff6666;">Erro: ${error.message}</div>`;
                showNotification('Erro ao gerar relatório: ' + error.message, 'error');
            }
        }

        function exportAdmReport() {
            if (!admReportData) return;

            const startDate = document.getElementById('adm-report-start').value;
            const endDate = document.getElementById('adm-report-end').value;
            const fmt = v => parseFloat(v.toFixed(2));

            const totals = admReportData.reduce((acc, r) => ({
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
                ...admReportData.map(r => ({
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
            XLSX.utils.book_append_sheet(wb, ws, 'Fechamento por Atendente');
            const periodoStr = (startDate && endDate) ? `_${startDate}_a_${endDate}` : '';
            XLSX.writeFile(wb, `relatorio_atendentes${periodoStr}_${new Date().toISOString().split('T')[0]}.xlsx`);
            showNotification('Relatório exportado com sucesso!', 'success');
        }

        // ===== LISTA DE GANHADORES =====
        async function generateWinnersList() {
            try {
                const winners = allParticipants
                    .filter(p => (p.status_pagamento === 'PAGO PARCIALMENTE' || p.status_pagamento === 'PAGO') && p.data_confirmacao_pagamento)
                    .sort((a, b) => new Date(a.data_confirmacao_pagamento) - new Date(b.data_confirmacao_pagamento))
                    .slice(0, 150);

                const content = `
                    <div style="margin-bottom: 20px;">
                        <p style="color: var(--text-light);">Lista dos primeiros 150 participantes que efetuaram pagamento (>= R$ 150,00).</p>
                        <p style="color: var(--warning); font-weight: bold;">Total de ganhadores: ${winners.length}/150</p>
                    </div>
                    
                    <div style="max-height: 60vh; overflow-y: auto;">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Nome</th>
                                    <th>Sexo</th>
                                    <th>WhatsApp</th>
                                    <th>Status</th>
                                    <th>Data Pagamento</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${winners.map((participant, index) => `
                                    <tr>
                                        <td>${index + 1}</td>
                                        <td>${participant.nome_completo}</td>
                                        <td>${participant.sexo}</td>
                                        <td>${participant.whatsapp}</td>
                                        <td><span class="btn btn-${getStatusClass(participant.status_pagamento)}" style="padding: 2px 6px; font-size: 0.7em;">${getStatusText(participant.status_pagamento)}</span></td>
                                        <td>${formatDateTime(convertToLocalTime(participant.data_confirmacao_pagamento))}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;

                document.getElementById('winners-content').innerHTML = content;
                document.getElementById('winners-modal').style.display = 'flex';

            } catch (error) {
                console.error('Erro ao gerar lista de ganhadores:', error);
                showNotification('Erro ao gerar lista de ganhadores', 'error');
            }
        }

        function closeWinnersModal() {
            document.getElementById('winners-modal').style.display = 'none';
        }

        function exportWinners() {
            try {
                const winners = allParticipants
                    .filter(p => (p.status_pagamento === 'PAGO PARCIALMENTE' || p.status_pagamento === 'PAGO') && p.data_confirmacao_pagamento)
                    .sort((a, b) => new Date(a.data_confirmacao_pagamento) - new Date(b.data_confirmacao_pagamento))
                    .slice(0, 150);

                const winnersData = winners.map((p, index) => ({
                    'Posição': index + 1,
                    'Nome': p.nome_completo,
                    'WhatsApp': p.whatsapp,
                    'Sexo': p.sexo,
                    'Status': getStatusText(p.status_pagamento),
                    'Data Pagamento': formatDateTime(convertToLocalTime(p.data_confirmacao_pagamento))
                }));

                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(winnersData);
                XLSX.utils.book_append_sheet(wb, ws, 'Ganhadores de Camisa');
                XLSX.writeFile(wb, `ganhadores_camisa_retiro_2026_${new Date().toISOString().split('T')[0]}.xlsx`);
                
                showNotification('Lista de ganhadores exportada com sucesso!', 'success');
            } catch (error) {
                console.error('Erro ao exportar ganhadores:', error);
                showNotification('Erro ao exportar lista de ganhadores', 'error');
            }
        }

        function printWinners() {
            const winners = allParticipants
                .filter(p => (p.status_pagamento === 'PAGO PARCIALMENTE' || p.status_pagamento === 'PAGO') && p.data_confirmacao_pagamento)
                .sort((a, b) => new Date(a.data_confirmacao_pagamento) - new Date(b.data_confirmacao_pagamento))
                .slice(0, 150);

            const printContent = `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #ff6b35;">🏕️ O RETIRO 2026</h1>
                        <h2>🏆 LISTA DOS 150 GANHADORES DE CAMISA</h2>
                        <p>VISÃO • MISSÃO • PRESSÃO</p>
                        <p>Total: ${winners.length}/150 ganhadores</p>
                    </div>
                    
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <thead>
                            <tr style="background: #ff6b35; color: white;">
                                <th style="border: 1px solid #ddd; padding: 8px;">#</th>
                                <th style="border: 1px solid #ddd; padding: 8px;">Nome</th>
                                <th style="border: 1px solid #ddd; padding: 8px;">WhatsApp</th>
                                <th style="border: 1px solid #ddd; padding: 8px;">Sexo</th>
                                <th style="border: 1px solid #ddd; padding: 8px;">Data Pagamento</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${winners.map((p, index) => `
                                <tr>
                                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${index + 1}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px;">${p.nome_completo}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px;">${p.whatsapp}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${p.sexo}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${formatDateTime(convertToLocalTime(p.data_confirmacao_pagamento))}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div style="margin-top: 30px; text-align: center; font-size: 10px; color: #666;">
                        Gerado em ${formatDateTime(new Date())} - Sistema de Balcão O Retiro 2026
                    </div>
                </div>
            `;

            const printWindow = window.open('', '_blank');
            printWindow.document.write(printContent);
            printWindow.document.close();
            printWindow.print();
        }

        // ===== EXPORTAÇÃO EXCEL =====
        // Botão Verde - Exporta a base completa de participantes
        function exportDashboard() {
            try {
                showNotification('Gerando base completa...', 'info');

                // MODIFICAÇÃO:
                // Esta nova lógica cria uma cópia de todos os participantes
                // e formata apenas as colunas de data para o Excel.
                const data = allParticipants.map(p => ({
                    ...p, // <-- ISSO COPIA TODOS OS CAMPOS DO BANCO DE DADOS
                    
                    // Sobrescreve apenas as datas para formatá-las
                    data_inscricao: p.data_inscricao ? formatDateTime(convertToLocalTime(p.data_inscricao)) : 'N/A',
                    data_confirmacao_pagamento: p.data_confirmacao_pagamento ? formatDateTime(convertToLocalTime(p.data_confirmacao_pagamento)) : 'N/A',
                    data_ultima_atualizacao: p.data_ultima_atualizacao ? formatDateTime(convertToLocalTime(p.data_ultima_atualizacao)) : 'N/A'
                }));
                
                const wb = XLSX.utils.book_new();
                // A função json_to_sheet vai ler todos os campos do 'data' automaticamente
                const ws = XLSX.utils.json_to_sheet(data);
                XLSX.utils.book_append_sheet(wb, ws, 'Base Completa');
                XLSX.writeFile(wb, `base_completa_retiro_${new Date().toISOString().split('T')[0]}.xlsx`);
            
            } catch (error) {
                console.error('Erro ao exportar base completa:', error);
                showNotification('Erro ao exportar base completa', 'error');
            }
        }
        
        // Botão Azul - Exporta os pagamentos filtrados do dashboard
        async function exportInscricoes() {
            try {
                showNotification('Gerando relatório filtrado...', 'info');
                
                // Re-run the filter logic
                const filterStatus = document.getElementById('filter-status').value;
                let pQuery = supabase
                    .from('inscricoes')
                    .select('id')
                    .range(0, 9999);
                if (filterStatus) pQuery = pQuery.eq('status_pagamento', filterStatus);
                const { data: participants, error: pError } = await pQuery;
                if (pError) throw pError;
                const participantIds = participants.map(p => p.id);
                
                if (participantIds.length === 0) {
                    showNotification('Nenhum dado para exportar', 'warning');
                    return;
                }
                
                const filterData = document.getElementById('filter-data').value;
                const filterAtendente = document.getElementById('filter-atendente').value;
                const filterForma = document.getElementById('filter-forma').value;
                
                let payQuery = supabase.from('pagamentos_históricos').select('*').in('inscricao_id', participantIds);
                const dateRange = getUTCDateRangeForLocalDate(filterData);
                if (dateRange) {
                    payQuery = payQuery
                        .gte('data_pagamento', dateRange.start)
                        .lte('data_pagamento', dateRange.end);
                }
                if (filterAtendente) payQuery = payQuery.eq('atendente', filterAtendente);
                if (filterForma) payQuery = payQuery.eq('forma_pagamento', filterForma);
                
                const { data: pagamentos, error: payError } = await payQuery;
                if (payError) throw payError;
                
                if (pagamentos.length === 0) {
                    showNotification('Nenhum dado para exportar', 'warning');
                    return;
                }

                const data = pagamentos.map(p => ({
                    'Participante': p.nome_participante,
                    'Valor_Pago': parseFloat(p.valor_pago),
                    'Forma': p.forma_pagamento,
                    'Atendente': p.atendente,
                    'Data': formatDateTime(convertToLocalTime(p.data_pagamento)),
                    'Observações': p.observacoes
                }));

                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(data);
                XLSX.utils.book_append_sheet(wb, ws, 'Pagamentos Filtrados');
                XLSX.writeFile(wb, `pagamentos_filtrados_${new Date().toISOString().split('T')[0]}.xlsx`);

            } catch (error) {
                console.error('Erro ao exportar inscrições:', error);
                showNotification('Erro ao exportar inscrições', 'error');
            }
        }

        
        // ===== INICIALIZAÇÃO DO SISTEMA =====
        document.addEventListener('DOMContentLoaded', () => {
            console.log('Sistema de Balcão v4.0.0 - O Retiro 2026 - Carregado');
            
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (session) {
                    currentUser = session.user;
                    document.getElementById('user-name').textContent = currentUser.email.split('@')[0];
                    document.getElementById('login-container').style.display = 'none';
                    document.getElementById('main-system').style.display = 'block';
                    document.getElementById('main-system-footer').style.display = 'block';
                    if (currentUser.email.includes('adm')) {
                        document.getElementById('adm-report-btn').style.display = 'block';
                    }
                    loadInitialData();
                }
            });

            supabase.auth.onAuthStateChange((event, session) => {
                if (event === 'SIGNED_OUT') {
                    currentUser = null;
                    allParticipants = [];
                    document.getElementById('login-container').style.display = 'flex';
                    document.getElementById('main-system').style.display = 'none';
                }
            });
        });

        // ===== FUNÇÕES GLOBAIS =====
        window.logout = logout;
        window.openAdmReport = openAdmReport;
        window.closeAdmReportModal = closeAdmReportModal;
        window.generateAttendantReport = generateAttendantReport;
        window.exportAdmReport = exportAdmReport;
        window.showDashboard = showDashboard;
        window.hideDashboard = hideDashboard;
        window.updateDashboard = updateDashboard;
        window.generateWinnersList = generateWinnersList;
        window.closeWinnersModal = closeWinnersModal;
        window.exportWinners = exportWinners;
        window.printWinners = printWinners;
        window.exportDashboard = exportDashboard;
        window.exportInscricoes = exportInscricoes;
        window.showParticipantDetails = showParticipantDetails;
        window.closeDetailsModal = closeDetailsModal;
        window.updateParticipantField = updateParticipantField; // Nova função genérica
        window.deleteParticipant = deleteParticipant;
        window.generateReceipt = generateReceipt;
        window.closeReceiptModal = closeReceiptModal;
        window.printReceipt = printReceipt;
        window.emailReceiptFromModal = emailReceiptFromModal;
        window.openEmailModal = openEmailModal;
        window.closeEmailModal = closeEmailModal;
        window.sendEmailReceipt = sendEmailReceipt;
        window.openPaymentsModal = openPaymentsModal;
        window.closePaymentsModal = closePaymentsModal;
        window.addNewPayment = addNewPayment;
        window.deletePayment = deletePayment;
        window.forceSyncInscricaoWithHistory = forceSyncInscricaoWithHistory;

        // ===== EVENT LISTENERS PARA FILTROS =====
        document.getElementById('filter-data').addEventListener('change', updateDashboard);
        document.getElementById('filter-atendente').addEventListener('change', updateDashboard);
        document.getElementById('filter-forma').addEventListener('change', updateDashboard);
        document.getElementById('filter-status').addEventListener('change', updateDashboard);

        // ===== EVENTOS DE MODAL =====
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });

        console.log('✅ Sistema carregado completamente!');

        // ═══════════════════════════════════════════════════════════
        //  MÓDULO DE EVENTOS AVULSOS  (v2 — múltiplos eventos + imagem)
        // ═══════════════════════════════════════════════════════════

        let selectedEvent = null;
        let allEvents     = [];
        let eventRegistrations = [];
        let editingEventId = null;

        function isCurrentUserAdm() {
            return !!(currentUser && currentUser.email.includes('adm'));
        }

        // ── Troca de abas ─────────────────────────────────────────
        function switchTab(tab) {
            const sr = document.getElementById('section-retiro');
            const se = document.getElementById('section-eventos');
            const br = document.getElementById('tab-retiro');
            const be = document.getElementById('tab-eventos');
            if (tab === 'retiro') {
                sr.style.display = 'block'; se.style.display = 'none';
                br.classList.add('active'); be.classList.remove('active');
            } else {
                sr.style.display = 'none'; se.style.display = 'block';
                br.classList.remove('active'); be.classList.add('active');
                showEventsListView();
                loadEvents();
            }
        }

        function showEventsListView() {
            document.getElementById('events-grid-container').style.display = 'block';
            document.getElementById('event-registration-view').style.display = 'none';
            document.getElementById('ev-adm-toolbar').style.display = isCurrentUserAdm() ? 'block' : 'none';
            selectedEvent = null;
            eventRegistrations = [];
        }

        function backToEventsList() {
            showEventsListView();
            renderEventsGrid();
        }

        // ── Carrega eventos ───────────────────────────────────────
        async function loadEvents() {
            try {
                let query = supabase
                    .from('eventos')
                    .select('*, inscricoes_eventos!evento_id(count)')
                    .order('criado_em', { ascending: false });
                if (!isCurrentUserAdm()) query = query.eq('ativo', true);
                const { data, error } = await query;
                if (error) throw error;
                allEvents = data || [];
                renderEventsGrid();
            } catch (err) {
                console.error('Erro ao carregar eventos:', err);
                showNotification('Erro ao carregar eventos: ' + err.message, 'error');
            }
        }

        // ── Renderiza grid de cards ───────────────────────────────
        function buildEventLandingPageUrl(eventId) {
            return 'https://eventos.alvocuritiba.com.br?evento=' + eventId;
        }

        async function copyEventLandingPageLink(eventId) {
            const ev = allEvents.find(e => e.id === eventId);
            if (!ev) {
                showNotification('Evento nao encontrado', 'error');
                return;
            }

            const lpUrl = buildEventLandingPageUrl(eventId);

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(lpUrl);
                } else {
                    const input = document.createElement('input');
                    input.value = lpUrl;
                    document.body.appendChild(input);
                    input.select();
                    document.execCommand('copy');
                    document.body.removeChild(input);
                }
                showNotification('Link da LP copiado para "' + ev.nome + '"', 'success');
            } catch (err) {
                console.error('Erro ao copiar link da LP:', err);
                showNotification('Copie manualmente este link: ' + lpUrl, 'info');
            }
        }

        function copySelectedEventLandingPageLink() {
            if (!selectedEvent || !selectedEvent.id) {
                showNotification('Nenhum evento selecionado', 'error');
                return;
            }
            copyEventLandingPageLink(selectedEvent.id);
        }

        function renderEventsGrid() {
            const grid   = document.getElementById('events-grid');
            const banner = document.getElementById('no-event-banner');
            const adm    = isCurrentUserAdm();
            const list   = adm ? allEvents : allEvents.filter(e => e.ativo);

            if (list.length === 0) {
                grid.innerHTML = '';
                banner.style.display = 'block';
                return;
            }
            banner.style.display = 'none';

            grid.innerHTML = list.map(ev => {
                const count = ev.inscricoes_eventos && ev.inscricoes_eventos[0]
                    ? ev.inscricoes_eventos[0].count : 0;

                const imgHtml = ev.imagem_url
                    ? '<div style="height:180px;overflow:hidden;"><img src="' + ev.imagem_url + '" alt="' + ev.nome + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.style.display=&quot;none&quot;"></div>'
                    : '<div style="height:70px;background:linear-gradient(135deg,var(--primary-dark),var(--primary));display:flex;align-items:center;justify-content:center;font-size:2em;">📅</div>';

                const badge = ev.ativo
                    ? '<span style="background:var(--success);color:#fff;padding:2px 10px;border-radius:100px;font-size:0.7em;font-weight:700;white-space:nowrap;">● ATIVO</span>'
                    : '<span style="background:var(--text-muted);color:#fff;padding:2px 10px;border-radius:100px;font-size:0.7em;font-weight:700;white-space:nowrap;">INATIVO</span>';

                const dataStr = ev.data
                    ? '📅 ' + new Date(ev.data + 'T12:00:00').toLocaleDateString('pt-BR', {weekday:'long',day:'2-digit',month:'long'})
                    : '';

                const valorStr = ev.gratuito
                    ? '<span style="color:var(--success);font-weight:700;">Gratuito</span>'
                    : '<span style="color:var(--warning);font-weight:700;">R$ ' + parseFloat(ev.valor||0).toFixed(2).replace('.',',') + '</span>';

                const admBtns = adm
                    ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);" onclick="event.stopPropagation()">'
                    + '<button onclick="openEventModal(&apos;' + ev.id + '&apos;)" class="btn btn-info" style="padding:8px 4px;font-size:0.72em;">✏️ Editar</button>'
                    + '<button onclick="toggleEventById(&apos;' + ev.id + '&apos;)" class="btn ' + (ev.ativo ? 'btn-warning' : 'btn-success') + '" style="padding:8px 4px;font-size:0.72em;">' + (ev.ativo ? '⏹️ Desativar' : '▶️ Ativar') + '</button>'
                    + '<button onclick="copyEventLandingPageLink(&apos;' + ev.id + '&apos;)" class="btn btn-secondary" style="padding:8px 4px;font-size:0.72em;">🔗 Copiar LP</button>'
                    + '<button onclick="deleteEventById(&apos;' + ev.id + '&apos;)" class="btn btn-danger" style="padding:8px 4px;font-size:0.72em;">🗑️ Excluir</button>'
                    + '</div>'
                    : '';

                const clickHandler = ev.ativo
                    ? 'onclick="selectEventForRegistration(&apos;' + ev.id + '&apos;)"'
                    : '';
                const hoverOn = ev.ativo
                    ? "this.style.borderColor='var(--border-accent)';this.style.transform='translateY(-3px)';this.style.boxShadow='var(--shadow-primary)'"
                    : '';
                const hoverOff = ev.ativo
                    ? "this.style.borderColor='var(--border)';this.style.transform='translateY(0)';this.style.boxShadow='none'"
                    : '';

                return '<div style="background:var(--bg-medium);border:1px solid var(--border);border-radius:var(--border-radius-lg);overflow:hidden;transition:all 0.2s ease;' + (ev.ativo ? 'cursor:pointer;' : '') + '"'
                    + ' ' + clickHandler
                    + ' onmouseenter="' + hoverOn + '"'
                    + ' onmouseleave="' + hoverOff + '">'
                    + imgHtml
                    + '<div style="padding:18px;">'
                    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;"><h3 style="color:var(--text-primary);font-size:1.05em;font-weight:700;line-height:1.2;">' + ev.nome + '</h3>' + badge + '</div>'
                    + (dataStr ? '<div style="color:var(--text-muted);font-size:0.8em;margin-bottom:4px;">' + dataStr + '</div>' : '')
                    + (ev.descricao ? '<div style="color:var(--text-light);font-size:0.85em;margin-bottom:8px;line-height:1.4;">' + ev.descricao + '</div>' : '')
                    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">' + valorStr + '<span style="color:var(--text-muted);font-size:0.8em;">👥 ' + count + ' inscrito' + (count != 1 ? 's' : '') + '</span></div>'
                    + admBtns
                    + '</div></div>';
            }).join('');
        }

        // ── Seleciona evento para inscrição ───────────────────────
        async function selectEventForRegistration(eventId) {
            selectedEvent = allEvents.find(e => e.id === eventId);
            if (!selectedEvent) return;
            document.getElementById('events-grid-container').style.display = 'none';
            document.getElementById('event-registration-view').style.display = 'block';
            document.getElementById('ev-desk-title').textContent = selectedEvent.nome;
            const copyLpBtn = document.getElementById('ev-copy-lp-btn');
            if (copyLpBtn) {
                copyLpBtn.style.display = isCurrentUserAdm() ? 'inline-flex' : 'none';
            }
            const banner = document.getElementById('ev-desk-banner');
            if (selectedEvent.imagem_url) {
                document.getElementById('ev-desk-banner-img').src = selectedEvent.imagem_url;
                banner.style.display = 'block';
            } else {
                banner.style.display = 'none';
            }
            await loadEventRegistrationsList();
        }

        // ── Modal criar/editar evento ─────────────────────────────
        function openEventModal(eventId) {
            editingEventId = eventId || null;
            document.getElementById('ev-modal-title').textContent = eventId ? '✏️ Editar Evento' : '➕ Novo Evento';
            document.getElementById('ev-nome').value = '';
            document.getElementById('ev-data').value = '';
            document.getElementById('ev-descricao').value = '';
            document.getElementById('ev-capacidade').value = '0';
            document.getElementById('ev-gratuito').value = 'true';
            document.getElementById('ev-valor').value = '';
            document.getElementById('ev-imagem').value = '';
            document.getElementById('ev-image-preview').style.display = 'none';
            document.getElementById('ev-upload-area').style.display = 'block';
            const fi = document.getElementById('ev-imagem-file');
            if (fi) fi.value = '';
            toggleEventValueField();
            if (eventId) {
                const ev = allEvents.find(e => e.id === eventId);
                if (ev) {
                    document.getElementById('ev-nome').value = ev.nome || '';
                    document.getElementById('ev-data').value = ev.data || '';
                    document.getElementById('ev-descricao').value = ev.descricao || '';
                    document.getElementById('ev-capacidade').value = ev.capacidade || 0;
                    document.getElementById('ev-gratuito').value = ev.gratuito ? 'true' : 'false';
                    document.getElementById('ev-valor').value = ev.valor
                        ? parseFloat(ev.valor).toFixed(2).replace('.', ',') : '';
                    document.getElementById('ev-imagem').value = ev.imagem_url || '';
                    toggleEventValueField();
                    if (ev.imagem_url) {
                        document.getElementById('ev-preview-img').src = ev.imagem_url;
                        document.getElementById('ev-image-preview').style.display = 'block';
                        document.getElementById('ev-upload-area').style.display = 'none';
                    }
                }
            }
            document.getElementById('event-form-modal').style.display = 'flex';
        }

        function closeEventModal() {
            document.getElementById('event-form-modal').style.display = 'none';
            editingEventId = null;
        }

        function previewEventImage() {
            const url = document.getElementById('ev-imagem').value.trim();
            const preview = document.getElementById('ev-image-preview');
            const img = document.getElementById('ev-preview-img');
            if (url) {
                img.src = url;
                preview.style.display = 'block';
                img.onerror = () => { preview.style.display = 'none'; };
            } else {
                preview.style.display = 'none';
            }
        }

        function toggleEventValueField() {
            const g = document.getElementById('ev-gratuito').value === 'true';
            const v = document.getElementById('ev-valor');
            v.disabled = g;
            if (g) v.value = '';
        }

        async function saveEventFromModal() {
            const nome = document.getElementById('ev-nome').value.trim();
            if (!nome) { showNotification('Informe o nome do evento', 'error'); return; }
            const gratuito = document.getElementById('ev-gratuito').value === 'true';
            const valorRaw = document.getElementById('ev-valor').value.trim().replace(',', '.');
            const payload = {
                nome,
                data: document.getElementById('ev-data').value || null,
                descricao: document.getElementById('ev-descricao').value.trim() || null,
                capacidade: parseInt(document.getElementById('ev-capacidade').value) || 0,
                gratuito,
                valor: gratuito ? 0 : (parseFloat(valorRaw) || 0),
                imagem_url: document.getElementById('ev-imagem').value.trim() || null,
                criado_por: currentUser.email,
                atualizado_em: new Date().toISOString()
            };
            try {
                showNotification('Salvando...', 'info');
                let result;
                if (editingEventId) {
                    result = await supabase.from('eventos').update(payload)
                        .eq('id', editingEventId).select().single();
                } else {
                    payload.ativo = false;
                    result = await supabase.from('eventos').insert(payload).select().single();
                }
                if (result.error) throw result.error;
                if (editingEventId) {
                    const idx = allEvents.findIndex(e => e.id === editingEventId);
                    if (idx >= 0) allEvents[idx] = Object.assign({}, allEvents[idx], result.data);
                } else {
                    allEvents.unshift(result.data);
                }
                closeEventModal();
                renderEventsGrid();
                showNotification(editingEventId
                    ? 'Evento atualizado!'
                    : 'Evento criado! Ative-o para aparecer para os usuários.', 'success');
            } catch (err) {
                showNotification('Erro ao salvar: ' + err.message, 'error');
            }
        }

        async function toggleEventById(eventId) {
            const ev = allEvents.find(e => e.id === eventId);
            if (!ev) return;
            try {
                const { data, error } = await supabase.from('eventos')
                    .update({ ativo: !ev.ativo, atualizado_em: new Date().toISOString() })
                    .eq('id', eventId).select().single();
                if (error) throw error;
                const idx = allEvents.findIndex(e => e.id === eventId);
                if (idx >= 0) allEvents[idx] = Object.assign({}, allEvents[idx], data);
                renderEventsGrid();
                showNotification(data.ativo
                    ? '"' + ev.nome + '" ativado! ✅'
                    : '"' + ev.nome + '" desativado. ⏹️', 'success');
            } catch (err) { showNotification('Erro: ' + err.message, 'error'); }
        }

        async function deleteEventById(eventId) {
            const ev = allEvents.find(e => e.id === eventId);
            if (!ev) return;
            if (!confirm('Excluir "' + ev.nome + '"? Todas as inscricoes tambem serao removidas.')) return;
            try {
                const { error } = await supabase.from('eventos').delete().eq('id', eventId);
                if (error) throw error;
                allEvents = allEvents.filter(e => e.id !== eventId);
                renderEventsGrid();
                showNotification('Evento excluído.', 'info');
            } catch (err) { showNotification('Erro: ' + err.message, 'error'); }
        }

        // ── Balcão de inscrições ──────────────────────────────────
        async function registerForEvent() {
            if (!selectedEvent) { showNotification('Nenhum evento selecionado', 'error'); return; }
            const nome = document.getElementById('ev-reg-nome').value.trim();
            if (!nome) { showNotification('Informe o nome do participante', 'error'); return; }
            if (selectedEvent.capacidade > 0 && eventRegistrations.length >= selectedEvent.capacidade) {
                showNotification('Evento com capacidade esgotada!', 'error'); return;
            }
            const dup = eventRegistrations.find(r => r.nome.toLowerCase().trim() === nome.toLowerCase());
            if (dup) { showNotification('"' + nome + '" já está inscrito(a) neste evento.', 'error'); return; }
            try {
                const { data, error } = await supabase.from('inscricoes_eventos').insert({
                    evento_id: selectedEvent.id,
                    nome,
                    telefone: document.getElementById('ev-reg-telefone').value.trim() || null,
                    rede: document.getElementById('ev-reg-rede').value || null,
                    observacao: document.getElementById('ev-reg-obs').value.trim() || null,
                    atendente: currentUser.email.split('@')[0]
                }).select().single();
                if (error) throw error;
                eventRegistrations.unshift(data);
                updateEventStats();
                renderEventList();
                document.getElementById('ev-reg-nome').value = '';
                document.getElementById('ev-reg-telefone').value = '';
                document.getElementById('ev-reg-rede').value = '';
                document.getElementById('ev-reg-obs').value = '';
                document.getElementById('ev-reg-nome').focus();
                showNotification('✅ ' + nome + ' inscrito(a)!', 'success');
            } catch (err) { showNotification('Erro: ' + err.message, 'error'); }
        }

        async function loadEventRegistrationsList() {
            if (!selectedEvent) return;
            document.getElementById('event-list-container').innerHTML =
                '<div style="text-align:center;padding:40px;"><div class="loading"></div></div>';
            try {
                const { data, error } = await supabase.from('inscricoes_eventos')
                    .select('*').eq('evento_id', selectedEvent.id)
                    .order('criado_em', { ascending: false });
                if (error) throw error;
                eventRegistrations = data || [];
                updateEventStats();
                renderEventList();
            } catch (err) {
                document.getElementById('event-list-container').innerHTML =
                    '<div style="text-align:center;padding:20px;color:var(--danger);">Erro ao carregar</div>';
            }
        }

        function updateEventStats() {
            const t = eventRegistrations.length;
            document.getElementById('ev-stat-inscritos').textContent = t;
            document.getElementById('ev-stat-vagas').textContent =
                (selectedEvent && selectedEvent.capacidade > 0)
                    ? Math.max(0, selectedEvent.capacidade - t) : '∞';
            const hoje = new Date().toDateString();
            document.getElementById('ev-stat-hoje').textContent =
                eventRegistrations.filter(r => new Date(r.criado_em).toDateString() === hoje).length;
        }

function renderEventList(filter) {
            filter = filter || '';
            const container = document.getElementById('event-list-container');
            const lower = filter.toLowerCase();
            const list = filter
                ? eventRegistrations.filter(r =>
                    (r.nome || '').toLowerCase().includes(lower)
                    || (r.email || '').toLowerCase().includes(lower)
                    || (r.telefone || '').toLowerCase().includes(lower)
                )
                : eventRegistrations;
            if (list.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:40px;color:#666;">'
                    + (filter ? 'Nenhum resultado' : 'Nenhuma inscrição ainda') + '</div>';
                return;
            }
            container.innerHTML = list.map(r =>
                '<div class="person-card">'
                + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">'
                + '<div style="flex:1;">'
                + '<div style="font-weight:700;color:var(--text-primary);">' + r.nome + '</div>'
                + '<div style="color:var(--text-muted);font-size:0.78em;margin-top:3px;display:flex;gap:12px;flex-wrap:wrap;">'
                + (r.telefone ? '<span>📱 ' + r.telefone + '</span>' : '')
                + (r.email ? '<span>📧 ' + r.email + '</span>' : '')
                + (r.rede ? '<span>🔵 ' + r.rede + '</span>' : '')
                + (typeof r.ja_foi_retiro === 'boolean' ? '<span>🏕️ Retiro: ' + (r.ja_foi_retiro ? 'SIM' : 'NAO') + '</span>' : '')
                + (r.observacao ? '<span>📝 ' + r.observacao + '</span>' : '')
                + '</div></div>'
                + '<div style="text-align:right;flex-shrink:0;">'
                + '<div style="font-size:0.72em;color:var(--text-muted);">' + formatDateTime(new Date(r.criado_em)) + '</div>'
                + '<div style="font-size:0.72em;color:var(--primary);margin-top:2px;">por ' + (r.atendente || '—') + '</div>'
                + (isCurrentUserAdm()
                    ? '<button onclick="removeEventRegistration(&apos;' + r.id + '&apos;)" class="btn btn-danger" style="padding:3px 8px;font-size:0.7em;margin-top:4px;">🗑️</button>'
                    : '')
                + '</div></div></div>'
            ).join('');
        }

        function filterEventList() {
            renderEventList(document.getElementById('ev-search').value);
        }

        async function removeEventRegistration(id) {
            if (!confirm('Remover esta inscrição?')) return;
            try {
                const { error } = await supabase.from('inscricoes_eventos').delete().eq('id', id);
                if (error) throw error;
                eventRegistrations = eventRegistrations.filter(r => r.id !== id);
                updateEventStats();
                renderEventList(document.getElementById('ev-search').value);
                showNotification('Inscrição removida.', 'info');
            } catch (err) { showNotification('Erro: ' + err.message, 'error'); }
        }

function exportEventRegistrations() {
            if (!selectedEvent || eventRegistrations.length === 0) {
                showNotification('Nenhuma inscrição para exportar', 'error'); return;
            }
            const rows = eventRegistrations.map((r, i) => ({
                'Nº': i + 1, 'Nome': r.nome,
                'Telefone': r.telefone || '', 'Email': r.email || '', 'Rede': r.rede || '',
                'Ja foi para o Retiro?': typeof r.ja_foi_retiro === 'boolean' ? (r.ja_foi_retiro ? 'SIM' : 'NAO') : '',
                'Observação': r.observacao || '', 'Atendente': r.atendente || '',
                'Data/Hora': formatDateTime(new Date(r.criado_em))
            }));
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Inscrições');
            XLSX.writeFile(wb, 'inscricoes_' + selectedEvent.nome.replace(/\s+/g, '_') + '.xlsx');
        }

        // Expõe ao escopo global (necessário em type="module")
        window.switchTab                  = switchTab;
        window.backToEventsList           = backToEventsList;
        window.openEventModal             = openEventModal;
        window.closeEventModal            = closeEventModal;
        window.previewEventImage          = previewEventImage;
        window.toggleEventValueField      = toggleEventValueField;
        window.saveEventFromModal         = saveEventFromModal;
        window.toggleEventById            = toggleEventById;
        window.deleteEventById            = deleteEventById;
        window.copyEventLandingPageLink   = copyEventLandingPageLink;
        window.copySelectedEventLandingPageLink = copySelectedEventLandingPageLink;
        window.selectEventForRegistration = selectEventForRegistration;
        window.registerForEvent           = registerForEvent;
        window.filterEventList            = filterEventList;
        window.removeEventRegistration    = removeEventRegistration;
        window.exportEventRegistrations   = exportEventRegistrations;
        // ── Upload de imagem para Supabase Storage ────────────────
        async function uploadEventImageFile(file) {
            if (!file) return null;
            if (file.size > 5 * 1024 * 1024) {
                showNotification('Imagem muito grande. Máximo 5 MB.', 'error');
                return null;
            }
            const ext = file.name.split('.').pop().toLowerCase();
            const path = 'events/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + ext;
            const progress = document.getElementById('ev-upload-progress');
            const bar = document.getElementById('ev-progress-bar');
            const status = document.getElementById('ev-upload-status');
            progress.style.display = 'block';
            bar.style.width = '30%';
            status.textContent = 'Enviando imagem...';
            try {
                const { data, error } = await supabase.storage
                    .from('event-images')
                    .upload(path, file, { upsert: true, contentType: file.type });
                if (error) throw error;
                bar.style.width = '100%';
                status.textContent = 'Concluido!';
                const { data: urlData } = supabase.storage.from('event-images').getPublicUrl(path);
                setTimeout(() => { progress.style.display = 'none'; bar.style.width = '0%'; }, 1500);
                return urlData.publicUrl;
            } catch (err) {
                progress.style.display = 'none';
                bar.style.width = '0%';
                throw err;
            }
        }

        async function handleEventImageUpload(input) {
            const file = input.files[0];
            if (!file) return;
            try {
                const url = await uploadEventImageFile(file);
                if (!url) return;
                document.getElementById('ev-imagem').value = url;
                document.getElementById('ev-preview-img').src = url;
                document.getElementById('ev-image-preview').style.display = 'block';
                document.getElementById('ev-upload-area').style.display = 'none';
                showNotification('Imagem enviada!', 'success');
            } catch (err) {
                showNotification('Erro no upload: ' + err.message, 'error');
            }
        }

        function handleEventImageDrop(e) {
            e.preventDefault();
            document.getElementById('ev-upload-area').style.borderColor = 'var(--border-strong)';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                const fakeInput = { files: [file] };
                handleEventImageUpload(fakeInput);
            }
        }

        function clearEventImage() {
            document.getElementById('ev-imagem').value = '';
            document.getElementById('ev-image-preview').style.display = 'none';
            document.getElementById('ev-upload-area').style.display = 'block';
            const fi = document.getElementById('ev-imagem-file');
            if (fi) fi.value = '';
        }

        window.handleEventImageUpload = handleEventImageUpload;
        window.handleEventImageDrop   = handleEventImageDrop;
        window.clearEventImage        = clearEventImage;
    
