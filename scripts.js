/* ══════════════════════════════════════════════════════════════
   scripts.js — SDP-OAB/GO
   Lógica compartilhada pelas três abas
══════════════════════════════════════════════════════════════ */

/* ── CONFIG ─────────────────────────────────────────────────── */
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbx91dyMa69vT0704BsR9iPiGhLBq884oViaLtepDYF_mWCM3RzJcqyHCPcG5-Chd-Pp/exec';
const URL_LOGO_OAB        = 'https://www.oabgo.org.br/wp-content/themes/oab/images/logo.png';
const URL_LOGO_RODAPE     = 'https://www.oabgo.org.br/wp-content/themes/oab/images/logo-rodape.png';
const URL_QR_PRESENCA     = 'https://blakodegs.github.io/oabgo-sdp-pauta-virtual/?aba=presenca';
const URL_QR_IMAGEM       = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' +
                             encodeURIComponent(URL_QR_PRESENCA) + '&color=002d56&bgcolor=ffffff';

/* ── ESTADO GLOBAL ──────────────────────────────────────────── */
let _sessaoId           = null;   // sessão da pauta virtual
let _sessaoPresencaId   = null;   // sessão da coleta de nomes
let _votantesCache      = {};
let _votosPorFichaCache = {};
let _mvFichaId          = null;
let _mvExpandido        = null;
let _mvPdfPendente      = null;
let _mvFichaInfo        = {};
let _mvVotosCache       = [];
let _orgaoSessao        = '';
let _membrosCache       = {};     // { "Nome": "Masculino"|"Feminino" }
let _participantesCache = [];     // nomes já presentes na sessão
let _abaAtiva           = 'presenca';
let _pollingPresenca    = null;   // intervalo de polling da aba 1

/* ══════════════════════════════════════════════════════════════
   NAVEGAÇÃO POR ABAS
══════════════════════════════════════════════════════════════ */
function trocarAba(novaAba, el) {
  // Remove classe ativa de todos
  document.querySelectorAll('.aba-item').forEach(function(i) { i.classList.remove('ativa'); });
  document.querySelectorAll('.aba-panel').forEach(function(p) { p.classList.remove('ativa'); });

  // Ativa a aba clicada
  if (el) el.classList.add('ativa');
  var panel = document.getElementById('aba-' + novaAba);
  if (panel) panel.classList.add('ativa');

  _abaAtiva = novaAba;

  // Inicializa a aba se ainda não foi carregada
  if (novaAba === 'presenca' && !_sessaoPresencaId) {
    iniciarPresenca();
  }
  if (novaAba === 'votacao' && !window._votacaoIniciada) {
    window._votacaoIniciada = true;
    iniciarVotacao();
  }
  if (novaAba === 'pauta' && !_sessaoId) {
    iniciarPauta();
  }

  // Atualiza a URL para deep linking (?aba=presenca etc.)
  var url = new URL(window.location.href);
  url.searchParams.set('aba', novaAba);
  window.history.replaceState({}, '', url.toString());
}

/* ══════════════════════════════════════════════════════════════
   UTILITÁRIOS
══════════════════════════════════════════════════════════════ */
function toast(msg, tipo) {
  tipo = tipo || 'sucesso';
  var c = document.getElementById('toastContainer');
  var d = document.createElement('div');
  d.className = 'toast ' + tipo;
  d.innerHTML = '<i class="material-icons">' + (tipo === 'sucesso' ? 'check_circle' : 'error') + '</i>' + msg;
  c.appendChild(d);
  setTimeout(function() { d.remove(); }, 4000);
}

function fecharModal(id) { document.getElementById(id).classList.remove('ativo'); }

function esc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

/* ══════════════════════════════════════════════════════════════
   CAMADA DE REDE
══════════════════════════════════════════════════════════════ */
var _jsonpSeq = 0;

function jsonpGet(params) {
  return new Promise(function(resolve, reject) {
    var cbName = '__gasCallback_' + (++_jsonpSeq);
    var qs     = new URLSearchParams(params).toString();
    var url    = GAS_ENDPOINT + '?' + qs + '&callback=' + cbName;
    var script = document.createElement('script');
    var timer  = setTimeout(function() { reject(new Error('Timeout JSONP')); cleanup(); }, 30000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[cbName] = function(data) { resolve(data); cleanup(); };
    script.onerror = function() { reject(new Error('Falha na requisição')); cleanup(); };
    script.src = url;
    document.head.appendChild(script);
  });
}

async function gasGet(params) {
  var data = await jsonpGet(params);
  if (data.erro) throw new Error(data.erro);
  return data;
}

async function gasGetSilent(params, fallback) {
  try {
    var data = await jsonpGet(params);
    if (data.erro) { console.warn('gasGetSilent:', data.erro); return fallback; }
    return data;
  } catch (err) {
    console.warn('gasGetSilent falhou:', err.message);
    return fallback;
  }
}

async function gasPost(body) {
  await fetch(GAS_ENDPOINT, {
    method : 'POST',
    mode   : 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  });
}

async function gasPostViaGet(body) {
  var data = await jsonpGet({ payload: JSON.stringify(body) });
  if (data.erro) throw new Error(data.erro);
  return data;
}

/* ══════════════════════════════════════════════════════════════
   MEMBROS — carregamento compartilhado
══════════════════════════════════════════════════════════════ */
async function carregarMembros() {
  try {
    var data = await gasGet({ acao: 'membros' });
    _membrosCache = {};
    (data.membros || []).forEach(function(m) {
      if (m.nome) _membrosCache[m.nome] = m.genero || 'Masculino';
    });
    console.log('[membros] carregados:', Object.keys(_membrosCache).length);
  } catch (err) {
    console.warn('[membros] erro ao carregar:', err.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   ABA 1 — REGISTRAR PRESENÇA
══════════════════════════════════════════════════════════════ */

async function iniciarPresenca() {
  var estadoEl = document.getElementById('presencaEstado');
  var ctaWrap  = document.getElementById('presencaCtaWrap');

  if (estadoEl) { estadoEl.style.display = 'flex'; estadoEl.className = 'estado loading'; estadoEl.innerHTML = '<i class="material-icons">autorenew</i><p>Identificando sessão…</p>'; }
  if (ctaWrap)  ctaWrap.style.display = 'none';

  try {
    var estado = await gasGet({ acao: 'estadoAtivo' });
    var sessaoId = estado.coletaNomes;   // ← específico para esta aba

    if (!sessaoId) {
      if (estadoEl) { estadoEl.style.display = 'flex'; estadoEl.className = 'estado vazio'; estadoEl.innerHTML = '<i class="material-icons">event_busy</i><p>Nenhuma coleta de presença ativa no momento.</p>'; }
      return;
    }

    _sessaoPresencaId = sessaoId;

    // 2. Carrega dados da sessão + membros em paralelo
    var [coletaData] = await Promise.all([
      gasGet({ acao: 'coletaNomes', sessaoId: sessaoId }),
      carregarMembros(),
    ]);

    // 3. Renderiza o banner
    renderBannerPresenca(coletaData.sessao);

    // 4. Carrega participantes já registrados
    await atualizarParticipantes();

    // 5. Exibe a interface
    if (estadoEl) estadoEl.style.display = 'none';
    if (ctaWrap)  ctaWrap.style.display = 'flex';

    // 6. Polling automático a cada 15s para atualizar a lista de presentes
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
  // Esconde o botão
  document.getElementById('btnRegistrarPresenca').style.display = 'none';
  // Mostra o card
  var card = document.getElementById('presencaCard');
  card.style.display = 'block';

  // Popula o select com os membros (mesmo código do modal)
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

  // Esconde mensagem de "já registrado"
  document.getElementById('presencaJaRegistrada').style.display = 'none';

  // Scroll suave até o card
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

  // Verifica se já está na lista
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

    // Atualiza cache local otimisticamente
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

/* ══════════════════════════════════════════════════════════════
   ABA 2 — VOTAÇÃO INDIVIDUAL
══════════════════════════════════════════════════════════════ */

let _votacaoFichaId = null;

async function iniciarVotacao() {
  var estadoEl = document.getElementById('votacaoEstado');
  var mainEl   = document.getElementById('votacaoMain');

  if (estadoEl) { estadoEl.style.display = 'flex'; estadoEl.className = 'estado loading'; }
  if (mainEl)   mainEl.style.display = 'none';

  try {
    // 1. Busca o estado ativo do tipo "Processo em votação"
    var estado = await gasGet({ acao: 'estadoAtivo' });
    if (!estado.processoVotacao) {
      if (estadoEl) {
        estadoEl.className = 'estado vazio';
        estadoEl.innerHTML = '<i class="material-icons">gavel_off</i><p>Nenhum processo em votação no momento.</p>';
      }
      return;
    }

    _votacaoFichaId = estado.processoVotacao;

    // 2. Carrega membros + dados da votação
    var [dadosVotacao] = await Promise.all([
      gasGet({ acao: 'infoVotacao', fichaId: _votacaoFichaId }),
      carregarMembros()
    ]);

    if (!dadosVotacao.sucesso) throw new Error(dadosVotacao.erro || 'Erro ao carregar dados.');

    // 3. Renderiza banner (mantido igual)
    document.getElementById('votacaoTitulo').textContent = dadosVotacao.titulo || 'Votação';
    var dataHtml = '';
    if (dadosVotacao.dataSessao) dataHtml += '<i class="material-icons" style="font-size:16px">event</i> ' + dadosVotacao.dataSessao;
    if (dadosVotacao.orgao) dataHtml += (dataHtml ? ' · ' : '') + dadosVotacao.orgao;
    document.getElementById('votacaoData').innerHTML = dataHtml;

    // 4. Renderiza cabeçalho com requerente, requerido e ementa (NOVO)
    var cabecalhoEl = document.getElementById('votacaoCabecalho');
    if (cabecalhoEl && dadosVotacao) {
      var html = '';
      if (dadosVotacao.requerente) html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Requerente</span><span class="votacao-valor">' + dadosVotacao.requerente + '</span></div>';
      if (dadosVotacao.requerido) html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Requerido</span><span class="votacao-valor">' + dadosVotacao.requerido + '</span></div>';
      if (dadosVotacao.ementa) html += '<div class="votacao-info-linha votacao-ementa"><span class="votacao-rotulo">Ementa</span><span class="votacao-valor">' + dadosVotacao.ementa + '</span></div>';
      cabecalhoEl.innerHTML = html;
    }

    // 5. Renderiza exposição dos votos (já exibe relator com "Voto condutor:" se for Pleno)
    renderExposicaoVotos(dadosVotacao.votos || []);

    // 6. Renderiza formulário de votação
    renderFormularioVotacao(dadosVotacao.opcoesVoto || []);

    // 7. Exibe a interface
    if (estadoEl) estadoEl.style.display = 'none';
    if (mainEl)   mainEl.style.display = 'block';

  } catch (err) {
    console.error('[votacao] erro:', err);
    if (estadoEl) {
      estadoEl.className = 'estado erro';
      estadoEl.innerHTML = '<i class="material-icons">error_outline</i><p>Não foi possível carregar os dados.<br>' + err.message + '</p>';
    }
  }
}

function renderExposicaoVotos(votos) {
  var container = document.getElementById('votacaoVotos');
  if (!container) return;

  if (!votos.length) {
    container.innerHTML = '<div class="mv-empty">Nenhum voto registrado para esta ficha.</div>';
    return;
  }

  var html = '';
  votos.forEach(function(v) {
    var textoLimpo = (v.texto || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    html +=
      '<div class="voto-exposicao-card">' +
        '<div class="voto-exposicao-header">' +
          '<span class="voto-exposicao-tipo">' + (v.tipo || 'Voto').toUpperCase() + '</span>' +
          '<span class="voto-exposicao-relator">' + (v.relator || '—') + '</span>' +
        '</div>' +
        '<div class="voto-exposicao-body">' +
          '<p class="voto-exposicao-texto">' + textoLimpo + '</p>' +
        '</div>' +
      '</div>';
  });
  container.innerHTML = html;
}

function renderFormularioVotacao(opcoes) {
  var container = document.getElementById('votacaoOpcoes');
  if (!container) return;

  var html = '';
  opcoes.forEach(function(opcao) {
    html +=
      '<label class="opcao-voto-label" onclick="selecionarVoto(this)">' +
        '<input type="radio" name="votacaoOpcao" value="' + opcao + '">' +
        opcao +
      '</label>';
  });
  container.innerHTML = html;

  // Popula o select de nome
  var select = document.getElementById('votacaoSelectNome');
  if (select && select.options.length <= 1) {
    select.innerHTML = '<option value="" disabled selected>Escolha seu nome</option>';
    Object.keys(_membrosCache).sort(function(a,b){ return a.localeCompare(b,'pt-BR'); }).forEach(function(nome) {
      var opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      select.appendChild(opt);
    });
    M.FormSelect.init(select, {});
  }

  // Configura botão confirmar
  document.getElementById('btnConfirmarVotacao').onclick = confirmarVotoIndividual;
}

async function confirmarVotoIndividual() {
  var select = document.getElementById('votacaoSelectNome');
  var nome   = select ? select.value.trim() : '';
  var radioSel = document.querySelector('input[name="votacaoOpcao"]:checked');

  if (!nome) { toast('Selecione seu nome na lista.', 'erro'); return; }
  if (!radioSel) { toast('Selecione uma opção de voto.', 'erro'); return; }

  var btn = document.getElementById('btnConfirmarVotacao');
  btn.disabled = true;
  btn.innerHTML = '<i class="material-icons" style="font-size:15px;animation:spin 1s linear infinite">autorenew</i> Registrando…';

  try {
    await gasPost({ acao: 'votar', nome: nome, voto: radioSel.value, idFicha: _votacaoFichaId });
    toast('Voto registrado com sucesso!');

    // Reseta o formulário
    select.value = '';
    var inst = M.FormSelect.getInstance(select);
    if (inst) inst.destroy();
    M.FormSelect.init(select, {});
    document.querySelectorAll('input[name="votacaoOpcao"]').forEach(function(r) {
      r.checked = false;
      var p = r.closest('.opcao-voto-label');
      if (p) p.classList.remove('selecionada');
    });

  } catch (err) {
    toast('Erro ao registrar voto.', 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="material-icons" style="font-size:15px">check</i> Confirmar voto';
  }
}

/* ══════════════════════════════════════════════════════════════
   ABA 3 — PAUTA VIRTUAL
══════════════════════════════════════════════════════════════ */

async function iniciarPauta() {
  try {
    var estado = await gasGet({ acao: 'estadoAtivo' });
      if (!estado.sessaoVirtual) {
        // exibe mensagem de nenhuma sessão virtual ativa
        return;
      }
      _sessaoId = estado.sessaoVirtual;

    // Carrega membros se necessário
    if (Object.keys(_membrosCache).length === 0) {
      const membrosData = await gasGet({ acao: 'membros' });
      _membrosCache = {};
      (membrosData.membros || []).forEach(m => {
        if (m.nome) _membrosCache[m.nome] = m.genero || 'Masculino';
      });
    }

    carregarPauta();   // função original da pauta (mantida abaixo)
  } catch (err) {
    console.error('iniciarPauta:', err);
    document.getElementById('listaProcessos').innerHTML =
      '<div class="estado erro"><i class="material-icons">error_outline</i><p>Não foi possível identificar a sessão ativa.<br>' + err.message + '</p></div>';
  }
}

async function carregarPauta() {
  try {
    const [pauta, votantesData] = await Promise.all([
      gasGet      ({ acao: 'pauta',    sessaoId: _sessaoId }),
      gasGetSilent({ acao: 'votantes', sessaoId: _sessaoId }, { votantes: {} }),
    ]);
    _votantesCache = (votantesData && votantesData.votantes) ? votantesData.votantes : {};
    _orgaoSessao = pauta.sessao?.orgao ? String(pauta.sessao.orgao).trim().toLowerCase() : '';
    renderBannerPauta(pauta.sessao);
    renderPauta(pauta);
  } catch (err) {
    console.error('carregarPauta:', err);
    document.getElementById('listaProcessos').innerHTML =
      '<div class="estado erro"><i class="material-icons">error_outline</i>' +
      '<p>Não foi possível carregar a pauta.<br>' + err.message + '</p></div>';
  }
}

function renderBannerPauta(sessao) {
  if (!sessao) return;
  var data = sessao.dataFormatada || sessao.data || '';
  var itens = [];
  if (sessao.orgao) itens.push('<i class="material-icons" style="font-size:16px;">gavel</i> ' + sessao.orgao);
  if (data)         itens.push('<i class="material-icons" style="font-size:16px;">event</i> Pauta iniciada em ' + data);
  if (sessao.local) itens.push('<i class="material-icons" style="font-size:16px;">place</i> ' + sessao.local);
  var el = document.getElementById('bannerMeta');
  if (el) el.innerHTML = itens.join(' &nbsp;·&nbsp; ') || '<span class="banner-meta-item">Sessão carregada</span>';
}

function renderPauta(pauta) {
  const lista = document.getElementById('listaProcessos');
  const processos = pauta.processos || [];
  if (!processos.length) {
    document.getElementById('badgeCount').textContent = '0';
    lista.innerHTML = '<div class="estado vazio"><i class="material-icons">inbox</i><p>Nenhum processo pautado para esta sessão.</p></div>';
    return;
  }
  document.getElementById('badgeCount').textContent = processos.length;
  lista.innerHTML = '';
  processos.forEach(function(p) { lista.appendChild(criarCard(p)); });
}

/* ── CARD DE PROCESSO ────────────────────────────────────────── */
function criarCard(p) {
  const wrapper = document.createElement('div');
  wrapper.className = 'processo-wrapper';
  wrapper.dataset.idFicha = p.idFicha || '';

  const temAutos = !!(p.urlAutos);
  const temVoto = p.temVoto;
  const idFichaEsc = esc(p.idFicha);
  const processoEsc = esc(p.processo);
  const generoRelator = _membrosCache[p.relator] || 'Masculino';
  const labelRelator = generoRelator === 'Feminino' ? 'Relatora' : 'Relator';

  // Ícone de PDF — vermelho, com tooltip
  const iconRelat = temAutos
    ? '<button class="action-icon pdf-btn tooltipped" data-position="bottom" data-tooltip="Visualizar processo completo" onclick="abrirRelatorio(\'' + esc(p.urlAutos) + '\')"><i class="material-icons" style="font-size:19px">picture_as_pdf</i></button>'
    : '<span class="tooltipped" data-position="bottom" data-tooltip="Processo não localizado">' +
        '<button class="action-icon pdf-btn" style="opacity:.3; pointer-events:none; cursor:default;" disabled>' +
          '<i class="material-icons" style="font-size:19px">picture_as_pdf</i>' +
        '</button>' +
      '</span>';

  // Ícone de votos da ficha
  const iconVotos =
    '<button class="action-icon tooltipped" data-position="bottom" data-tooltip="Visualizar ou juntar voto" ' +
    'onclick="abrirModalVotos(\'' + idFichaEsc + '\', \'' + processoEsc + '\')">' +
    '<i class="material-icons" style="font-size:19px">description</i></button>';
  
  // Ícone de registrar voto (desabilitado se não há voto na ficha)
  const iconVotar = temVoto
    ? '<button class="action-icon votar-btn tooltipped" data-position="bottom" data-tooltip="Votar" onclick="toggleVotoForm(\'' + idFichaEsc + '\')"><i class="material-icons" style="font-size:19px">how_to_vote</i></button>'
    : '<span class="tooltipped" data-position="bottom" data-tooltip="Nenhum voto registrado">' +
        '<button class="action-icon votar-btn" style="opacity:.5; pointer-events:none; cursor:default;" disabled>' +
          '<i class="material-icons" style="font-size:19px">how_to_vote</i>' +
        '</button>' +
      '</span>';

  // Determina se é Pleno (variável global _orgaoSessao já normalizada)
  const ePleno = _orgaoSessao.includes('pleno');

  // Linha condicional (sempre exibida)
  const linhaExtra = ePleno
    ? '<div class="dado-linha"><span class="dado-rotulo">Voto condutor</span><span class="dado-valor">' + (p.votoCondutor || '—') + '</span></div>'
    : '<div class="dado-linha"><span class="dado-rotulo">Procurador</span><span class="dado-valor">' + (p.procurador || '—') + '</span></div>';

  // Ementa com espaço superior
  const ementaHtml = p.ementa
    ? '<div style="margin-top: 8px;"></div>' +
      '<div class="dado-linha"><span class="dado-rotulo">Ementa</span><span class="dado-valor">' + p.ementa + '</span></div>'
    : '';

  // Chip de status de voto
  const chipStatus = p.temVoto
    ? '<span class="chip-status-voto chip-tem-voto">com voto</span>'
    : '<span class="chip-status-voto chip-sem-voto">sem voto</span>';

  const card = document.createElement('div');
  card.className = 'lista-card';
  card.innerHTML =
    '<div class="card-header-row">' +
      '<div class="ordem-badge">' + (p.ordem || '—') + '</div>' +
      '<div class="card-info">' +
        '<div class="card-top-row">' +
          '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
            '<span class="processo-numero">Processo nº ' + (p.processo || '(sem número)') + '</span>' +
            chipStatus +
          '</div>' +
          '<div class="card-actions">' + iconVotos + iconRelat + iconVotar +
          '</div>' +
        '</div>' +
        '<div class="dados-processo">' +
          '<div class="dado-linha"><span class="dado-rotulo">Requerente</span><span class="dado-valor">' + (p.requerente || '—') + '</span></div>' +
          '<div class="dado-linha"><span class="dado-rotulo">Requerido</span><span class="dado-valor">'  + (p.requerido  || '—') + '</span></div>' +
          '<div class="dado-linha"><span class="dado-rotulo">' + labelRelator + '</span><span class="dado-valor">' + (p.relator || '—') + '</span></div>' +
          linhaExtra +
          ementaHtml +
        '</div>' +
      '</div>' +
    '</div>';

  wrapper.appendChild(card);
  wrapper.appendChild(criarFormVoto(p.idFicha));

  // Inicializa tooltips nos ícones recém‑criados
  var tooltips = card.querySelectorAll('.tooltipped');
  M.Tooltip.init(tooltips, {
    enterDelay: 200,
    exitDelay: 100
  });

  return wrapper;
}

/* ── FORMULÁRIO DE VOTAÇÃO ───────────────────────────────────── */
function criarFormVoto(idFicha) {
  const div = document.createElement('div');
  div.className = 'voto-form-wrapper';
  div.id = 'form-' + idFicha;
  const chips = renderChipsVotantes(_votantesCache[idFicha] || []);
  div.innerHTML =
    '<div class="voto-form-inner">' +
      '<div class="form-subsecao">' +
        '<p class="form-subsecao-titulo">Registrar Voto</p>' +
        '<div class="input-field" style="margin-top:20px; margin-bottom:12px; width:100%; max-width:380px;">' +
          '<select id="nome-' + idFicha + '">' +
            '<option value="" disabled selected>Escolha seu nome</option>' +
          '</select>' +
          '<label>Seu nome completo</label>' +
        '</div>' +
        '<label class="opcoes-label">Selecione sua opção de voto</label>' +
        '<div class="opcoes-voto" id="opcoes-' + idFicha + '"></div>' +
        '<div class="voto-form-actions">' +
          '<button class="btn-oab-confirm" id="btnConf-' + idFicha + '" onclick="confirmarVoto(\'' + idFicha + '\')">' +
          '<i class="material-icons" style="font-size:15px">check</i> Confirmar voto</button>' +
          '<button class="btn-oab" onclick="toggleVotoForm(\'' + idFicha + '\')">Cancelar</button>' +
        '</div>' +
      '</div>' +
      '<hr class="form-separator">' +
      '<div class="form-subsecao" style="margin-bottom:0;">' +
        '<p class="form-subsecao-titulo">Membros que já votaram</p>' +
        '<div class="votantes-lista" id="votantes-' + idFicha + '">' + chips + '</div>' +
      '</div>' +
    '</div>';
  return div;
}

function renderChipsVotantes(lista) {
  if (!lista || !lista.length) return '<span class="votantes-vazio">Nenhum voto registrado ainda.</span>';
  return lista.map(function(n) { return '<span class="chip-votante">' + n + '</span>'; }).join('');
}

function renderOpcoesVoto(idFicha, votos) {
  const container = document.getElementById('opcoes-' + idFicha);
  if (!container) return;
  let html = '';
  (votos || []).forEach(function(v) {
    const tipo = v.tipovoto || v.tipo || 'Voto';
    const relator = v.relator || '';
    let label = tipo;
    if (relator) label += ' (' + relator + ')';
    html +=
      '<label class="opcao-voto-label" onclick="selecionarVoto(this)">' +
        '<input type="radio" name="voto-' + idFicha + '" value="' + label + '">' +
        label +
      '</label>';
  });
  html +=
    '<label class="opcao-voto-label" onclick="selecionarVoto(this)">' +
      '<input type="radio" name="voto-' + idFicha + '" value="Abstenho-me">' +
      'Abstenho-me' +
    '</label>';
  container.innerHTML = html;
}

async function toggleVotoForm(idFicha) {
  const form   = document.getElementById('form-' + idFicha);
  const aberto = form.classList.contains('aberto');
  document.querySelectorAll('.voto-form-wrapper.aberto').forEach(function(f) { f.classList.remove('aberto'); });
  if (!aberto) {
    form.classList.add('aberto');

    // Popula e inicializa o select de nome com a lista de membros
    var selectNome = document.getElementById('nome-' + idFicha);
    if (selectNome && selectNome.options.length <= 1) {  // evita repopular se já tiver opções
      selectNome.innerHTML = '<option value="" disabled selected>Escolha seu nome</option>';
      var nomes = Object.keys(_membrosCache).sort();
      nomes.forEach(function(nome) {
        var opt = document.createElement('option');
        opt.value = nome;
        opt.textContent = nome;
        selectNome.appendChild(opt);
      });
      // Inicializa o Materialize Select (depois que o form estiver visível)
      setTimeout(function() {
        var oldInstance = M.FormSelect.getInstance(selectNome);
        if (oldInstance) oldInstance.destroy();
        M.FormSelect.init(selectNome, {});
      }, 100);
    }

    var nomeInput = document.getElementById('nome-' + idFicha);
    if (nomeInput) {
      nomeInput.removeAttribute('data-autocomplete-inited');
      initAutocompleteOnFocus(nomeInput);
    }

    atualizarVotantes(idFicha);

    // Busca os votos da ficha para montar opções dinâmicas
    try {
      const res = await gasGet({ acao: 'votos', fichaId: idFicha });
      _votosPorFichaCache[idFicha] = res.votos || [];
      renderOpcoesVoto(idFicha, _votosPorFichaCache[idFicha]);
    } catch (err) {
      console.warn('Erro ao buscar votos para opções:', err);
    }
  }
}

async function atualizarVotantes(idFicha) {
  try {
    const data = await gasGet({ acao:'votantes', sessaoId: _sessaoId });
    _votantesCache = data.votantes || {};
    const el = document.getElementById('votantes-' + idFicha);
    if (el) el.innerHTML = renderChipsVotantes(_votantesCache[idFicha] || []);
  } catch (err) { console.warn('atualizarVotantes:', err.message); }
}

function selecionarVoto(label) {
  const radio = label.querySelector('input[type="radio"]');
  if (!radio) return;
  document.querySelectorAll('input[name="' + radio.name + '"]').forEach(function(r) {
    var p = r.closest('.opcao-voto-label');
    if (p) p.classList.remove('selecionada');
  });
  label.classList.add('selecionada');
  radio.checked = true;
}

async function confirmarVoto(idFicha) {
  const nomeSelect = document.getElementById('nome-' + idFicha);
  const nome       = nomeSelect ? nomeSelect.value.trim() : '';
  const radioSel   = document.querySelector('input[name="voto-' + idFicha + '"]:checked');

  // Validações
  if (!nome) {
    if (nomeSelect) nomeSelect.focus();
    toast('Selecione seu nome na lista.', 'erro');
    return;
  }
  if (!radioSel) {
    toast('Selecione uma opção de voto.', 'erro');
    return;
  }

  const btn = document.getElementById('btnConf-' + idFicha);
  btn.disabled = true;
  btn.innerHTML = '<i class="material-icons" style="font-size:15px;animation:spin 1s linear infinite">autorenew</i> Registrando…';

  try {
    await gasPost({ acao: 'votar', nome: nome, voto: radioSel.value, idFicha: idFicha });
    toast('Voto registrado com sucesso!');

    // Fecha o formulário
    document.getElementById('form-' + idFicha).classList.remove('aberto');

    // Reseta o select de nome para a opção padrão
    if (nomeSelect) {
      nomeSelect.value = '';  // seleciona a opção disabled "Escolha seu nome"
      // Atualiza a interface do Materialize
      var instance = M.FormSelect.getInstance(nomeSelect);
      if (instance) {
        instance.destroy();
      }
      M.FormSelect.init(nomeSelect, {});
    }

    // Limpa as opções de voto
    document.querySelectorAll('input[name="voto-' + idFicha + '"]').forEach(function(r) {
      r.checked = false;
      var p = r.closest('.opcao-voto-label');
      if (p) p.classList.remove('selecionada');
    });

    // Atualiza chips de votantes
    var novaLista = (_votantesCache[idFicha] || []).concat([nome]);
    _votantesCache[idFicha] = novaLista;
    var el = document.getElementById('votantes-' + idFicha);
    if (el) el.innerHTML = renderChipsVotantes(novaLista);

  } catch (err) {
    console.error(err);
    toast('Erro de rede ao registrar voto.', 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="material-icons" style="font-size:15px">check</i> Confirmar voto';
  }
}

/* ── MODAL DE VOTOS ──────────────────────────────────────────── */
async function abrirModalVotos(fichaId, processoNum) {
  _mvFichaId    = fichaId;
  _mvExpandido  = null;
  _mvPdfPendente = null;

  document.getElementById('mvTitulo').textContent = 'Processo nº ' + processoNum;
  document.getElementById('mvBody').innerHTML =
    '<div class="mv-loading"><i class="material-icons" style="animation:spin 1s linear infinite;color:var(--oab-azul)">autorenew</i></div>';
  document.getElementById('modalVotos').classList.add('ativo');

  try {
    const res = await gasGet({ acao:'votos', fichaId: fichaId });
    _mvFichaInfo = (res.fichaInfo && typeof res.fichaInfo === 'object') ? res.fichaInfo : {};
    _mvVotosCache = res.votos || [];   // ← guarda no cache do modal
    mvRenderLista(_mvVotosCache);
  } catch (err) {
    document.getElementById('mvBody').innerHTML =
      '<div class="estado erro"><i class="material-icons">error_outline</i><p>' + err.message + '</p></div>';
  }
}

function mvRenderLista(votos) {
  const body = document.getElementById('mvBody');

  var lista = (votos || []).map(function(v) {
    return {
      id     : v.id,
      tipo   : v.tipovoto   || 'Voto',
      relator: v.relator    || '',
      texto  : v.voto       || '',
      url    : v['url relatório'] || '',
    };
  });

  var html = '';

  if (!lista.length) {
    html += '<div class="mv-empty">Nenhum voto registrado para esta ficha.</div>';
  } else {
    lista.forEach(function(v) {
      var pdfChip = v.url
        ? '<a href="' + v.url + '" target="_blank" class="chip-pdf-link tooltipped" data-position="bottom" title="Abrir relatório"><i class="material-icons" style="font-size:12px">picture_as_pdf</i>Relatório</a>'
        : '<button class="chip-pdf-pending tooltipped" data-position="bottom" title="Anexar relatório" onclick="mvAnexarRelatorio(\'' + esc(v.id) + '\')">' +
          '<i class="material-icons" style="font-size:12px">picture_as_pdf</i>Relatório</button>';

      var textoSanitizado = v.texto.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').trim();

      html +=
        '<div class="mv-voto-card" data-mvid="' + esc(v.id) + '">' +
          '<div class="mv-voto-header" onclick="mvToggle(\'' + esc(v.id) + '\')" style="cursor:pointer">' +
            '<div class="mv-voto-info">' +
              '<span class="mv-voto-tipo">' + (v.tipo) + '</span>' +
              '<span class="mv-voto-relator">' + (v.relator || '—') + '</span>' +
            '</div>' +
            '<div class="mv-voto-actions" onclick="event.stopPropagation()">' +
              pdfChip +
              '<button class="action-icon tooltipped" data-position="bottom" title="Expandir texto do voto" onclick="mvToggle(\'' + esc(v.id) + '\')">' +
              '<i class="material-icons" style="font-size:18px">expand_more</i></button>' +
            '</div>' +
          '</div>' +
          '<div class="mv-voto-body" id="mvbody-' + esc(v.id) + '">' +
            '<p class="mv-voto-texto">' + textoSanitizado + '</p>' +
          '</div>' +
        '</div>';
    });
  }

  html +=
    '<div class="mv-btn-add-wrap">' +
      '<button class="btn-oab-confirm" data-position="bottom" onclick="mvMostrarFormNovo()" style="font-size:11px">' +
      '<i class="material-icons" style="font-size:15px">add</i> Adicionar voto</button>' +
    '</div>';

  html +=
    '<div class="mv-novo-card" id="mvNovoCard">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
        '<span style="font-size:11px;font-weight:700;color:var(--oab-azul-escuro);border-left:3px solid var(--oab-vermelho);padding-left:8px;text-transform:uppercase;letter-spacing:.05em">Novo voto</span>' +
        '<button class="modal-close tooltipped" data-position="bottom" title="Fechar formulário" onclick="mvFecharFormNovo()"><i class="material-icons">close</i></button>' +
      '</div>' +
      '<div class="mv-select-row">' +
        '<div class="input-field" style="flex:0 0 160px; margin:0;">' +
          '<select id="mvNovoTipo">' +
            '<option value="Voto do relator">Voto do relator</option>' +
            '<option value="Voto divergente">Voto divergente</option>' +
          '</select>' +
          '<label>Tipo</label>' +
        '</div>' +
        '<div class="input-field" style="flex:1; margin:0;">' +
          '<select id="mvNovoRelator">' +
            '<option value="" disabled selected>Escolha o relator</option>' +
          '</select>' +
          '<label>Relator</label>' +
        '</div>' +
      '</div>' +
      '<label style="font-size:10px;color:var(--oab-cinza-label);font-weight:700;text-transform:uppercase;letter-spacing:.04em">Voto</label>' +
      '<div class="editor-wrap">' +
        '<div class="editor-toolbar" onmousedown="event.preventDefault()">' +
          '<button class="tooltipped" data-position="top" title="Negrito" onclick="document.execCommand(\'bold\')"><i class="material-icons" style="font-size:16px">format_bold</i></button>' +
          '<button class="tooltipped" data-position="top" title="Itálico" onclick="document.execCommand(\'italic\')"><i class="material-icons" style="font-size:16px">format_italic</i></button>' +
          '<button class="tooltipped" data-position="top" title="Sublinhado" onclick="document.execCommand(\'underline\')"><i class="material-icons" style="font-size:16px">format_underlined</i></button>' +
        '</div>' +
        '<div class="voto-editor" id="mvNovoTexto" contenteditable="true" data-placeholder="Digite o voto…"></div>' +
      '</div>' +
      '<div class="mv-novo-actions">' +
        '<button class="btn-oab-confirm" data-position="top" onclick="mvAnexarPdfNovo()" style="font-size:11px;display:flex;align-items:center;gap:5px;" id="mvBtnPdf">' +
        '<i class="material-icons" style="font-size:14px">picture_as_pdf</i>Adicionar relatório em PDF</button>' +
        '<div class="mv-novo-actions-right">' +
          '<button class="btn-oab" data-position="top" onclick="mvFecharFormNovo()">Cancelar</button>' +
          '<button class="btn-oab-confirm" data-position="top" id="mvBtnSalvar" onclick="mvSalvarNovoVoto()">Salvar</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  body.innerHTML = html;

  // Inicializa tooltips em todos os elementos novos
  var tooltips = body.querySelectorAll('.tooltipped');
  M.Tooltip.init(tooltips, {
    enterDelay: 200,
    exitDelay: 100
  });
}

function mvToggle(votoId) {
  var el = document.getElementById('mvbody-' + votoId);
  if (!el) return;
  if (_mvExpandido === votoId) {
    el.style.display = 'none';
    _mvExpandido = null;
  } else {
    if (_mvExpandido) {
      var prev = document.getElementById('mvbody-' + _mvExpandido);
      if (prev) prev.style.display = 'none';
    }
    el.style.display = 'block';
    _mvExpandido = votoId;
  }
}

function mvMostrarFormNovo() {
  var card = document.getElementById('mvNovoCard');
  if (!card) return;

  // Popula o select de relator com a lista de membros
  var selectRelator = document.getElementById('mvNovoRelator');
  if (selectRelator) {
    selectRelator.innerHTML = '<option value="" disabled selected>Escolha o relator</option>';
    var nomes = Object.keys(_membrosCache).sort();
    nomes.forEach(function(nome) {
      var opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      selectRelator.appendChild(opt);
    });
    // Destroi instância anterior e recria
    var oldRel = M.FormSelect.getInstance(selectRelator);
    if (oldRel) oldRel.destroy();
    M.FormSelect.init(selectRelator, {});
  }

  // Inicializa o select de tipo (mvNovoTipo)
  var selectTipo = document.getElementById('mvNovoTipo');
  if (selectTipo) {
    // Pré‑seleciona "Voto divergente" se já existir voto do relator
    var temRelator = _mvVotosCache.some(function(v) {
      var tipo = (v.tipovoto || v.tipo || '').toLowerCase();
      return tipo.indexOf('voto do relator') !== -1;
    });
    selectTipo.value = temRelator ? 'Voto divergente' : 'Voto do relator';

    var oldTipo = M.FormSelect.getInstance(selectTipo);
    if (oldTipo) oldTipo.destroy();
    M.FormSelect.init(selectTipo, {});
  }

  card.style.display = 'block';
  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function mvFecharFormNovo() {
  var card = document.getElementById('mvNovoCard');
  if (card) {
    // Destroi instâncias dos selects
    var tipoEl = document.getElementById('mvNovoTipo');
    if (tipoEl) { var i = M.FormSelect.getInstance(tipoEl); if (i) i.destroy(); }
    var relEl = document.getElementById('mvNovoRelator');
    if (relEl) { var j = M.FormSelect.getInstance(relEl); if (j) j.destroy(); }
    card.style.display = 'none';
  }
  _mvPdfPendente = null;
  var btn = document.getElementById('mvBtnPdf');
  if (btn) {
    btn.innerHTML = '<i class="material-icons" style="font-size:14px">picture_as_pdf</i>Adicionar relatório';
    btn.style.background = '';
  }
}function mvAnexarRelatorio(votoId) {
  if (!votoId) { toast('ID do voto inválido.', 'erro'); return; }
  _escolherPdf(function(base64, fileName) {
    toast('Fazendo upload do relatório…');
    var cardVoto = document.querySelector('[data-mvid="' + votoId + '"]');
    var relatorVoto = '';
    if (cardVoto) {
      var relEl = cardVoto.querySelector('.mv-voto-relator');
      if (relEl) relatorVoto = relEl.textContent.trim();
    }
    if (!relatorVoto) relatorVoto = (_mvFichaInfo && _mvFichaInfo.relator) ? _mvFichaInfo.relator : '';

    mvExecutarUpload(base64, fileName, votoId, relatorVoto, function(urlResultado) {
      var chipEl = cardVoto ? cardVoto.querySelector('.chip-pdf-pending') : null;
      if (chipEl) {
        var link = document.createElement('a');
        link.href = urlResultado;
        link.target = '_blank';
        link.className = 'chip-pdf-link';
        link.innerHTML = '<i class="material-icons" style="font-size:12px">picture_as_pdf</i>Relatório';
        chipEl.parentNode.replaceChild(link, chipEl);
      }
      toast('Relatório anexado com sucesso!');
      mvPerguntarResumoIA(base64, votoId, null);
    });
  });
}

function mvAnexarPdfNovo() {
  _escolherPdf(function(base64, fileName) {
    _mvPdfPendente = { base64: base64, fileName: fileName };
    var btn = document.getElementById('mvBtnPdf');
    if (btn) {
      btn.innerHTML = '<i class="material-icons" style="font-size:14px">check_circle</i>' + fileName.substring(0, 20);
      btn.style.background = 'var(--oab-verde)';
    }
    mvPerguntarResumoIA(base64, null, 'mvNovoTexto');
  });
}

/* ── UPLOAD DE PDF (assíncrono com polling) ── */
function mvExecutarUpload(base64, fileName, votoId, relatorVoto, onSucesso, onErro) {
  var token = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  var payload = {
    acao: 'uploadPdf', token: token, votoId: votoId, base64: base64,
    fileName: fileName || 'relatorio.pdf',
    numeroProcesso: (_mvFichaInfo && _mvFichaInfo.numeroProcesso) ? _mvFichaInfo.numeroProcesso : 'sem_numero',
    relator: relatorVoto || ((_mvFichaInfo && _mvFichaInfo.relator) ? _mvFichaInfo.relator : ''),
    dataSessaoISO: (_mvFichaInfo && _mvFichaInfo.dataSessaoISO) ? _mvFichaInfo.dataSessaoISO : '',
    orgao: (_mvFichaInfo && _mvFichaInfo.orgao) ? _mvFichaInfo.orgao : '',
  };

  gasPost(payload).then(function() {
    var tentativas = 0, maxTentativas = 20;
    var intervalo = setInterval(function() {
      tentativas++;
      jsonpGet({ acao: 'resultadoUpload', token: token })
        .then(function(res) {
          if (res.status === 'ok') {
            clearInterval(intervalo);
            if (onSucesso) onSucesso(res.url);
          } else if (res.status === 'erro') {
            clearInterval(intervalo);
            if (onErro) onErro(res.erro || 'Erro no upload.');
            else toast('Erro no upload: ' + (res.erro || ''), 'erro');
          } else if (tentativas >= maxTentativas) {
            clearInterval(intervalo);
            if (onErro) onErro('Timeout no upload.');
            else toast('Timeout no upload.', 'erro');
          }
        })
        .catch(function(err) {
          if (tentativas >= maxTentativas) {
            clearInterval(intervalo);
            if (onErro) onErro(err.message);
          }
        });
    }, 3000);
  }).catch(function(err) {
    if (onErro) onErro(err.message);
    else toast('Erro de rede no upload.', 'erro');
  });
}

function _escolherPdf(callback) {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/pdf';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('Limite de 15MB excedido.', 'erro'); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      var base64 = ev.target.result.split(',')[1];
      callback(base64, file.name);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function mvSalvarNovoVoto() {
  var tipo    = document.getElementById('mvNovoTipo').value;
  var relator = (document.getElementById('mvNovoRelator').value || '').trim();
  var editor  = document.getElementById('mvNovoTexto');
  var textoHtml  = editor ? editor.innerHTML.trim() : '';
  var textoPlano = editor ? editor.textContent.trim() : '';

  if (!relator || !textoPlano) { toast('Preencha relator e texto do voto.', 'erro'); return; }

  var btn = document.getElementById('mvBtnSalvar');
  btn.disabled = true; btn.textContent = 'Salvando…';

  try {
    const res = await gasPostViaGet({
      acao: 'novoVoto', fichaId: _mvFichaId,
      tipovoto: tipo, relator: relator, voto: textoHtml,
    });
    if (!res.sucesso) throw new Error(res.erro || 'Erro desconhecido');
    var novoVotoId = res.id || '';
    toast('Voto adicionado!');

    if (_mvPdfPendente && novoVotoId) {
      toast('Enviando relatório…');
      var relatorNovo = (document.getElementById('mvNovoRelator') || {}).value || '';
      relatorNovo = relatorNovo.trim() || ((_mvFichaInfo && _mvFichaInfo.relator) ? _mvFichaInfo.relator : '');
      await new Promise(function(resolve) {
        mvExecutarUpload(
          _mvPdfPendente.base64, _mvPdfPendente.fileName,
          novoVotoId, relatorNovo,
          function(url) { toast('Relatório anexado!'); resolve(); },
          function(erro) { toast('Erro no upload do PDF: ' + erro, 'erro'); resolve(); }
        );
      });
    }

    btn.disabled = false; btn.textContent = 'Salvar';
    mvFecharFormNovo();

    const resVotos = await gasGet({ acao:'votos', fichaId: _mvFichaId });
    _mvFichaInfo = (resVotos.fichaInfo && typeof resVotos.fichaInfo === 'object') ? resVotos.fichaInfo : _mvFichaInfo;
    _mvVotosCache = resVotos.votos || [];
    mvRenderLista(resVotos.votos || []);
  } catch (err) {
    toast('Erro ao salvar: ' + err.message, 'erro');
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

/* ── MODAL IA ────────────────────────────────────────────────── */
function mvPerguntarResumoIA(base64, votoId, targetEditorId) {
  var token = 'ia_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  var container = document.createElement('div');
  container.innerHTML =
    '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;">' +
      '<div style="background:#fff;border-radius:16px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.28);">' +
        '<div id="_miaConteudo" style="padding:20px;">' +
          '<div style="display:flex;align-items:center;gap:12px;border-left:4px solid var(--oab-vermelho);padding-left:10px;margin-bottom:14px;">' +
            '<svg width="28" height="28" viewBox="0 0 192 192" fill="none"><path d="M96 20C96 20 108 72 140 96C108 120 96 172 96 172C96 172 84 120 52 96C84 72 96 20 96 20Z" fill="#004480"/><path d="M20 96C20 96 72 84 96 52C120 84 172 96 172 96C172 96 120 108 96 140C72 108 20 96 20 96Z" fill="#002d56"/></svg>' +
            '<div><div style="font-size:11px;font-weight:700;color:var(--oab-azul-escuro);text-transform:uppercase;letter-spacing:.06em">Gemini IA</div>' +
            '<div style="font-size:10px;color:var(--oab-cinza-md)">Google · Inteligência Artificial</div></div>' +
          '</div>' +
          '<p style="font-size:13px;font-weight:700;color:var(--oab-grafite);margin:0 0 6px">Gerar resumo automático do voto?</p>' +
          '<p id="_miaDesc" style="font-size:12px;color:var(--oab-cinza-label);margin:0 0 16px;line-height:1.5">O texto extraído do PDF será inserido no campo do voto para revisão antes de salvar.</p>' +
        '</div>' +
        '<div id="_miaLoading" style="display:none;flex-direction:column;align-items:center;padding:24px;gap:12px;">' +
          '<svg width="36" height="36" viewBox="0 0 192 192" fill="none" style="animation:spin 2s linear infinite"><path d="M96 20C96 20 108 72 140 96C108 120 96 172 96 172C96 172 84 120 52 96C84 72 96 20 96 20Z" fill="#004480"/><path d="M20 96C20 96 72 84 96 52C120 84 172 96 172 96C172 96 120 108 96 140C72 108 20 96 20 96Z" fill="#002d56"/></svg>' +
          '<span style="font-size:12px;font-weight:600;color:var(--oab-azul-escuro)">Analisando o documento…</span>' +
          '<span id="_miaProgresso" style="font-size:11px;color:var(--oab-cinza-md)">Aguarde, isso pode levar alguns segundos</span>' +
          '<div><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--oab-azul);margin:0 3px;animation:miaPulse 1.2s ease-in-out infinite"></span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--oab-azul);margin:0 3px;animation:miaPulse 1.2s ease-in-out .2s infinite"></span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--oab-azul);margin:0 3px;animation:miaPulse 1.2s ease-in-out .4s infinite"></span></div>' +
        '</div>' +
        '<div id="_miaFooter" style="padding:10px 20px 16px;display:flex;justify-content:flex-end;gap:10px;">' +
          '<button id="_miaBtnNao" class="btn-oab" style="font-size:11px;height:30px;">Não, obrigado</button>' +
          '<button id="_miaBtnSim" class="btn-oab-confirm" style="font-size:11px;height:30px;">Gerar resumo</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(container);

  function fechar() { if (container.parentNode) document.body.removeChild(container); }
  function mostrarLoading(ativo) {
    document.getElementById('_miaConteudo').style.display = ativo ? 'none' : 'block';
    document.getElementById('_miaLoading').style.display  = ativo ? 'flex' : 'none';
    document.getElementById('_miaFooter').style.display   = ativo ? 'none' : 'flex';
  }
  function mostrarErro(msg) {
    mostrarLoading(false);
    var desc = document.getElementById('_miaDesc'); if (desc) desc.textContent = msg||'Erro ao gerar resumo.';
    var btnSim = document.getElementById('_miaBtnSim'); if (btnSim) btnSim.textContent = 'Tentar novamente';
  }
  function mostrarErro503() {
    mostrarLoading(false);
    var desc = document.getElementById('_miaDesc');
    if (desc) desc.textContent = 'O serviço de IA está temporariamente sobrecarregado. Tente novamente.';
    var footer = document.getElementById('_miaFooter');
    if (footer) {
      footer.style.display = 'flex';
      footer.innerHTML =
        '<button id="_miaBtnCancelar503" class="btn-oab" style="font-size:11px;height:30px;">Cancelar</button>' +
        '<button class="btn-oab-confirm" id="_miaBtnRetentar" style="font-size:11px;height:30px;">Tentar novamente</button>';
      document.getElementById('_miaBtnCancelar503').addEventListener('click', fechar);
      document.getElementById('_miaBtnRetentar').addEventListener('click', function() {
        mostrarLoading(true);
        gasPost({ acao:'resumoIA', base64:base64, fichaId:votoId||'', token:token })
          .then(function() { iniciarPolling(); })
          .catch(function(err) { mostrarErro('Erro de rede: '+err.message); });
      });
    }
  }
  function inserirTexto(texto) {
    fechar();
    var ta = document.getElementById(targetEditorId||'mvNovoTexto');
    if (ta) { ta.innerHTML = texto; ta.focus(); }
    toast('Resumo inserido! Revise antes de salvar.');
    if (votoId && !targetEditorId) mvToggle(votoId);
  }
  function iniciarPolling() {
    var tentativas = 0, maxTentativas = 30;
    var intervalo = setInterval(function() {
      tentativas++;
      var prog = document.getElementById('_miaProgresso');
      if (prog) prog.textContent = 'Verificando resultado… (' + tentativas + '/' + maxTentativas + ')';
      jsonpGet({ acao:'resultadoIA', token:token })
        .then(function(res) {
          if (res.status === 'ok')       { clearInterval(intervalo); inserirTexto((res.resumo||'').replace(/```[\s\S]*?```/g,'').replace(/`/g,'').trim()); }
          else if (res.status === 'retentar') { clearInterval(intervalo); mostrarErro503(); }
          else if (res.status === 'erro')     { clearInterval(intervalo); mostrarErro(res.erro||'A IA retornou um erro.'); }
          else if (tentativas >= maxTentativas) { clearInterval(intervalo); mostrarErro('Tempo esgotado.'); }
        })
        .catch(function(err) { if (tentativas>=maxTentativas) { clearInterval(intervalo); mostrarErro(err.message); } });
    }, 3000);
  }
  document.getElementById('_miaBtnNao').addEventListener('click', fechar);
  document.getElementById('_miaBtnSim').addEventListener('click', function() {
    mostrarLoading(true);
    gasPost({ acao:'resumoIA', base64:base64, fichaId:votoId||'', token:token })
      .then(function() { iniciarPolling(); })
      .catch(function(err) { mostrarErro('Erro de rede: '+err.message); });
  });
}

/* ── AÇÕES GERAIS ────────────────────────────────────────────── */
function abrirRelatorio(url) {
  if (!url) { toast('URL não disponível.','erro'); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}

document.querySelectorAll('.modal-overlay').forEach(function(o) {
  o.addEventListener('click', function(e) { if (e.target === o) fecharModal(o.id); });
});

/* ══════════════════════════════════════════════════════════════
   INICIALIZAÇÃO — detecta aba pela URL e inicia
══════════════════════════════════════════════════════════════ */
(function init() {
  // Deep linking: ?aba=presenca | ?aba=votacao | ?aba=pauta
  var params  = new URLSearchParams(window.location.search);
  var abaNaUrl = params.get('aba') || 'presenca';
  var abaItem  = document.querySelector('[data-aba="' + abaNaUrl + '"]');

  if (abaItem) {
    trocarAba(abaNaUrl, abaItem);
  } else {
    // Fallback: presença
    trocarAba('presenca', document.querySelector('[data-aba="presenca"]'));
  }
})();

(function aplicarConstantesVisuais() {
  document.addEventListener('DOMContentLoaded', function() {
    // Logos OAB
    var logos = document.querySelectorAll('.oab-logo-dinamico');
    for (var i = 0; i < logos.length; i++) {
      logos[i].src = URL_LOGO_OAB;
    }
    // Rodapé
    var logoRodape = document.getElementById('logoRodape');
    if (logoRodape) logoRodape.src = URL_LOGO_RODAPE;

    // QR Code
    var qrImg = document.getElementById('qrImagem');
    if (qrImg) qrImg.src = URL_QR_IMAGEM;
    var qrUrl = document.getElementById('qrUrl');
    if (qrUrl) qrUrl.textContent = URL_QR_PRESENCA;
  });
})();

function initAutocompleteOnFocus(inputEl) {
  if (!inputEl || inputEl.hasAttribute('data-autocomplete-inited')) return;

  function ativar() {
    M.Autocomplete.init(inputEl, {
      data: getMembrosAutocompleteData(),
      minLength: 2,
      limit: 10
    });
    inputEl.setAttribute('data-autocomplete-inited', 'true');
    inputEl.addEventListener('blur', function() {
      var valor = inputEl.value.trim();
      if (valor && !_membrosCache[valor]) {
        inputEl.value = '';
        var instance = M.Autocomplete.getInstance(inputEl);
        if (instance) instance.close();
      }
    });
    inputEl.removeEventListener('focus', ativar);
  }

  inputEl.addEventListener('focus', ativar);
}