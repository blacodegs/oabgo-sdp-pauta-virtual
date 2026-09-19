/* ══════════════════════════════════════════════════════════════
   votacao.js — SDP-OAB/GO
   Funções da aba "Votação Individual"
══════════════════════════════════════════════════════════════ */

let _votacaoFichaId = null;
let _pollingVotantesVotacao = null;

async function iniciarVotacao() {
  var estadoEl = document.getElementById('votacaoEstado');
  var mainEl   = document.getElementById('votacaoMain');

  if (estadoEl) { estadoEl.style.display = 'flex'; estadoEl.className = 'estado loading'; estadoEl.innerHTML = '<i class="material-icons">autorenew</i><p>Carregando dados do processo…</p>'; }
  if (mainEl)   mainEl.style.display = 'none';

  try {
    // 1. Uma única requisição: ficha em votação + sessão + processo + votos + votantes + membros (se cache vazio)
    var precisaMembros = Object.keys(_membrosCache).length === 0;
    var res = await gasGet({ acao: 'infoVotacao', incluirMembros: precisaMembros });

    if (!res.sucesso || res.semVotacao) {
      if (estadoEl) {
        estadoEl.className = 'estado vazio';
        estadoEl.innerHTML = '<i class="material-icons">how_to_vote</i><p>' +
          (res.motivo || 'Nenhum processo em votação no momento.') + '</p>';
      }
      return;
    }

    // 2. Popula cache de membros se o backend enviou
    if (res.membros && Array.isArray(res.membros)) {
      _membrosCache = {};
      res.membros.forEach(function(m) {
        if (m.nome) _membrosCache[m.nome] = m.genero || 'Masculino';
      });
      console.log('[votacao] membros carregados junto com a votação:', Object.keys(_membrosCache).length);
    }

    // 3. Guarda a sessão + ficha
    _sessaoInfo       = res.sessaoInfo || null;
    _votacaoFichaId   = res.fichaId    || null;

    // 5. Banner — monta o título no front (inclui número do processo)
    renderBannerVotacao(_sessaoInfo, res.processo);

    // 6. Cabeçalho do processo (número + requerente + requerido + ementa)
    renderCabecalhoProcesso(res.processo);

    // 7. Exposição dos votos
    renderExposicaoVotos(res.votos || []);

    // 8. Formulário de votação
    renderFormularioVotacao(res.opcoesVoto || []);

    // 9. Chips de "já votaram" (vêm na requisição inicial)
    renderChipsVotantesVotacao(res.votantes || []);

    // 10. Exibe a interface
    if (estadoEl) estadoEl.style.display = 'none';
    if (mainEl)   mainEl.style.display = 'block';

    // 11. Polling leve — só atualiza os chips de votantes
    if (_pollingVotantesVotacao) clearInterval(_pollingVotantesVotacao);
    _pollingVotantesVotacao = setInterval(function() {
      if (_abaAtiva === 'votacao' && _votacaoFichaId) {
        atualizarVotantesVotacao();
      }
    }, 15000);

  } catch (err) {
    console.error('[votacao] erro:', err);
    if (estadoEl) {
      estadoEl.className = 'estado erro';
      estadoEl.innerHTML = '<i class="material-icons">error_outline</i><p>Não foi possível carregar os dados.<br>' + err.message + '</p>';
    }
  }
}

/**
 * Monta o título do banner a partir dos dados crus da sessão.
 * Formato: "<ordemOrdinal> Sessão <Tipo> do <Órgão> em <ano>"
 * Na linha de metadados, adiciona: data da sessão + "PROCESSO Nº X EM VOTAÇÃO".
 *
 * @param {Object} sessao   — res.sessaoInfo
 * @param {Object} processo — res.processo (opcional)
 */
function renderBannerVotacao(sessao, processo) {
  if (!sessao) return;

  var tituloEl = document.getElementById('votacaoTitulo');
  var dataEl   = document.getElementById('votacaoData');

  var ordem = (sessao.ordemOrdinal || '').trim();
  var tipo  = (sessao.tipo  || '').trim();
  var orgao = (sessao.orgao || '').trim();
  var ano   = sessao.ano || '';

  var titulo = ordem + ' Sessão ' + tipo + ' do ' + orgao + ' em ' + ano;
  if (tituloEl) tituloEl.textContent = titulo.trim();

  if (dataEl) {
    var partes = [];

    if (sessao.dataFormatada) {
      partes.push('<i class="material-icons" style="font-size:16px">event</i> ' + sessao.dataFormatada);
    }

    if (processo && processo.numero) {
      partes.push('<i class="material-icons" style="font-size:16px">gavel</i> PROCESSO Nº ' + processo.numero + ' EM VOTAÇÃO');
    }

    dataEl.innerHTML = partes.join(' &nbsp;·&nbsp; ');
  }
}

/**
 * Monta o cabeçalho do processo (número + requerente + requerido + ementa).
 *
 * @param {Object} processo — res.processo
 */
function renderCabecalhoProcesso(processo) {
  var el = document.getElementById('votacaoCabecalho');
  if (!el || !processo) return;

  var html = '';
  if (processo.numero) html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Processo</span><span class="votacao-valor"><strong>' + processo.numero + '</strong></span></div>';
  if (processo.requerente) html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Requerente</span><span class="votacao-valor">' + processo.requerente + '</span></div>';
  if (processo.requerido)  html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Requerido</span><span class="votacao-valor">' + processo.requerido + '</span></div>';
  if (processo.ementa)     html += '<div class="votacao-info-linha votacao-ementa"><span class="votacao-rotulo">Ementa</span><span class="votacao-valor">' + processo.ementa + '</span></div>';

  el.innerHTML = html;
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

  // Limpa o campo de busca e oculta chip/lista
  var input = document.getElementById('votacaoSelectNome');
  if (input) {
    input.value = '';
    input.removeAttribute('data-nome-selecionado');
    input.style.display = 'block';
  }
  var chipEl = document.getElementById('votante-chip-votacao');
  if (chipEl) { chipEl.innerHTML = ''; chipEl.style.display = 'none'; }
  var listaEl = document.getElementById('lista-votantes-votacao');
  if (listaEl) { listaEl.innerHTML = ''; listaEl.style.display = 'none'; }

  document.getElementById('btnConfirmarVotacao').onclick = confirmarVotoIndividual;
}

async function confirmarVotoIndividual() {
  var input = document.getElementById('votacaoSelectNome');
  var nome = input ? (input.getAttribute('data-nome-selecionado') || '').trim() : '';
  var radioSel = document.querySelector('input[name="votacaoOpcao"]:checked');

  if (!nome) { toast('Selecione seu nome na lista.', 'erro'); return; }
  if (!radioSel) { toast('Selecione uma opção de voto.', 'erro'); return; }

  var btn = document.getElementById('btnConfirmarVotacao');
  btn.disabled = true;
  btn.innerHTML = '<i class="material-icons" style="font-size:15px;animation:spin 1s linear infinite">autorenew</i> Registrando…';

  try {
    await gasPost({ acao: 'votar', nome: nome, voto: radioSel.value, idFicha: _votacaoFichaId });
    toast('Voto registrado com sucesso!');

    // Limpa o campo e a lista
    if (input) {
      input.value = '';
      input.removeAttribute('data-nome-selecionado');
      input.style.display = 'block';
    }

    // ── Adiciona o chip do votante imediatamente (atualização otimista) ──
    // O próximo ciclo de polling substitui pela lista oficial do backend.
    adicionarChipVotanteLocal(nome);

    var chipEl = document.getElementById('votante-chip-votacao');
    if (chipEl) { chipEl.innerHTML = ''; chipEl.style.display = 'none'; }
    var listaEl = document.getElementById('lista-votantes-votacao');
    if (listaEl) { listaEl.innerHTML = ''; listaEl.style.display = 'none'; }

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

function filtrarVotantesVotacao() {
  var input = document.getElementById('votacaoSelectNome');
  var listaEl = document.getElementById('lista-votantes-votacao');
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
        '<input type="radio" name="votacao-votante" value="' + nome + '" onchange="selecionarVotanteVotacao(this.value)">' +
        '<span>' + nome + '</span>' +
      '</label>';
  });
  listaEl.innerHTML = html;
  listaEl.style.display = 'block';
}

function selecionarVotanteVotacao(nome) {
  var input = document.getElementById('votacaoSelectNome');
  var chipEl = document.getElementById('votante-chip-votacao');
  var listaEl = document.getElementById('lista-votantes-votacao');

  if (input) {
    input.value = nome;
    input.setAttribute('data-nome-selecionado', nome);
    input.style.display = 'none';
  }

  if (chipEl) {
    chipEl.innerHTML =
      '<span class="chip-nome">' + nome + '</span>' +
      '<span class="chip-remover" onclick="removerVotanteVotacao()" title="Remover">×</span>';
    chipEl.style.display = 'inline-flex';
  }

  if (listaEl) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
  }
}

function removerVotanteVotacao() {
  var input = document.getElementById('votacaoSelectNome');
  var chipEl = document.getElementById('votante-chip-votacao');
  var listaEl = document.getElementById('lista-votantes-votacao');

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
 * Atualiza apenas os chips de quem já votou.
 * Usa a rota unificada ?acao=participantes&id=<fichaId>.
 */
async function atualizarVotantesVotacao() {
  if (!_votacaoFichaId) return;
  try {
    var data = await gasGet({ acao: 'participantes', fichaId: _votacaoFichaId });
    renderChipsVotantesVotacao((data && data.participantes) ? data.participantes : []);
  } catch (err) {
    console.warn('[votacao] erro ao atualizar votantes:', err.message);
  }
}

function renderChipsVotantesVotacao(lista) {
  var chipsEl    = document.getElementById('votacaoChips');
  var contagemEl = document.getElementById('votacaoContagem');

  if (contagemEl) contagemEl.textContent = lista.length;
  if (!chipsEl) return;

  if (!lista.length) {
    chipsEl.innerHTML = '<span class="presenca-vazio">Nenhum voto registrado ainda.</span>';
    return;
  }

  chipsEl.innerHTML = lista.map(function(nome) {
    return '<span class="chip-presente"><i class="material-icons">check_circle</i>' + nome + '</span>';
  }).join('');
}

/**
 * Adiciona, de forma otimista, o chip de um votante recém-registrado.
 * Não consulta o backend — apenas insere o nome na lista já renderizada.
 * No próximo ciclo de polling, a lista é substituída pela versão oficial.
 *
 * @param {string} nome
 */
function adicionarChipVotanteLocal(nome) {
  if (!nome) return;

  var chipsEl    = document.getElementById('votacaoChips');
  var contagemEl = document.getElementById('votacaoContagem');
  if (!chipsEl) return;

  // Se o placeholder de "vazio" estiver visível, remove
  var vazio = chipsEl.querySelector('.presenca-vazio');
  if (vazio) vazio.remove();

  // Evita duplicar o chip se o nome já estiver na lista
  var jaExiste = Array.from(chipsEl.querySelectorAll('.chip-presente'))
    .some(function(chip) {
      return chip.textContent.trim().indexOf(nome) !== -1;
    });
  if (jaExiste) return;

  // Cria o chip e insere
  var chip = document.createElement('span');
  chip.className = 'chip-presente';
  chip.innerHTML = '<i class="material-icons">check_circle</i>' + nome;
  chipsEl.appendChild(chip);

  // Atualiza o contador
  if (contagemEl) {
    var atual = parseInt(contagemEl.textContent, 10) || 0;
    contagemEl.textContent = atual + 1;
  }
}