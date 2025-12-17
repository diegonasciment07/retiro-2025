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
                document.getElementById('login-container').style.display = 'flex';
                document.getElementById('main-system').style.display = 'none';
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
                                    
                                    <option value="NÃO-POSSUO" ${participant.cor_rede === 'NÃO-POSSUO' ? 'selected' : ''}>🆕 Não possuo rede ainda</option>
                                </select>
                            </div>
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
                        <p>Segue seu comprovante de inscrição para O Retiro 2025:</p>
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
                        <h2 style="margin: 0; color: #ff6b35; font-size: 1.8em;">🏕️ O RETIRO 2025</h2>
                        <div style="font-weight: bold; margin: 5px 0;">VISÃO • MISSÃO • PRESSÃO</div>
                        <div style="font-size: 0.9em; color: #666;">COMPROVANTE DE PAGAMENTO</div>
                    </div>
                    
                    <div style="margin: 20px 0;">
                        <div style="margin-bottom: 8px;"><strong>PARTICIPANTE:</strong></div>
                        <div style="margin-bottom: 15px;">${participant.nome_completo}</div>
                        
                        <div style="margin-bottom: 8px;"><strong>WHATSAPP:</strong></div>
                        <div style="margin-bottom: 15px;">${participant.whatsapp || 'N/A'}</div>
                        
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
                XLSX.writeFile(wb, `ganhadores_camisa_retiro_2025_${new Date().toISOString().split('T')[0]}.xlsx`);
                
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
                        <h1 style="color: #ff6b35;">🏕️ O RETIRO 2025</h1>
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
                        Gerado em ${formatDateTime(new Date())} - Sistema de Balcão O Retiro 2025
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
            console.log('Sistema de Balcão v4.0.0 - O Retiro 2025 - Carregado');
            
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (session) {
                    currentUser = session.user;
                    document.getElementById('user-name').textContent = currentUser.email.split('@')[0];
                    document.getElementById('login-container').style.display = 'none';
                    document.getElementById('main-system').style.display = 'block';
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
    
