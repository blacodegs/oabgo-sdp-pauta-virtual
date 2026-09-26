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
    // 1. Uma única requisição: sessão ativa + dados + membros (se cache vazio)
    var precisaMembros = Object.keys(_membrosCache).length === 0;
    var res = await gasGet({ acao: 'coletaNomes', incluirMembros: precisaMembros });

    // 2. Sem sessão ativa?
    if (res.semSessao) {
      if (estadoEl) {
        estadoEl.style.display = 'flex';
        estadoEl.className = 'estado vazio';
        estadoEl.innerHTML = '<i class="material-icons">event_busy</i><p>' +
          (res.motivo || 'Nenhuma coleta de presença ativa no momento.') + '</p>';
      }
      return;
    }

    // 3. Popula cache de membros se o backend enviou
    if (res.membros && Array.isArray(res.membros)) {
      _membrosCache = {};
      res.membros.forEach(function(m) {
        if (m.nome) _membrosCache[m.nome] = m.genero || 'Masculino';
      });
      console.log('[presenca] membros carregados junto com a sessão:', Object.keys(_membrosCache).length);
    }

    // 4. Guarda a sessão
    _sessaoInfo = res.sessao || null;
    _sessaoPresencaId = _sessaoInfo ? _sessaoInfo.id : null;

    // 5. Validação de sessão ativa (tipo + data + hora de início)
    var verif = verificarSessaoAtiva();
    if (!verif.valido) {
      if (estadoEl) {
        estadoEl.style.display = 'flex';
        estadoEl.className = 'estado vazio';
        estadoEl.innerHTML = '<i class="material-icons">schedule</i><p>' + verif.motivo + '</p>';
      }
      return;
    }

    // 6. Banner + QR (QR só aqui, com a URL vinda do backend)
    renderBannerPresenca(_sessaoInfo);
    renderQrPresenca(res.urlPresenca);

    // 7. Carrega participantes e inicia polling
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

/**
 * Monta o título do banner a partir dos dados crus da sessão.
 * Formato: "<ordemOrdinal> Sessão <Tipo> do <Órgão> em <ano>"
 * Ex.: "13ª Sessão Ordinária do Pleno em 2026"
 *
 * @param {Object} sessao — vem de webPauta_getColetaNomes
 */
function renderBannerPresenca(sessao) {
  if (!sessao) return;

  var tituloEl = document.getElementById('presencaTitulo');
  var dataEl   = document.getElementById('presencaData');

  var ordem = (sessao.ordemOrdinal || '').trim();
  var tipo  = (sessao.tipo  || '').trim();
  var orgao = (sessao.orgao || '').trim();
  var ano   = sessao.ano || '';

  var titulo = ordem + ' Sessão ' + tipo + ' do ' + orgao + ' em ' + ano;

  if (tituloEl) tituloEl.textContent = titulo.trim();

  if (dataEl && sessao.dataFormatada) {
    dataEl.innerHTML = '<i class="material-icons" style="font-size:16px">event</i> ' + sessao.dataFormatada;
  }
}

/**
 * Monta o QR Code da aba de presença usando a URL vinda do backend.
 * Chamada apenas quando há sessão ativa — se não houver, a API de
 * geração de QR não é acionada.
 *
 * @param {string} urlPresenca — ex.: "https://.../?aba=presenca"
 */
function renderQrPresenca(urlPresenca) {
  if (!urlPresenca) return;

  var qrImg = document.getElementById('qrImagem');
  var qrUrl = document.getElementById('qrUrl');

  if (qrImg) {
    qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' +
      encodeURIComponent(urlPresenca) + '&color=002d56&bgcolor=ffffff';
  }
  if (qrUrl) qrUrl.textContent = urlPresenca;
}

/**
 * Verifica se o momento atual está dentro do período da sessão
 * E se a sessão NÃO é do tipo "Virtual".
 * @returns {{ valido: boolean, motivo: string }}
 */
function verificarPeriodoSessao() {
  if (!_sessaoInfo) {
    return { valido: false, motivo: 'Dados da sessão não carregados.' };
  }

  // ── Bloqueio por tipo de sessão ──
  var tipo = String(_sessaoInfo.tipo || '').trim().toLowerCase();
  if (tipo === 'virtual') {
    return { valido: false, motivo: 'Sessão do tipo virtual não utiliza registro de presença.' };
  }

  // ── Bloqueio por intervalo de data/hora ──
  function montarData(dataStr, horaStr) {
    if (!dataStr || !horaStr) return null;
    var partes = dataStr.split('/');
    var dia = Number(partes[0]);
    var mes = Number(partes[1]) - 1;
    var ano = Number(partes[2]);
    var hh = Number(horaStr.split(':')[0]);
    var mm = Number(horaStr.split(':')[1]);
    return new Date(ano, mes, dia, hh, mm, 0);
  }

  var inicio = montarData(_sessaoInfo.data, _sessaoInfo.horaInicio);
  var fim    = montarData(_sessaoInfo.dataFim, _sessaoInfo.horaFim);
  var agora  = new Date();

  if (inicio && agora < inicio) {
    return { valido: false, motivo: 'A sessão virtual ainda não foi iniciada. Aguarde o horário programado.' };
  }
  if (fim && agora > fim) {
    return { valido: false, motivo: 'A sessão virtual já foi encerrada. Não é possível registrar votos.' };
  }
  return { valido: true, motivo: '' };
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

  // Limpa o campo de busca e oculta chip/lista
  var input = document.getElementById('selectPresenca');
  if (input) {
    input.value = '';
    input.removeAttribute('data-nome-selecionado');
    input.style.display = 'block';
  }
  var chipEl = document.getElementById('votante-chip-presenca');
  if (chipEl) { chipEl.innerHTML = ''; chipEl.style.display = 'none'; }
  var listaEl = document.getElementById('lista-presenca');
  if (listaEl) { listaEl.innerHTML = ''; listaEl.style.display = 'none'; }

  // Esconde mensagem de "já registrado"
  document.getElementById('presencaJaRegistrada').style.display = 'none';

  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function fecharCardPresenca() {
  document.getElementById('presencaCard').style.display = 'none';
  document.getElementById('btnRegistrarPresenca').style.display = 'flex';
}

async function confirmarPresenca() {
  var input = document.getElementById('selectPresenca');
  var nome = input ? (input.getAttribute('data-nome-selecionado') || '').trim() : '';

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

function filtrarPresenca() {
  var input = document.getElementById('selectPresenca');
  var listaEl = document.getElementById('lista-presenca');
  if (!input || !listaEl) return;

  var termo = input.value.trim().toLowerCase();
  var nomes = Object.keys(_membrosCache).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); });

  if (!termo) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
    return;
  }

  var filtrados = nomes.filter(function(nome) { return nome.toLowerCase().indexOf(termo) !== -1; });

  if (filtrados.length === 0) {
    listaEl.innerHTML = '<div class="votante-opcao" style="color:var(--oab-cinza-md);font-style:italic;">Nenhum membro encontrado</div>';
    listaEl.style.display = 'block';
    return;
  }

  var html = '';
  filtrados.forEach(function(nome) {
    html +=
      '<label class="votante-opcao">' +
        '<input type="radio" name="presenca-votante" value="' + nome + '" onchange="selecionarPresenca(this.value)">' +
        '<span>' + nome + '</span>' +
      '</label>';
  });
  listaEl.innerHTML = html;
  listaEl.style.display = 'block';
}

function selecionarPresenca(nome) {
  var input = document.getElementById('selectPresenca');
  var chipEl = document.getElementById('votante-chip-presenca');
  var listaEl = document.getElementById('lista-presenca');

  if (input) {
    input.value = nome;
    input.setAttribute('data-nome-selecionado', nome);
    input.style.display = 'none';
  }

  if (chipEl) {
    chipEl.innerHTML =
      '<span class="chip-nome">' + nome + '</span>' +
      '<span class="chip-remover" onclick="removerPresenca()" title="Remover">×</span>';
    chipEl.style.display = 'inline-flex';
  }

  if (listaEl) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
  }
}

function removerPresenca() {
  var input = document.getElementById('selectPresenca');
  var chipEl = document.getElementById('votante-chip-presenca');
  var listaEl = document.getElementById('lista-presenca');

  if (input) {
    input.value = '';
    input.removeAttribute('data-nome-selecionado');
    input.style.display = 'block';
    input.focus();
  }

  if (chipEl) {
    chipEl.innerHTML = '';
    chipEl.style.display = 'none';
  }

  if (listaEl) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
  }
}

/**
 * Verifica se há uma sessão presencial ativa para registro de presença.
 *
 * Regras:
 *   - Sessão deve ser PRESENCIAL (tipo !== 'virtual').
 *   - Deve ser o DIA da sessão (data atual === data da sessão).
 *     Se a data for diferente (antes ou depois), bloqueia.
 *   - No dia da sessão, o horário atual deve ser >= horário de início.
 *
 * Não considera dataFim/horaFim — presença é registrada no dia,
 * a partir do início da sessão.
 *
 * @returns {{ valido: boolean, motivo: string }}
 */
function verificarSessaoAtiva() {
  if (!_sessaoInfo) {
    return { valido: false, motivo: 'Nenhuma sessão ativa no momento.' };
  }

  // ── Verificação de tipo ──
  var tipo = String(_sessaoInfo.tipo || '').trim().toLowerCase();
  if (tipo === 'virtual') {
    return { valido: false, motivo: 'Nenhuma sessão presencial ativa no momento.' };
  }

  // ── Verificação de data ──
  var agora = new Date();
  var hoje = {
    dia:  agora.getDate(),
    mes:  agora.getMonth(),
    ano:  agora.getFullYear()
  };

  var partesData = String(_sessaoInfo.data || '').split('/');
  if (partesData.length !== 3) {
    return { valido: false, motivo: 'Data da sessão inválida.' };
  }
  var dataSessao = {
    dia: Number(partesData[0]),
    mes: Number(partesData[1]) - 1,
    ano: Number(partesData[2])
  };

  // Data diferente → bloqueia
  if (hoje.dia !== dataSessao.dia ||
      hoje.mes !== dataSessao.mes ||
      hoje.ano !== dataSessao.ano) {
    return { valido: false, motivo: 'Hoje não não tem sessão presencial.' };
  }

  // ── Verificação de hora (mesma data) ──
  var partesHora = String(_sessaoInfo.horaInicio || '').split(':');
  if (partesHora.length < 2) {
    return { valido: false, motivo: 'Horário de início da sessão inválido.' };
  }

  var inicio = new Date(
    dataSessao.ano,
    dataSessao.mes,
    dataSessao.dia,
    Number(partesHora[0]),
    Number(partesHora[1]),
    0
  );

  if (agora < inicio) {
    return { valido: false, motivo: 'A sessão ainda não foi iniciada. Aguarde o horário programado.' };
  }

  return { valido: true, motivo: '' };
}