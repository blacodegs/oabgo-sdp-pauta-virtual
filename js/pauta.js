/* ══════════════════════════════════════════════════════════════
   pauta.js — SDP-OAB/GO
   Funções da aba "Pauta Virtual" (inclui modal de votos)
══════════════════════════════════════════════════════════════ */

let _pautaForaDoPeriodo = false;
let _sessaoInfo = null;

async function iniciarPauta() {
  try {
    var estado = await gasGet({ acao: 'estadoAtivo' });
    if (!estado.sessaoVirtual) {
      document.getElementById('listaProcessos').innerHTML =
        '<div class="estado vazio"><i class="material-icons">event_busy</i><p>Nenhuma sessão virtual ativa no momento.</p></div>';
      document.getElementById('bannerMeta').innerHTML =
        '<span class="banner-meta-item"><i class="material-icons">info</i>Aguardando sessão</span>';
      return;
    }
    _sessaoId = estado.sessaoVirtual;

    if (Object.keys(_membrosCache).length === 0) {
      const membrosData = await gasGet({ acao: 'membros' });
      _membrosCache = {};
      (membrosData.membros || []).forEach(m => {
        if (m.nome) _membrosCache[m.nome] = m.genero || 'Masculino';
      });
    }

    carregarPauta();
  } catch (err) {
    console.error('iniciarPauta:', err);
    document.getElementById('listaProcessos').innerHTML =
      '<div class="estado erro"><i class="material-icons">error_outline</i><p>Não foi possível identificar a sessão ativa.<br>' + err.message + '</p></div>';
  }
}

async function carregarPauta() {
  try {
    const pauta = await gasGet({ acao: 'pauta', sessaoId: _sessaoId });

    _sessaoInfo = pauta.sessao || null;

    var verif = verificarPeriodoSessao();
    if (!verif.valido) {
      document.getElementById('listaProcessos').innerHTML =
        '<div class="estado vazio"><i class="material-icons">schedule</i><p>' + verif.motivo + '</p></div>';
      document.getElementById('bannerMeta').innerHTML =
        '<span class="banner-meta-item"><i class="material-icons">info</i>Fora do período</span>';
      return;
    }

    _orgaoSessao = pauta.sessao?.orgao ? String(pauta.sessao.orgao).trim().toLowerCase() : '';
    renderBannerPauta(pauta.sessao);
    renderPauta(pauta);
  } catch (err) {
    console.error('carregarPauta:', err);
    document.getElementById('listaProcessos').innerHTML =
      '<div class="estado erro"><i class="material-icons">error_outline</i><p>Não foi possível carregar a pauta.<br>' + err.message + '</p></div>';
  }
}

function renderBannerPauta(sessao) {
  if (!sessao) return;

  var data = sessao.dataFormatada || sessao.data || '';
  var itens = [];
  var ano = data ? data.split('/')[2] : '';   // extrai o ano de dd/mm/yyyy

  // Ordem da sessão (ex.: 13ª Sessão)
  if (sessao.ordemOrdinal) {
    itens.push('<span class="banner-meta-item"><i class="material-icons" style="font-size:16px;">gavel</i> ' + sessao.ordemOrdinal + ' Sessão virtual do ano de ' + ano + '</span>');
  }

  // Órgão da sessão
  if (sessao.orgao) {
    itens.push('<span class="banner-meta-item"><i class="material-icons" style="font-size:16px;">gavel</i> ' + sessao.orgao + '</span>');
  }

  // Data de início da pauta
  if (data) {
    itens.push('<span class="banner-meta-item"><i class="material-icons" style="font-size:16px;">event</i> Pauta iniciada em ' + data + '</span>');
  }

  var el = document.getElementById('bannerMeta');
  if (el) {
    el.innerHTML = itens.join(' &nbsp;·&nbsp; ') || '<span class="banner-meta-item">Sessão carregada</span>';
  }
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

  const iconRelat = temAutos
    ? '<button class="action-icon pdf-btn tooltipped" data-position="bottom" data-tooltip="Visualizar processo completo" onclick="abrirRelatorio(\'' + esc(p.urlAutos) + '\')"><i class="material-icons" style="font-size:19px">picture_as_pdf</i></button>'
    : '<span class="tooltipped" data-position="bottom" data-tooltip="Processo não localizado"><button class="action-icon pdf-btn" style="opacity:.3; pointer-events:none; cursor:default;" disabled><i class="material-icons" style="font-size:19px">picture_as_pdf</i></button></span>';

  const iconVotos =
    '<button class="action-icon tooltipped" data-position="bottom" data-tooltip="Visualizar ou juntar voto" onclick="abrirModalVotos(\'' + idFichaEsc + '\', \'' + processoEsc + '\')"><i class="material-icons" style="font-size:19px">description</i></button>';

  const iconVotar = temVoto
    ? '<button class="action-icon votar-btn tooltipped" data-position="bottom" data-tooltip="Votar" onclick="toggleVotoForm(\'' + idFichaEsc + '\')"><i class="material-icons" style="font-size:19px">how_to_vote</i></button>'
    : '<span class="tooltipped" data-position="bottom" data-tooltip="Nenhum voto registrado"><button class="action-icon votar-btn" style="opacity:.5; pointer-events:none; cursor:default;" disabled><i class="material-icons" style="font-size:19px">how_to_vote</i></button></span>';

  const ePleno = _orgaoSessao.includes('pleno');
  const linhaExtra = ePleno
    ? '<div class="dado-linha"><span class="dado-rotulo">Voto condutor</span><span class="dado-valor">' + (p.votoCondutor || '—') + '</span></div>'
    : '<div class="dado-linha"><span class="dado-rotulo">Procurador</span><span class="dado-valor">' + (p.procurador || '—') + '</span></div>';

  const ementaHtml = p.ementa
    ? '<div style="margin-top: 8px;"></div><div class="dado-linha"><span class="dado-rotulo">Ementa</span><span class="dado-valor">' + p.ementa + '</span></div>'
    : '';

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

  var tooltips = card.querySelectorAll('.tooltipped');
  M.Tooltip.init(tooltips, { enterDelay: 200, exitDelay: 100 });

  return wrapper;
}

/* ── Formulário de votação (expansível no card) ── */
function criarFormVoto(idFicha) {
  const div = document.createElement('div');
  div.className = 'voto-form-wrapper';
  div.id = 'form-' + idFicha;
  const chips = renderChipsVotantes(_votantesCache[idFicha] || []);
  div.innerHTML =
    '<div class="voto-form-inner">' +
      '<div class="form-subsecao">' +
        '<p class="form-subsecao-titulo">Registrar Voto</p>' +
        '<div class="votante-search-wrap">' +
          '<label class="votante-search-label">Quem está votando?</label>' +
          '<input type="text" id="nome-' + idFicha + '" class="votante-search-input" autocomplete="off" placeholder="Digite aqui e selecione o seu nome na lista…" oninput="filtrarVotantes(\'' + idFicha + '\')">' +
          '<div id="votante-chip-' + idFicha + '" class="votante-chip" style="display:none;"></div>' +
          '<div class="votante-lista" id="lista-votantes-' + idFicha + '" style="display:none;"></div>' +
        '</div>' +
        '<label class="opcoes-label">Selecione sua opção de voto</label>' +
        '<div class="opcoes-voto" id="opcoes-' + idFicha + '"></div>' +
        '<div class="voto-form-actions">' +
          '<button class="btn-oab-confirm" id="btnConf-' + idFicha + '" onclick="confirmarVoto(\'' + idFicha + '\')"><i class="material-icons" style="font-size:15px">check</i> Confirmar voto</button>' +
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
      '<label class="opcao-voto-label" onclick="selecionarVoto(this)"><input type="radio" name="voto-' + idFicha + '" value="' + label + '">' + label + '</label>';
  });
  html +=
    '<label class="opcao-voto-label" onclick="selecionarVoto(this)"><input type="radio" name="voto-' + idFicha + '" value="Abstenho-me">Abstenho-me</label>';
  container.innerHTML = html;
}

async function toggleVotoForm(idFicha) {
  const form   = document.getElementById('form-' + idFicha);
  const aberto = form.classList.contains('aberto');

  document.querySelectorAll('.voto-form-wrapper.aberto').forEach(function(f) { f.classList.remove('aberto'); });

  if (!aberto) {
    form.classList.add('aberto');

    // Limpa e reexibe o campo de busca
    var nomeInput = document.getElementById('nome-' + idFicha);
    if (nomeInput) {
      nomeInput.value = '';
      nomeInput.removeAttribute('data-nome-selecionado');
      nomeInput.style.display = 'block';
    }

    // Remove chip de nome
    var chipEl = document.getElementById('votante-chip-' + idFicha);
    if (chipEl) { chipEl.innerHTML = ''; chipEl.style.display = 'none'; }

    // Limpa lista
    var listaEl = document.getElementById('lista-votantes-' + idFicha);
    if (listaEl) { listaEl.innerHTML = ''; listaEl.style.display = 'none'; }

    // Configura filtro
    if (nomeInput) {
      nomeInput.addEventListener('input', function() {
        filtrarVotantes(idFicha);
      });
    }

    // Única requisição: votos + votantes
    try {
      const res = await gasGet({ acao: 'votantes', fichaId: idFicha });

      // Renderiza opções de voto
      _votosPorFichaCache[idFicha] = res.votos || [];
      renderOpcoesVoto(idFicha, _votosPorFichaCache[idFicha]);

      // Renderiza chips de votantes
      const votantesEl = document.getElementById('votantes-' + idFicha);
      if (votantesEl) votantesEl.innerHTML = renderChipsVotantes(res.votantes || []);
    } catch (err) {
      console.warn('Erro ao carregar votos/votantes:', err);
    }
  }
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
  const nomeInput = document.getElementById('nome-' + idFicha);
  const nome = nomeInput ? (nomeInput.getAttribute('data-nome-selecionado') || '').trim() : '';
  const radioSel = document.querySelector('input[name="voto-' + idFicha + '"]:checked');

  if (!nome) {
    if (nomeInput) nomeInput.focus();
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

    var verificacao = verificarPeriodoSessao();
    if (!verificacao.valido) {
      mostrarAlerta('Fora do período', verificacao.motivo);
      return;
    }

    await gasPost({ acao: 'votarPauta', nome: nome, voto: radioSel.value, idFicha: idFicha })

    // Fecha o formulário
    document.getElementById('form-' + idFicha).classList.remove('aberto');

    // Limpa o campo de nome e a lista de votantes
    if (nomeInput) nomeInput.value = '';
    var listaEl = document.getElementById('lista-votantes-' + idFicha);
    if (listaEl) {
      listaEl.innerHTML = '';
      listaEl.style.display = 'none';
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

/* ── MODAL DE VOTOS ── */
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
    _mvVotosCache = res.votos || [];
    mvRenderLista(_mvVotosCache);
  } catch (err) {
    document.getElementById('mvBody').innerHTML =
      '<div class="estado erro"><i class="material-icons">error_outline</i><p>' + err.message + '</p></div>';
  }
}

function mvRenderLista(votos) {
  const body = document.getElementById('mvBody');
  var lista = (votos || []).map(function(v) {
    return { id: v.id, tipo: v.tipovoto || 'Voto', relator: v.relator || '', texto: v.voto || '', url: v['url relatório'] || '' };
  });

  var html = '';
  if (!lista.length) {
    html += '<div class="mv-empty">Nenhum voto registrado para esta ficha.</div>';
  } else {
    lista.forEach(function(v) {
      var pdfChip = v.url
        ? '<a href="' + v.url + '" target="_blank" class="chip-pdf-link tooltipped" data-position="bottom" title="Abrir relatório"><i class="material-icons" style="font-size:12px">picture_as_pdf</i>Relatório</a>'
        : '<button class="chip-pdf-pending tooltipped" data-position="bottom" title="Anexar relatório" onclick="mvAnexarRelatorio(\'' + esc(v.id) + '\')"><i class="material-icons" style="font-size:12px">picture_as_pdf</i>Relatório</button>';

      var textoHtml = v.texto || '';

      html +=
        '<div class="mv-voto-card" data-mvid="' + esc(v.id) + '">' +
          '<div class="mv-voto-header" onclick="mvToggle(\'' + esc(v.id) + '\')" style="cursor:pointer">' +
            '<div class="mv-voto-info"><span class="mv-voto-tipo">' + (v.tipo) + '</span><span class="mv-voto-relator">' + (v.relator || '—') + '</span></div>' +
            '<div class="mv-voto-actions" onclick="event.stopPropagation()">' + pdfChip +
              '<button class="action-icon tooltipped" data-position="bottom" title="Expandir texto do voto" onclick="mvToggle(\'' + esc(v.id) + '\')"><i class="material-icons" style="font-size:18px">expand_more</i></button>' +
            '</div>' +
          '</div>' +
          '<div class="mv-voto-body" id="mvbody-' + esc(v.id) + '"><p class="mv-voto-texto">' + textoHtml + '</p></div>' +
        '</div>';
    });
  }

  html +=
    '<div class="mv-btn-add-wrap"><button class="btn-oab-confirm" onclick="mvMostrarFormNovo()" style="font-size:11px"><i class="material-icons" style="font-size:15px">add</i> Adicionar voto</button></div>' +
    '<div class="mv-novo-card" id="mvNovoCard">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:11px;font-weight:700;color:var(--oab-azul-escuro);border-left:3px solid var(--oab-vermelho);padding-left:8px;text-transform:uppercase;letter-spacing:.05em">Novo voto</span><button class="modal-close tooltipped" data-position="bottom" title="Fechar formulário" onclick="mvFecharFormNovo()"><i class="material-icons">close</i></button></div>' +
            '<div class="mv-select-row">' +
              '<div class="votante-search-wrap" style="flex:0 0 180px; max-width:180px;">' +
                '<label class="votante-search-label">Tipo de voto</label>' +
                '<input type="text" id="mvNovoTipo" class="votante-search-input" autocomplete="off" placeholder="Selecione o tipo…" onfocus="mostrarOpcoesTipoVoto()">' +
                '<div id="votante-chip-tipo" class="votante-chip" style="display:none;"></div>' +
                '<div class="votante-lista" id="lista-tipo-voto" style="display:none;"></div>' +
              '</div>' +
              '<div class="votante-search-wrap" style="flex:1; min-width:200px;">' +
                '<label class="votante-search-label">Relator</label>' +
                '<input type="text" id="mvNovoRelator" class="votante-search-input" autocomplete="off" placeholder="Digite para buscar o relator…" oninput="filtrarRelatoresNovoVoto()">' +
                '<div id="votante-chip-relator" class="votante-chip" style="display:none;"></div>' +
                '<div class="votante-lista" id="lista-relatores" style="display:none;"></div>' +
              '</div>' +
            '</div>' +
      '<label style="font-size:10px;color:var(--oab-cinza-label);font-weight:700;text-transform:uppercase;letter-spacing:.04em">Voto</label>' +
      '<div class="editor-wrap"><div class="editor-toolbar" onmousedown="event.preventDefault()"><button class="tooltipped" data-position="top" title="Negrito" onclick="document.execCommand(\'bold\')"><i class="material-icons" style="font-size:16px">format_bold</i></button><button class="tooltipped" data-position="top" title="Itálico" onclick="document.execCommand(\'italic\')"><i class="material-icons" style="font-size:16px">format_italic</i></button><button class="tooltipped" data-position="top" title="Sublinhado" onclick="document.execCommand(\'underline\')"><i class="material-icons" style="font-size:16px">format_underlined</i></button></div><div class="voto-editor" id="mvNovoTexto" contenteditable="true" data-placeholder="Digite o voto…"></div></div>' +
      '<div class="mv-novo-actions"><button class="btn-oab-confirm" data-position="top" onclick="mvAnexarPdfNovo()" style="font-size:11px;display:flex;align-items:center;gap:5px;" id="mvBtnPdf"><i class="material-icons" style="font-size:14px">picture_as_pdf</i>Adicionar relatório em PDF</button><div class="mv-novo-actions-right"><button class="btn-oab" data-position="top" onclick="mvFecharFormNovo()">Cancelar</button><button class="btn-oab-confirm" data-position="top" id="mvBtnSalvar" onclick="mvSalvarNovoVoto()">Salvar</button></div></div>' +
    '</div>';

  body.innerHTML = html;

  // Aplica limpeza no texto colado no editor de novo voto
  var editorNovo = document.getElementById('mvNovoTexto');
  if (editorNovo) {
    editorNovo.addEventListener('paste', function(e) {
      e.preventDefault();

      // Obtém o texto puro do clipboard
      var textoColado = (e.clipboardData || window.clipboardData).getData('text/plain');
      var textoLimpo = limparTextoColado(textoColado);

      // Insere o texto limpo no local do cursor
      document.execCommand('insertText', false, textoLimpo);
    });
  }

  var tooltips = body.querySelectorAll('.tooltipped');
  M.Tooltip.init(tooltips, { enterDelay: 200, exitDelay: 100 });
}

function mvToggle(votoId) {
  var el = document.getElementById('mvbody-' + votoId);
  if (!el) return;
  if (_mvExpandido === votoId) {
    el.style.display = 'none';
    _mvExpandido = null;
  } else {
    if (_mvExpandido) document.getElementById('mvbody-' + _mvExpandido).style.display = 'none';
    el.style.display = 'block';
    _mvExpandido = votoId;
  }
}

function mvMostrarFormNovo() {
  var card = document.getElementById('mvNovoCard');
  if (!card) return;

  // Limpa e reexibe o campo de tipo de voto
  var inputTipo = document.getElementById('mvNovoTipo');
  if (inputTipo) {
    inputTipo.style.display = 'block';
    inputTipo.value = '';
    inputTipo.removeAttribute('data-tipo-selecionado');
  }
  var chipTipo = document.getElementById('votante-chip-tipo');
  if (chipTipo) { chipTipo.innerHTML = ''; chipTipo.style.display = 'none'; }
  var listaTipo = document.getElementById('lista-tipo-voto');
  if (listaTipo) { listaTipo.innerHTML = ''; listaTipo.style.display = 'none'; }

  // Limpa e reexibe o campo de relator
  var inputRelator = document.getElementById('mvNovoRelator');
  if (inputRelator) {
    inputRelator.style.display = 'block';
    inputRelator.value = '';
    inputRelator.removeAttribute('data-relator-selecionado');
  }
  var chipRelator = document.getElementById('votante-chip-relator');
  if (chipRelator) { chipRelator.innerHTML = ''; chipRelator.style.display = 'none'; }
  var listaRelator = document.getElementById('lista-relatores');
  if (listaRelator) { listaRelator.innerHTML = ''; listaRelator.style.display = 'none'; }

  // Pré‑seleciona o tipo de voto com base no cache
  var temRelator = _mvVotosCache.some(function(v) {
    return (v.tipovoto || v.tipo || '').toLowerCase().indexOf('voto do relator') !== -1;
  });

  if (inputTipo) {
    var tipoPreSelecionado = temRelator ? 'Voto divergente' : 'Voto do relator';
    inputTipo.value = tipoPreSelecionado;
    inputTipo.setAttribute('data-tipo-selecionado', tipoPreSelecionado);
    inputTipo.style.display = 'none';

    if (chipTipo) {
      chipTipo.innerHTML =
        '<span class="chip-nome">' + tipoPreSelecionado + '</span>' +
        '<span class="chip-remover" onclick="removerTipoVotoNovo()" title="Remover">×</span>';
      chipTipo.style.display = 'inline-flex';
    }
  }

  card.style.display = 'block';
  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function mvFecharFormNovo() {
  var card = document.getElementById('mvNovoCard');
  if (card) {
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
}

function mvAnexarRelatorio(votoId) {
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
          if (res.status === 'ok') { clearInterval(intervalo); if (onSucesso) onSucesso(res.url); }
          else if (res.status === 'erro') { clearInterval(intervalo); if (onErro) onErro(res.erro || 'Erro no upload.'); else toast('Erro no upload: ' + (res.erro || ''), 'erro'); }
          else if (tentativas >= maxTentativas) { clearInterval(intervalo); if (onErro) onErro('Timeout no upload.'); else toast('Timeout no upload.', 'erro'); }
        })
        .catch(function(err) { if (tentativas >= maxTentativas) { clearInterval(intervalo); if (onErro) onErro(err.message); } });
    }, 3000);
  }).catch(function(err) { if (onErro) onErro(err.message); else toast('Erro de rede no upload.', 'erro'); });
}

function _escolherPdf(callback) {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/pdf';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('Limite de 15MB excedido.', 'erro'); return; }
    var reader = new FileReader();
    reader.onload = function(ev) { callback(ev.target.result.split(',')[1], file.name); };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function mvSalvarNovoVoto() {
  var inputTipo = document.getElementById('mvNovoTipo');
  var tipo = inputTipo ? (inputTipo.getAttribute('data-tipo-selecionado') || '').trim() : '';

  var inputRelator = document.getElementById('mvNovoRelator');
  var relator = inputRelator ? (inputRelator.getAttribute('data-relator-selecionado') || '').trim() : '';

  var editor  = document.getElementById('mvNovoTexto');
  var textoHtml  = editor ? editor.innerHTML.trim() : '';
  var textoPlano = editor ? editor.textContent.trim() : '';

  var verificacao = verificarPeriodoSessao();
  if (!verificacao.valido) {
    mostrarAlerta('Fora do período', verificacao.motivo);
    return;
  }

  if (!tipo)     { toast('Selecione o tipo de voto.', 'erro'); return; }
  if (!relator)  { toast('Selecione o relator.', 'erro'); return; }
  if (!textoPlano) { toast('Preencha o texto do voto.', 'erro'); return; }

  var btn = document.getElementById('mvBtnSalvar');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    const res = await gasPostViaGet({
      acao: 'novoVoto',
      fichaId: _mvFichaId,
      tipovoto: tipo,
      relator: relator,
      voto: textoHtml,
    });

    if (!res.sucesso) throw new Error(res.erro || 'Erro desconhecido');
    var novoVotoId = res.id || '';
    toast('Voto adicionado!');

    if (_mvPdfPendente && novoVotoId) {
      toast('Enviando relatório…');
      var relatorNovo = relator.trim() || ((_mvFichaInfo && _mvFichaInfo.relator) ? _mvFichaInfo.relator : '');
      await new Promise(function(resolve) {
        mvExecutarUpload(
          _mvPdfPendente.base64,
          _mvPdfPendente.fileName,
          novoVotoId,
          relatorNovo,
          function(url) { toast('Relatório anexado!'); resolve(); },
          function(erro) { toast('Erro no upload do PDF: ' + erro, 'erro'); resolve(); }
        );
      });
    }

    btn.disabled = false;
    btn.textContent = 'Salvar';
    mvFecharFormNovo();

    const resVotos = await gasGet({ acao:'votos', fichaId: _mvFichaId });
    _mvFichaInfo = (resVotos.fichaInfo && typeof resVotos.fichaInfo === 'object') ? resVotos.fichaInfo : _mvFichaInfo;
    _mvVotosCache = resVotos.votos || [];
    mvRenderLista(resVotos.votos || []);

  } catch (err) {
    toast('Erro ao salvar: ' + err.message, 'erro');
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

function mvPerguntarResumoIA(base64, votoId, targetEditorId) {
  if (!base64 || base64.length === 0) {
    toast('PDF vazio ou corrompido.', 'erro');
    return;
  }

  var taId = targetEditorId || 'mvNovoTexto';
  var modalEl = document.getElementById('modalProgressoIA');
  modalEl.classList.add('ativo');

  // Mostra loading e esconde erro
  document.getElementById('progressoLoading').style.display = 'flex';
  document.getElementById('progressoErro').style.display = 'none';

  var token = 'ia_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  function mostrarLoading(ativo) {
    document.getElementById('progressoLoading').style.display = ativo ? 'flex' : 'none';
    document.getElementById('progressoErro').style.display = ativo ? 'none' : 'block';
  }

  function mostrarErro(mensagem) {
    mostrarLoading(false);
    var titulo = document.getElementById('erroTitulo');
    var descricao = document.getElementById('erroMensagem');
    if (mensagem && (mensagem.indexOf('503') !== -1 || mensagem.indexOf('high demand') !== -1 || mensagem.indexOf('indisponível') !== -1 || mensagem.indexOf('sobrecarregado') !== -1)) {
      titulo.innerText = 'IA temporariamente indisponível';
      descricao.innerText = 'O serviço de inteligência artificial está sobrecarregado no momento. Você pode tentar novamente ou usar outra IA.';
    } else {
      titulo.innerText = 'Não foi possível gerar o resumo';
      descricao.innerText = mensagem || 'Ocorreu um erro inesperado. Tente novamente.';
    }
    var dropdownElem = document.getElementById('btnAcoesErro');
    M.Dropdown.init(dropdownElem, {
      constrainWidth: false,
      coverTrigger: false
    });
  }

  function iniciarPolling() {
    var tentativas = 0, maxTentativas = 30;
    var intervalo = setInterval(function() {
      tentativas++;
      jsonpGet({ acao: 'resultadoIA', token: token })
        .then(function(res) {
          if (res.status === 'ok') {
            clearInterval(intervalo);
            modalEl.classList.remove('ativo');
            var texto = (res.resumo || '').replace(/```[\s\S]*?```/g, '').replace(/`/g, '').trim();
            var ta = document.getElementById(taId);
            if (ta) {
              ta.innerHTML = texto;
              toast('Resumo inserido! Revise antes de salvar.');
              ta.focus();
              if (votoId) mvToggle(votoId);
            }
          } else if (res.status === 'retentar') {
            clearInterval(intervalo);
            mostrarErro('Serviço sobrecarregado. Tente novamente.');
          } else if (res.status === 'erro') {
            clearInterval(intervalo);
            mostrarErro(res.erro || 'A IA retornou um erro.');
          } else if (tentativas >= maxTentativas) {
            clearInterval(intervalo);
            mostrarErro('Tempo esgotado. O servidor demorou mais que o esperado.');
          }
        })
        .catch(function(err) {
          if (tentativas >= maxTentativas) {
            clearInterval(intervalo);
            mostrarErro('Não foi possível obter o resultado: ' + err.message);
          }
        });
    }, 3000);
  }

  function executarResumo() {
    mostrarLoading(true);
    gasPost({ acao: 'resumoIA', base64: base64, token: token })
      .then(function() { iniciarPolling(); })
      .catch(function(err) { mostrarErro('Erro de rede: ' + err.message); });
  }

  document.getElementById('btnCancelarErro').onclick = function() {
    modalEl.classList.remove('ativo');
  };

  document.getElementById('btnRepetirErro').onclick = function() {
    executarResumo();
  };

  document.getElementById('btnOutraIAErro').onclick = function() {
    mostrarLoading(true);
    var loadingTexto = document.querySelector('#progressoLoading .mia-loading-texto');
    var loadingSub = document.querySelector('#progressoLoading .mia-loading-sub');
    if (loadingTexto) loadingTexto.innerText = 'Montando prompt para outra IA...';
    if (loadingSub) loadingSub.innerText = 'Preparando texto para copiar';

    jsonpGet({ acao: 'montarTextoIA', token: token })
      .then(function(res) {
        if (res && res.sucesso) {
          navigator.clipboard.writeText(res.textoCompleto).then(function() {
            mostrarErro('Prompt copiado!');
            document.getElementById('erroTitulo').style.color = '#2e7d32';
            document.getElementById('erroMensagem').innerText = 'O texto com o prompt e o conteúdo do relatório foram copiados para a área de transferência. Cole em qualquer chat de IA de sua preferência.';
            document.getElementById('btnCancelarErro').style.display = 'none';
            document.getElementById('btnAcoesErro').style.display = 'none';

            setTimeout(function() {
              modalEl.classList.remove('ativo');
              document.getElementById('erroTitulo').style.color = '#c62828';
              document.getElementById('btnCancelarErro').style.display = '';
              document.getElementById('btnAcoesErro').style.display = '';
              if (loadingTexto) loadingTexto.innerText = 'Analisando o documento...';
              if (loadingSub) loadingSub.innerText = 'Isso pode levar alguns segundos';
            }, 30000);
          }).catch(function(err) {
            mostrarErro('Não foi possível copiar para a área de transferência.');
            if (loadingTexto) loadingTexto.innerText = 'Analisando o documento...';
            if (loadingSub) loadingSub.innerText = 'Isso pode levar alguns segundos';
          });
        } else {
          mostrarErro('Erro ao montar texto: ' + (res ? res.erro : 'desconhecido'));
          if (loadingTexto) loadingTexto.innerText = 'Analisando o documento...';
          if (loadingSub) loadingSub.innerText = 'Isso pode levar alguns segundos';
        }
      })
      .catch(function(err) {
        mostrarErro('Erro: ' + err.message);
        if (loadingTexto) loadingTexto.innerText = 'Analisando o documento...';
        if (loadingSub) loadingSub.innerText = 'Isso pode levar alguns segundos';
      });
  };

  executarResumo();
}

function abrirRelatorio(url) {
  if (!url) { toast('URL não disponível.','erro'); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Filtra a lista de votantes com base no texto digitado.
 * Exibe apenas os nomes que contêm o termo buscado.
 * @param {string} idFicha
 */
function filtrarVotantes(idFicha) {
  var input = document.getElementById('nome-' + idFicha);
  var listaEl = document.getElementById('lista-votantes-' + idFicha);
  if (!input || !listaEl) return;

  var termo = input.value.trim().toLowerCase();
  var nomes = Object.keys(_membrosCache).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); });

  // Se campo vazio, esconde a lista
  if (!termo) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
    return;
  }

  var filtrados = nomes.filter(function(nome) {
    return nome.toLowerCase().indexOf(termo) !== -1;
  });

  if (filtrados.length === 0) {
    listaEl.innerHTML = '<div class="votante-opcao" style="color:var(--oab-cinza-md);font-style:italic;">Nenhum membro encontrado</div>';
    listaEl.style.display = 'block';
    return;
  }

  var html = '';
  filtrados.forEach(function(nome) {
    html +=
      '<label class="votante-opcao">' +
        '<input type="radio" name="votante-' + idFicha + '" value="' + nome + '" onchange="selecionarVotante(\'' + idFicha + '\', this.value)">' +
        '<span>' + nome + '</span>' +
      '</label>';
  });
  listaEl.innerHTML = html;
  listaEl.style.display = 'block';
}

/**
 * Define o nome selecionado no input de busca e esconde a lista.
 * @param {string} idFicha
 * @param {string} nome
 */
function selecionarVotante(idFicha, nome) {
  var input = document.getElementById('nome-' + idFicha);
  var listaEl = document.getElementById('lista-votantes-' + idFicha);
  var chipEl = document.getElementById('votante-chip-' + idFicha);

  if (input) {
    input.value = nome;  // preenche o input (mas não será usado na confirmação)
    input.setAttribute('data-nome-selecionado', nome); // armazena o nome correto
    input.style.display = 'none';
  }

  if (listaEl) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
  }

  if (chipEl) {
    chipEl.innerHTML =
      '<span class="chip-nome">' + nome + '</span>' +
      '<span class="chip-remover" onclick="removerVotante(\'' + idFicha + '\')" title="Remover">×</span>';
    chipEl.style.display = 'inline-flex';
  }
}

function removerVotante(idFicha) {
  var input = document.getElementById('nome-' + idFicha);
  var chipEl = document.getElementById('votante-chip-' + idFicha);
  var listaEl = document.getElementById('lista-votantes-' + idFicha);

  if (input) {
    input.value = '';
    input.removeAttribute('data-nome-selecionado'); // limpa o nome armazenado
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
 * Limpa o texto colado no editor, removendo quebras, tabulações e espaços
 * desnecessários, preservando espaçamentos entre palavras.
 * @param {string} texto - texto bruto do clipboard
 * @returns {string} texto limpo
 */
function limparTextoColado(texto) {
  if (!texto) return '';

  var limpo = texto;

  // 1. Remove tabulações (substitui por espaço)
  limpo = limpo.replace(/\t+/g, ' ');

  // 2. Remove hifenização + quebra de linha + espaços (ex.: "de-\nnado")
  limpo = limpo.replace(/\s*-\s*[\r\n]+\s*/g, '');

  // 3. Substitui qualquer quebra de linha (simples ou múltipla) por um espaço
  limpo = limpo.replace(/[\r\n]+/g, ' ');

  // 4. Colapsa espaços múltiplos em um único
  limpo = limpo.replace(/[ ]{2,}/g, ' ');

  // 5. Remove espaços extras no início e no fim
  limpo = limpo.trim();

  return limpo;
}

function mostrarOpcoesTipoVoto() {
  var listaEl = document.getElementById('lista-tipo-voto');
  if (!listaEl) return;

  var opcoes = ['Voto do relator', 'Voto divergente'];
  var html = '';
  opcoes.forEach(function(opcao) {
    html +=
      '<label class="votante-opcao">' +
        '<input type="radio" name="novo-voto-tipo" value="' + opcao + '" onchange="selecionarTipoVotoNovo(this.value)">' +
        '<span>' + opcao + '</span>' +
      '</label>';
  });
  listaEl.innerHTML = html;
  listaEl.style.display = 'block';

  // Fecha a lista quando clicar fora
  setTimeout(function() {
    document.addEventListener('click', function fechar(e) {
      if (!listaEl.contains(e.target) && e.target.id !== 'mvNovoTipo') {
        listaEl.style.display = 'none';
        document.removeEventListener('click', fechar);
      }
    });
  }, 100);
}

function selecionarTipoVotoNovo(opcao) {
  var input = document.getElementById('mvNovoTipo');
  var chipEl = document.getElementById('votante-chip-tipo');
  var listaEl = document.getElementById('lista-tipo-voto');

  if (input) {
    input.value = opcao;
    input.setAttribute('data-tipo-selecionado', opcao);
    input.style.display = 'none';
  }
  if (chipEl) {
    chipEl.innerHTML =
      '<span class="chip-nome">' + opcao + '</span>' +
      '<span class="chip-remover" onclick="removerTipoVotoNovo()" title="Remover">×</span>';
    chipEl.style.display = 'inline-flex';
  }
  if (listaEl) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
  }
}

function removerTipoVotoNovo() {
  var input = document.getElementById('mvNovoTipo');
  var chipEl = document.getElementById('votante-chip-tipo');
  var listaEl = document.getElementById('lista-tipo-voto');

  if (input) {
    input.value = '';
    input.removeAttribute('data-tipo-selecionado');
    input.style.display = 'block';
  }
  if (chipEl) { chipEl.innerHTML = ''; chipEl.style.display = 'none'; }
  if (listaEl) { listaEl.innerHTML = ''; listaEl.style.display = 'none'; }
}

function filtrarRelatoresNovoVoto() {
  var input = document.getElementById('mvNovoRelator');
  var listaEl = document.getElementById('lista-relatores');
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
        '<input type="radio" name="novo-voto-relator" value="' + nome + '" onchange="selecionarRelatorNovoVoto(this.value)">' +
        '<span>' + nome + '</span>' +
      '</label>';
  });
  listaEl.innerHTML = html;
  listaEl.style.display = 'block';
}

function selecionarRelatorNovoVoto(nome) {
  var input = document.getElementById('mvNovoRelator');
  var chipEl = document.getElementById('votante-chip-relator');
  var listaEl = document.getElementById('lista-relatores');

  if (input) {
    input.value = nome;
    input.setAttribute('data-relator-selecionado', nome);
    input.style.display = 'none';
  }
  if (chipEl) {
    chipEl.innerHTML =
      '<span class="chip-nome">' + nome + '</span>' +
      '<span class="chip-remover" onclick="removerRelatorNovoVoto()" title="Remover">×</span>';
    chipEl.style.display = 'inline-flex';
  }
  if (listaEl) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
  }
}

function removerRelatorNovoVoto() {
  var input = document.getElementById('mvNovoRelator');
  var chipEl = document.getElementById('votante-chip-relator');
  var listaEl = document.getElementById('lista-relatores');

  if (input) {
    input.value = '';
    input.removeAttribute('data-relator-selecionado');
    input.style.display = 'block';
  }
  if (chipEl) { chipEl.innerHTML = ''; chipEl.style.display = 'none'; }
  if (listaEl) { listaEl.innerHTML = ''; listaEl.style.display = 'none'; }
}

/**
 * Verifica se o momento atual está dentro do período da sessão.
 * @returns {{ valido: boolean, motivo: string }}
 */
function verificarPeriodoSessao() {
  if (!_sessaoInfo) {
    return { valido: false, motivo: 'Dados da sessão não carregados.' };
  }

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