/* ══════════════════════════════════════════════════════════════
   presenca.js — SDP-OAB/GO
   Funções da aba "Registrar Presença"
══════════════════════════════════════════════════════════════ */

async function iniciarPresenca() {
  var estadoEl = document.getElementById('presencaEstado');
  var ctaWrap  = document.getElementById('presencaCtaWrap');

  if (estadoEl) { estadoEl.style.display = 'flex'; estadoEl.className = 'estado loading'; estadoEl.innerHTML = '<i class="material-icons">autorenew</i><p>Identificando sessão…</p>'; }
  if (ctaWrap)  ctaWrap.style.display = 'none';

  try {
    var estado = await gasGet({ acao: 'estadoAtivo' });
    var sessaoId = estado.coletaNomes;

    if (!sessaoId) {
      if (estadoEl) { estadoEl.style.display = 'flex'; estadoEl.className = 'estado vazio'; estadoEl.innerHTML = '<i class="material-icons">event_busy</i><p>Nenhuma coleta de presença ativa no momento.</p>'; }
      return;
    }

    _sessaoPresencaId = sessaoId;

    var [coletaData] = await Promise.all([
      gasGet({ acao: 'coletaNomes', sessaoId: sessaoId }),
      carregarMembros(),
    ]);

    renderBannerPresenca(coletaData.sessao);
    await atualizarParticipantes();

    if (estadoEl) estadoEl.style.display = 'none';
    if (ctaWrap)  ctaWrap.style.display = 'flex';

    if (_pollingPresenca) clearInterval(_pollingPresenca);
    _pollingPresenca = setInterval(function() {
      if (_abaAtiva === 'presenca' && _sessaoPresencaId) atualizarParticipantes();
    }, 15000);

  } catch (err) {
    console.error('[presenca] erro:', err);
    if (estadoEl) {
      estadoEl.style.display = 'flex';
      estadoEl.className = 'estado erro';
      estadoEl.innerHTML = '<i class="material-icons">error_outline</i><p>Não foi possível carregar a sessão.<br>' + err.message + '</p>';
    }
  }
}

function renderBannerPresenca(sessao) {
  if (!sessao) return;
  var tituloEl = document.getElementById('presencaTitulo');
  var dataEl   = document.getElementById('presencaData');
  if (tituloEl) tituloEl.textContent = sessao.titulo || 'Sessão do SDP-OAB/GO';
  if (dataEl && sessao.dataFormatada) {
    dataEl.innerHTML = '<i class="material-icons" style="font-size:16px">event</i> ' + sessao.dataFormatada;
  }
}

async function atualizarParticipantes() {
  if (!_sessaoPresencaId) return;
  try {
    var data = await gasGet({ acao: 'participantes', sessaoId: _sessaoPresencaId });
    _participantesCache = data.participantes || [];
    renderChipsPresentes(_participantesCache);
  } catch (err) {
    console.warn('[participantes] erro ao atualizar:', err.message);
  }
}

function renderChipsPresentes(lista) {
  var chipsEl    = document.getElementById('presencaChips');
  var contagemEl = document.getElementById('presencaContagem');
  if (contagemEl) contagemEl.textContent = lista.length;
  if (!chipsEl) return;
  if (!lista.length) {
    chipsEl.innerHTML = '<span class="presenca-vazio">Nenhum membro registrou presença ainda.</span>';
    return;
  }
  chipsEl.innerHTML = lista.map(function(nome) {
    return '<span class="chip-presente"><i class="material-icons">check_circle</i>' + nome + '</span>';
  }).join('');
}

function mostrarCardPresenca() {
  document.getElementById('btnRegistrarPresenca').style.display = 'none';
  var card = document.getElementById('presencaCard');
  card.style.display = 'block';

  var select = document.getElementById('selectPresenca');
  select.innerHTML = '<option value="" disabled selected>Escolha seu nome</option>';
  Object.keys(_membrosCache).sort(function(a,b){ return a.localeCompare(b,'pt-BR'); }).forEach(function(nome) {
    var opt = document.createElement('option');
    opt.value = nome;
    opt.textContent = nome;
    select.appendChild(opt);
  });
  var oldInst = M.FormSelect.getInstance(select);
  if (oldInst) oldInst.destroy();
  M.FormSelect.init(select, {});

  document.getElementById('presencaJaRegistrada').style.display = 'none';
  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function fecharCardPresenca() {
  document.getElementById('presencaCard').style.display = 'none';
  document.getElementById('btnRegistrarPresenca').style.display = 'flex';
}

async function confirmarPresenca() {
  var select = document.getElementById('selectPresenca');
  var nome   = select ? select.value.trim() : '';

  if (!nome) { toast('Selecione seu nome na lista.', 'erro'); return; }

  if (_participantesCache.indexOf(nome) !== -1) {
    var jaReg = document.getElementById('presencaJaRegistrada');
    if (jaReg) jaReg.style.display = 'block';
    return;
  }

  var btn = document.getElementById('btnConfirmarPresenca');
  btn.disabled = true;
  btn.innerHTML = '<i class="material-icons" style="font-size:16px;animation:spin 1s linear infinite">autorenew</i> Registrando…';

  try {
    await gasPost({ acao: 'registrarPresenca', sessaoId: _sessaoPresencaId, nome: nome });
    _participantesCache.push(nome);
    renderChipsPresentes(_participantesCache);
    fecharCardPresenca();
    toast('Presença de ' + nome + ' registrada!');
  } catch (err) {
    console.error('[presenca] erro ao confirmar:', err);
    toast('Erro ao registrar presença.', 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="material-icons" style="font-size:16px">check</i> Confirmar presença';
  }
}